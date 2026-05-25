# ECS Fargate — From Scratch

> Companion to M0. Reference doc for Tasks 27, 28 (IAM roles + ECS cluster, task definition, service).

---

## 1. The mental model: a hands-free fleet manager

ECS is a container orchestrator. You declare "I want N copies of this image running with these resources, behind this load balancer"; ECS makes it so and keeps it so.

**Fargate** is the launch type where AWS owns the compute. No VMs to provision, patch, or scale. You ask for CPU and memory; AWS finds capacity.

```
┌─────────────────────────────────────────────────────┐
│  ECS Service "pyawmal-dev-api"                      │
│  Desired count: 1                                    │
│  Task definition: pyawmal-dev-api:42                 │
│                                                      │
│  Current task: <task-id-abc>                         │
│    └── container "api" running pyawmal/api:abc123    │
│        ENI with private IP 10.0.10.42                │
│        registered to ALB target group                │
└─────────────────────────────────────────────────────┘
```

---

## 2. The three concepts

### Task definition — the blueprint
Versioned JSON: image, CPU/memory, env, secrets, ports, IAM roles, log config. Each diff creates a new immutable **revision**.

### Task — a running instance
What ECS creates from a task definition. Has an ID, ENI, IP, state, stop reason.

### Service — the fleet manager
"Always keep N tasks of this task definition running, behind these load balancers, replace failed ones, support rolling deploys."

```
Task definition (blueprint)
       │
       ▼
   Service (fleet manager)
       │
       ▼
   Tasks (running instances)
```

---

## 3. Task definition deep dive

```jsonc
{
  "family": "pyawmal-dev-api",
  "networkMode": "awsvpc",         // each task gets its own ENI + private IP
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",                    // 0.25 vCPU (Fargate sizes are quantized)
  "memory": "512",                 // 0.5 GB
  "executionRoleArn": "arn:aws:iam::123:role/pyawmal-dev-task-exec",
  "taskRoleArn":      "arn:aws:iam::123:role/pyawmal-dev-task",
  "containerDefinitions": [{
    "name": "api",
    "image": "...ecr.../pyawmal/api:abc123",
    "essential": true,
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV",  "value": "production" },
      { "name": "PORT",      "value": "3000" },
      { "name": "LOG_LEVEL", "value": "info" }
    ],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:...:secret:pyawmal/dev/DATABASE_URL-xY" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group":         "/ecs/pyawmal-dev-api",
        "awslogs-region":        "ap-southeast-1",
        "awslogs-stream-prefix": "api"
      }
    }
  }]
}
```

Critical fields:
- **`family`** — name; revisions share a family.
- **`networkMode: "awsvpc"`** — required for Fargate.
- **`cpu`/`memory`** — Fargate enforces a published matrix of valid combinations.
- **`executionRoleArn`** — ECS *agent's* identity (pull ECR, fetch secrets, ship logs).
- **`taskRoleArn`** — your *application's* identity (used by AWS SDK at runtime).
- **`environment`** is plaintext; **`secrets`** references Secrets Manager. Never put credentials in `environment`.
- **`essential: true`** — if container exits, task fails.

### Revisions
Each task-definition change creates an immutable revision (`:1`, `:2`, …). The service points at a revision. Deploying = new image + new revision + service points at it.

---

## 4. Task lifecycle and failure modes

```
PROVISIONING → PENDING → ACTIVATING → RUNNING → DEACTIVATING → STOPPING → DEPROVISIONING → STOPPED
```

| Stuck where | Usual cause |
|---|---|
| **PROVISIONING** indefinitely | Fargate capacity exhausted; subnet IP exhaustion; missing platform version. |
| **PENDING → STOPPED** `CannotPullContainerError` | No NAT → can't reach ECR. Or execution role missing `ecr:GetAuthorizationToken`. Or image tag doesn't exist. |
| **PENDING → STOPPED** `unable to retrieve secret` | Execution role missing `secretsmanager:GetSecretValue` on the secret ARN. |
| **RUNNING → STOPPED** `OutOfMemoryError` | Bumped past `memory`. Bump the value or fix the leak. |
| **RUNNING → STOPPED** `Essential container exited` | App crashed at startup. **Read CloudWatch logs**. Almost always misconfigured env or DB unreachable. |
| **RUNNING → STOPPED** no obvious reason | ALB de-registered for failing health checks → ECS replaces. |

---

## 5. Deployment strategies

### Rolling (default)
Two knobs:
- `minimumHealthyPercent` (default 100) — never below this fraction during deploy.
- `maximumPercent` (default 200) — peak during deploy.

For `desired_count = 1`, defaults mean ECS adds 1 → waits healthy → drains 1.

### Blue/Green (via CodeDeploy)
Whole new fleet alongside old; cut over; bake; destroy old. Zero risk of mixed versions; doubles cost during bake.

### Canary
Shift X% of traffic to new fleet first; monitor; shift the rest. Needs CodeDeploy or other tooling.

M0 uses rolling. M16 might revisit.

---

## 6. Draining + graceful shutdown

```
1. ECS marks old task DRAINING in the target group.
2. ALB stops sending new requests (existing keep going).
3. ALB waits `deregistration_delay` seconds (default 300) for in-flight to finish.
4. ECS sends SIGTERM to the container.
5. Container has `stopTimeout` seconds (default 30, max 120) to shut down.
6. SIGKILL if still alive.
```

Hence Task 10 (graceful shutdown):
```ts
async function shutdown(signal: string): Promise<void> {
  await app.close();   // Fastify stops accepting, waits for in-flight
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
```

Without this: every deploy drops in-flight requests. For M4+ (WebSockets) we'll also send a "server going away" frame.

---

## 7. Three different health checks

| Layer | Where | Effect |
|---|---|---|
| **ALB target-group health check** | Target group config | ALB stops routing to unhealthy targets |
| **ECS container health check** | `containerDefinitions[].healthCheck` (Docker style) | Marks task unhealthy from ECS's view |
| **ECS service health-check grace period** | `health_check_grace_period_seconds` | How long after task start before ALB-unhealthy fails the deploy |

M0 uses only ALB target-group health check on `/health`. Sufficient.

---

## 8. Networking — `awsvpc` mode

Fargate requires `awsvpc`. Each task gets:
- Own ENI
- Own private IP from your subnet
- Own SGs

Consequences:
- Each task consumes one IP — size subnets accordingly (`/24` = 251 usable; safe).
- ENI provisioning ~20-30s → first cold start slow.
- Cross-AZ ENI traffic is free within a VPC.
- No `host` or `bridge` modes (those are EC2 launch type only).

Service `network_configuration` specifies subnets (`module.vpc.private_subnets`) and SG (`aws_security_group.ecs.id`). `assign_public_ip = false` keeps task private.

---

## 9. Scaling

- **Manual** — change `desired_count`, apply.
- **Target tracking** — keep avg CPU at X%. Most-used.
- **Step scaling** — tiered thresholds.
- **Scheduled** — calendar-driven.

M0: manual (`desired_count = 1`). M16 turns on target tracking on CPU + ALB `RequestCountPerTarget`.

---

## 10. ECS Exec — shell into a running container

```bash
aws ecs execute-command \
  --cluster pyawmal-dev \
  --task <task-id> \
  --container api \
  --command "/bin/sh" \
  --interactive
```

Prerequisites:
- Service has `enableExecuteCommand: true` (off by default).
- Task role has ECS Exec permissions (`ssmmessages:*` etc.).
- Container image has a shell (`alpine` does; pure `distroless` doesn't).

Replaces SSH-into-the-box debugging.

---

## 11. Debugging cheatsheet

1. **ECS Console → Service → Events tab.** Top of list = the reason.
2. **Tasks → STOPPED → Stopped reason.** Most useful field.
3. **CloudWatch Logs → `/ecs/pyawmal-dev-api` → latest stream.** App-level errors.
4. **Target group → Targets → unhealthy → reason.** What `/health` returned.
5. **CloudTrail** for `AccessDenied` around deploy time.
6. **ECS Exec** if task is RUNNING but misbehaving.

**Single most common bug:** port mismatch — container vs `containerPort` vs target-group `port`. Always all three match.

---

## 12. Our M0 ECS, recapped

```
Cluster:    pyawmal-dev
Service:    pyawmal-dev-api          (desired_count = 1)
  └── Task definition family: pyawmal-dev-api
      └── revision N
          └── container "api"
              image: <ecr>/pyawmal/api:latest
              port: 3000
              env: NODE_ENV, PORT, LOG_LEVEL
              secrets: DATABASE_URL (from Secrets Manager)
              logs → CloudWatch /ecs/pyawmal-dev-api
              roles: task (runtime), task-exec (agent)
              network: private subnets, ECS SG, no public IP
              target group: /health on :3000
              health: 2 pass / 3 fail
              draining: 300s
              shutdown: SIGTERM → fastify.close() → exit 0
```

---

## Key takeaways

- **Three concepts:** task definition (immutable blueprint), task (running instance), service (fleet manager).
- **`awsvpc` networking** — every task has its own ENI; size subnets accordingly.
- **Two IAM roles** — execution (agent), task (your code).
- **Secrets via `secrets[]`**, not `environment[]`.
- **Rolling deploys** by default.
- **Graceful shutdown is non-optional** — handle SIGTERM, call `fastify.close()`.
- **Three health checks** exist; do not confuse.
- **Debugging order:** Events → STOPPED reason → CloudWatch logs → target-group health.
- **Port mismatch** between container/task-def/target-group is the #1 bug.
