# Docker & Containers — From Scratch

> Companion to M0. Reference doc for Task 11 (Dockerfile for `apps/api`).

---

## 1. The mental model: a fenced-off process

A container is *just a regular Linux process* — but one whose view of the system is fenced. From inside:
- Own filesystem
- Own process list (your process is PID 1)
- Own network interfaces
- Own users (container root ≠ host root)
- Limited CPU / memory

From the host: it's still a process on the same kernel.

---

## 2. The three Linux primitives

### Namespaces — "what I can see"
| Namespace | Isolates |
|---|---|
| PID | process IDs |
| mount | filesystem mounts |
| net | NICs, IPs, routing |
| uts | hostname |
| ipc | IPC channels |
| user | UIDs/GIDs |
| cgroup | the resource-limit view |
| time | system clock |

### cgroups — "how much I can use"
CPU, memory, I/O, network bandwidth limits. Fargate's `cpu: "256"` and `memory: "512"` are cgroup constraints.

### Capabilities + seccomp — "what syscalls I can make"
Capabilities = fine-grained privileges (drops most by default). Seccomp = syscall filter (blocks ~50 dangerous ones by default).

**Namespaces + cgroups + capabilities = a container.** Everything else is tooling.

---

## 3. Container vs VM

| | VM | Container |
|---|---|---|
| Underneath | Hypervisor | Host kernel directly |
| Each has | Own kernel + OS | Just a process tree |
| Boot | 30s–2min | ms |
| Memory overhead | Hundreds of MB | A few MB |
| Isolation | Strong (separate kernel) | Weaker (shared kernel) |
| Image size | GBs | MBs |
| Cross-OS | Yes | Same kernel family only |

Docker Desktop on Mac/Windows runs a tiny Linux VM under containers (since they need the Linux kernel). ECS Fargate uses **Firecracker** micro-VMs to add VM-grade isolation between tenants.

---

## 4. Image vs container

**Image** = blueprint. Layered, content-addressed tarball + metadata.
**Container** = running instance. Multiple containers can share one image.

---

## 5. Image layers and content addressing

```
┌──────────────────────────────────────┐
│  Layer 5: COPY apps/api/dist ./dist  │
├──────────────────────────────────────┤
│  Layer 4: pnpm install               │
├──────────────────────────────────────┤
│  Layer 3: COPY package.json          │
├──────────────────────────────────────┤
│  Layer 2: corepack prepare pnpm      │
├──────────────────────────────────────┤
│  Layer 1: FROM node:20-alpine        │
└──────────────────────────────────────┘
```

Each layer's ID = SHA256 of its contents. Identical layers shared across images. Changing one line invalidates only the affected layer and everything above it.

**Dockerfile order rule:** rarely-changing things first (base image, dependencies), frequently-changing things last (source). Otherwise every code change reinstalls dependencies.

### Writable layer
At runtime, Docker adds a writable layer on top. Writes go there. Discarded when the container stops. **State in containers is ephemeral** — use volumes (local) or external storage (S3, RDS) for persistence.

---

## 6. Dockerfile instructions

```dockerfile
FROM <image>          # base layer
WORKDIR <path>        # cd into this dir for subsequent instructions
COPY <src> <dst>      # copy from build context into image
RUN <command>         # execute during build (new layer)
ENV KEY=value         # env var
EXPOSE 3000           # documentation; doesn't open ports
CMD ["node", "x.js"]  # default container command
ENTRYPOINT ["..."]    # wrap CMD with this
```

`CMD` is overridable at `docker run`; `ENTRYPOINT` isn't (without `--entrypoint`).

**Use tini as PID 1 in Node containers** — Node doesn't reap zombies and may not forward signals properly. `ENTRYPOINT ["/sbin/tini", "--"]` solves both.

---

## 7. Multi-stage builds — our Dockerfile

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /repo /repo
COPY . .
RUN pnpm --filter @pyawmal/api build

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
```

- **`base`** — Alpine + Node + pnpm. Shared starting point.
- **`deps`** — copies only `package.json` files, runs `pnpm install`. Cached on manifest content.
- **`build`** — brings in `deps`, copies source, runs `tsc`.
- **`runtime`** — fresh Alpine. Copies only `dist`, `package.json`, `node_modules`. ~150 MB instead of ~800 MB.

`COPY --from=<stage>` is the trick — pull files from earlier stages into the final stage.

---

## 8. Build context and `.dockerignore`

`docker build -t img -f Dockerfile .` — trailing `.` is the build context. Docker tarballs it and sends to the daemon; `COPY` reads from here.

Without `.dockerignore`: `.git`, `node_modules`, `dist`, `.env*` all sent to daemon (slow build, bloated image, secret leakage).

Our `.dockerignore`:
```
node_modules
dist
.env*
*.log
.git
.turbo
coverage
```

---

## 9. Tags and distribution

```
123.dkr.ecr.ap-southeast-1.amazonaws.com/pyawmal/api:abc123
└──────────────────────────────────────┘└────────┘└──────┘
              registry                    repository  tag
```

**`latest` is a trap** — just another tag, not "newest." Two engineers can overwrite each other.
**Production pins to immutable tags** — we tag with git commit SHA.
ECR supports **tag immutability** — pushing the same tag twice errors (we'll enable in M16).

```bash
docker push <registry>/<repo>:<tag>
docker pull <registry>/<repo>:<tag>
```

Only changed layers move on push/pull.

---

## 10. Running locally

```bash
docker run \
  --rm -d \                                 # remove on exit, detached
  --name pyawmal-api \
  -p 3000:3000 \                            # publish container :3000 to host
  -e DATABASE_URL=postgresql://... \
  --env-file apps/api/.env.local \
  pyawmal-api:dev
```

Debug:
```bash
docker ps                              # running containers
docker logs -f pyawmal-api             # tail logs
docker exec -it pyawmal-api /bin/sh    # shell in
docker inspect pyawmal-api             # full metadata
docker stats                           # live CPU/memory
```

---

## 11. Common gotchas

- **`COPY . .` before `RUN pnpm install`** → invalidates install layer on every source change.
- **Different Node version locally vs in image** → corepack/native-module mismatches. Pin base image version.
- **Mac ARM → AWS x86** → "exec format error" at runtime. Use `docker buildx build --platform linux/amd64` or build in CI.
- **Distroless without a shell** → can't `docker exec` for debugging.
- **`.dockerignore` typos** → secret files in images.
- **Running as root inside container** → if a kernel exploit breaks out, host gets a root process. Use `USER node` for hardening.
- **No graceful shutdown** → SIGTERM kills immediately, drops in-flight requests.
- **Mutable `:latest`** → unpredictable deploys. Tag with commit SHA in CI.

---

## 12. How it all connects

```
1. You write code in apps/api/src/*.ts
2. docker build -f apps/api/Dockerfile .
       → OCI image
3. docker tag pyawmal-api:dev <ecr>/pyawmal/api:abc123
4. docker push <ecr>/pyawmal/api:abc123
       → only changed layers uploaded
5. aws ecs update-service --force-new-deployment
       → ECS pulls image, runs container as a task
6. Inside Fargate: Linux kernel + namespaces/cgroups/capabilities
       → your code runs, listens on :3000, logs to stdout
7. CloudWatch picks up stdout → log group
```

---

## Key takeaways

- Container = fenced-off process. Not a VM.
- Fence = namespaces + cgroups + capabilities/seccomp.
- Image = layered, content-addressed blueprint. Container = running instance.
- Dockerfile order: manifests + install before source COPY.
- Multi-stage builds → small runtime image.
- `.dockerignore` required.
- Tini as PID 1 in Node containers.
- Pin image tags by commit SHA in production.
- Build for target architecture.
- Handle SIGTERM.
