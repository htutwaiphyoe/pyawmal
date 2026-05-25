# M0 — Infrastructure Foundation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Related docs:** [PRD](../requirements/infrastructure.md) · [Technical Design](../docs/infrastructure.md)

**Goal:** Stand up a containerised Fastify API behind an AWS load balancer in Singapore, with a Postgres database, ECR image registry, CloudWatch logs, and a GitHub Actions pipeline that auto-deploys every merge to `main`.

**Architecture:** Modular pnpm monorepo (`apps/api`, `apps/web`, `packages/db`, `packages/shared`, `infra/`). The backend API runs as one ECS Fargate task in a private subnet behind a public ALB. Postgres runs in RDS in private subnets. Secrets live in Secrets Manager. Terraform provisions everything; GitHub Actions deploys via OIDC.

**Tech stack:** Node.js 20, TypeScript, Fastify, Prisma, PostgreSQL 16, pnpm + Turborepo, Docker, AWS (VPC, ECS Fargate, ALB, RDS, ECR, CloudWatch, Secrets Manager, IAM), Terraform 1.7+, GitHub Actions with OIDC.

---

## Prerequisites

Before starting, confirm:

- [ ] Node.js 20+ installed (`node -v`)
- [ ] pnpm 9+ installed (`pnpm -v`; if missing: `corepack enable && corepack prepare pnpm@latest --activate`)
- [ ] Docker installed and running (`docker info`)
- [ ] AWS CLI v2 configured with admin credentials (`aws sts get-caller-identity` returns your account)
- [ ] Terraform 1.7+ installed (`terraform version`)
- [ ] A GitHub repository for this project exists
- [ ] You know your AWS account ID

Set these shell variables before running any AWS commands (the plan references them):

```bash
export AWS_REGION=ap-southeast-1
export PROJECT=pyawmal
export ENV=dev
```

---

## Phase 1 — Monorepo & Tooling (Tasks 1–5)

### Task 1: Initialize pnpm monorepo

_Why:_ pnpm workspaces let multiple packages in one repo depend on each other locally without publishing. This is the foundation every later task builds on.

**Files:**

- Create: `.nvmrc`, `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `README.md`

- [ ] **Step 1: Create `.nvmrc`**

```
20
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
.next/
.turbo/
coverage/
.env
.env.local
*.tfstate
*.tfstate.backup
.terraform/
.DS_Store
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "pyawmal",
  "version": "0.0.0",
  "private": true,
  "engines": { "node": ">=20", "pnpm": ">=9" },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck"
  }
}
```

- [ ] **Step 4: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 5: Create minimal `README.md`**

```markdown
# pyawmal

Real-time chat application. See `products/` for product docs and `products/plans/` for milestone implementation plans.
```

- [ ] **Step 6: Install (will create `pnpm-lock.yaml`)**

```bash
pnpm install
```

Expected: empty install completes; `pnpm-lock.yaml` exists.

- [ ] **Step 7: Commit**

```bash
git add .nvmrc .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml README.md
git commit -m "feat(m0): initialize pnpm monorepo"
```

---

### Task 2: Add Turborepo

_Why:_ Turborepo caches builds/tests/lints across the monorepo so we don't re-run unchanged work. Speeds up CI dramatically once the repo grows.

**Files:** Create `turbo.json`. Modify `package.json` (already references turbo).

- [ ] **Step 1: Install turbo as root devDependency**

```bash
pnpm add -D -w turbo
```

- [ ] **Step 2: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 3: Verify turbo runs**

```bash
pnpm turbo run lint
```

Expected: "No tasks were executed" (no packages yet). No error.

- [ ] **Step 4: Commit**

```bash
git add turbo.json package.json pnpm-lock.yaml
git commit -m "feat(m0): add Turborepo"
```

---

### Task 3: TypeScript base config

_Why:_ All TypeScript packages should share one strict base config so type-checking is consistent everywhere.

**Files:** Create `tsconfig.base.json`.

- [ ] **Step 1: Install TypeScript at the root**

```bash
pnpm add -D -w typescript@5.5.4 @types/node@20
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add tsconfig.base.json package.json pnpm-lock.yaml
git commit -m "feat(m0): add strict TypeScript base config"
```

---

### Task 4: ESLint + Prettier

_Why:_ Catches bugs at edit-time (eslint) and removes style debates (prettier). Both run in CI to enforce on PRs.

**Files:** Create `.eslintrc.json`, `.prettierrc`, `.prettierignore`. Modify root `package.json`.

- [ ] **Step 1: Install**

```bash
pnpm add -D -w eslint@8 @typescript-eslint/parser@7 @typescript-eslint/eslint-plugin@7 prettier@3 eslint-config-prettier@9
```

- [ ] **Step 2: Create `.eslintrc.json`**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" },
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  },
  "ignorePatterns": ["dist", "node_modules", ".next", ".turbo", ".terraform"]
}
```

- [ ] **Step 3: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 4: Create `.prettierignore`**

```
node_modules
dist
.next
.turbo
.terraform
pnpm-lock.yaml
*.tfstate*
```

- [ ] **Step 5: Add scripts to root `package.json`**

Edit the `scripts` block:

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

- [ ] **Step 6: Verify**

```bash
pnpm format
pnpm format:check
```

Expected: format runs without errors; check exits 0.

- [ ] **Step 7: Commit**

```bash
git add .eslintrc.json .prettierrc .prettierignore package.json pnpm-lock.yaml
git commit -m "feat(m0): add ESLint and Prettier"
```

---

### Task 5: Commitlint + Husky

_Why:_ Enforces the Conventional Commits format (`feat:`, `fix:`, `chore:`) so commit history is parseable for changelogs and release tooling later.

**Files:** Create `commitlint.config.js`, `.husky/commit-msg`.

- [ ] **Step 1: Install**

```bash
pnpm add -D -w husky@9 @commitlint/cli@19 @commitlint/config-conventional@19
```

- [ ] **Step 2: Create `commitlint.config.js`**

```js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

- [ ] **Step 3: Initialize husky**

```bash
pnpm exec husky init
```

This creates `.husky/pre-commit` (delete it for now; we'll add hooks deliberately).

```bash
rm .husky/pre-commit
```

- [ ] **Step 4: Create `.husky/commit-msg`**

```sh
pnpm exec commitlint --edit "$1"
```

Make it executable:

```bash
chmod +x .husky/commit-msg
```

- [ ] **Step 5: Verify (this should be rejected)**

```bash
git commit --allow-empty -m "bad message"
```

Expected: commit aborted with commitlint error.

- [ ] **Step 6: Commit (proper format)**

```bash
git add commitlint.config.js .husky/commit-msg package.json pnpm-lock.yaml
git commit -m "feat(m0): enforce conventional commits via commitlint + husky"
```

---

## Phase 2 — Backend API (Tasks 6–11)

### Task 6: Scaffold `apps/api` (Fastify)

_Why:_ Fastify is the API framework — faster than Express and TypeScript-friendly. This task gets a server that boots and serves nothing yet.

**Files:** Create `apps/api/{package.json,tsconfig.json,src/server.ts,src/index.ts}`.

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@pyawmal/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "test": "vitest run",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^4.28.0"
  },
  "devDependencies": {
    "tsx": "^4.16.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `apps/api/src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  return app;
}
```

- [ ] **Step 4: Create `apps/api/src/index.ts`**

```ts
import { buildServer } from './server.js';

const app = buildServer();
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Install + run**

```bash
pnpm install
pnpm --filter @pyawmal/api dev
```

Expected: server starts on port 3000. `curl http://localhost:3000/` returns 404 (no routes yet). Ctrl-C to stop.

- [ ] **Step 6: Commit**

```bash
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat(m0): scaffold Fastify api app"
```

---

### Task 7: Env validation with zod

_Why:_ The app should refuse to start with missing or invalid environment variables — better to fail fast at boot than to crash 10 minutes into a request.

**Files:** Create `apps/api/src/env.ts`, `apps/api/.env.example`. Modify `apps/api/src/index.ts`.

- [ ] **Step 1: Install zod**

```bash
pnpm --filter @pyawmal/api add zod
```

- [ ] **Step 2: Create `apps/api/src/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
```

- [ ] **Step 3: Create `apps/api/.env.example`**

```
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://pyawmal:pyawmal@localhost:5432/pyawmal
```

- [ ] **Step 4: Wire `loadEnv()` into `index.ts`**

Replace contents of `apps/api/src/index.ts`:

```ts
import { buildServer } from './server.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = buildServer();

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Verify it refuses to start without DATABASE_URL**

```bash
unset DATABASE_URL
pnpm --filter @pyawmal/api dev
```

Expected: prints "Invalid environment" and exits with code 1.

- [ ] **Step 6: Verify it starts with a valid env**

```bash
DATABASE_URL=postgresql://localhost/pyawmal pnpm --filter @pyawmal/api dev
```

Expected: server starts. Ctrl-C to stop.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/index.ts apps/api/.env.example apps/api/package.json pnpm-lock.yaml
git commit -m "feat(m0): validate env vars at boot with zod"
```

---

### Task 8: TDD `/health` endpoint

_Why:_ This is the endpoint the ALB hits to decide whether the task is healthy. Test-first because we want to know exactly what shape the response is in before writing it.

**Files:** Create `apps/api/src/routes/health.ts`, `apps/api/src/routes/health.test.ts`. Modify `apps/api/src/server.ts`.

- [ ] **Step 1: Create vitest config**

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/routes/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';

describe('GET /health', () => {
  it('returns 200 with { ok: true, version, commit }', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(typeof body.commit).toBe('string');
    await app.close();
  });
});
```

- [ ] **Step 3: Run the test — verify it fails**

```bash
pnpm --filter @pyawmal/api test
```

Expected: FAIL with 404 (route not registered).

- [ ] **Step 4: Implement `/health`**

`apps/api/src/routes/health.ts`:

```ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    version: process.env.npm_package_version ?? '0.0.0',
    commit: process.env.GIT_COMMIT ?? 'dev',
  }));
}
```

Modify `apps/api/src/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.register(healthRoutes);
  return app;
}
```

- [ ] **Step 5: Run the test — verify it passes**

```bash
pnpm --filter @pyawmal/api test
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes apps/api/src/server.ts apps/api/vitest.config.ts
git commit -m "feat(m0): add /health endpoint with test"
```

---

### Task 9: Structured logging + request IDs

_Why:_ When the service is running in production we'll be reading logs in CloudWatch. Structured JSON logs are queryable; request IDs let you trace a single request across all log lines.

**Files:** Modify `apps/api/src/server.ts`.

- [ ] **Step 1: Update `buildServer()` to emit JSON logs with request IDs**

`apps/api/src/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { healthRoutes } from './routes/health.js';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    genReqId: () => randomUUID(),
  });
  app.register(healthRoutes);
  return app;
}
```

- [ ] **Step 2: Install `pino-pretty` for local dev**

```bash
pnpm --filter @pyawmal/api add -D pino-pretty
```

- [ ] **Step 3: Verify**

```bash
DATABASE_URL=postgresql://localhost/pyawmal pnpm --filter @pyawmal/api dev
```

In another terminal: `curl http://localhost:3000/health`.

Expected: log line in the api terminal contains a `reqId` field with a UUID, in dev-formatted output.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/server.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(m0): structured JSON logs with request IDs"
```

---

### Task 10: Graceful shutdown

_Why:_ When ECS rotates a task, it sends SIGTERM. If the server exits immediately, in-flight requests fail. Graceful shutdown drains them first.

**Files:** Modify `apps/api/src/index.ts`.

- [ ] **Step 1: Update `index.ts`**

```ts
import { buildServer } from './server.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = buildServer();

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'received shutdown signal — closing');
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void start();
```

- [ ] **Step 2: Verify**

Start the server, then in another terminal send SIGTERM:

```bash
kill -TERM <pid>
```

Expected: log line "received shutdown signal", then process exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(m0): graceful shutdown on SIGTERM/SIGINT"
```

---

### Task 11: Dockerfile (multi-stage)

_Why:_ Multi-stage builds keep the production image small (no dev deps, no source). Smaller image = faster cold starts = faster deploys.

**Files:** Create `apps/api/Dockerfile`, `apps/api/.dockerignore`.

- [ ] **Step 1: Create `apps/api/.dockerignore`**

```
node_modules
dist
.env*
*.log
.git
.turbo
coverage
```

- [ ] **Step 2: Create `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6

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

> Note: the COPY lines for `packages/db` and `packages/shared` will fail until those packages exist (Tasks 12, 18). For now, comment them out OR proceed and revisit after Phase 3 & 4.

- [ ] **Step 3: Build the image**

```bash
docker build -t pyawmal-api:dev -f apps/api/Dockerfile .
```

Expected: successful build. Final image < 200 MB.

- [ ] **Step 4: Run locally**

```bash
docker run --rm -e DATABASE_URL=postgresql://host.docker.internal/pyawmal -p 3000:3000 pyawmal-api:dev
```

In another terminal: `curl http://localhost:3000/health` — expect 200.

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile apps/api/.dockerignore
git commit -m "feat(m0): multi-stage Dockerfile for api"
```

---

## Phase 3 — Database (Tasks 12–15)

### Task 12: Scaffold `packages/db` (Prisma)

_Why:_ All database access goes through one Prisma client shared across packages. Centralising it means schema changes happen in one place.

**Files:** Create `packages/db/{package.json,tsconfig.json,prisma/schema.prisma,src/index.ts}`.

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@pyawmal/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p . && prisma generate",
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "studio": "prisma studio",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@prisma/client": "^5.18.0"
  },
  "devDependencies": {
    "prisma": "^5.18.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/db/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Models begin in M1. M0 is intentionally empty.
```

- [ ] **Step 4: Create `packages/db/src/index.ts`**

```ts
import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prismaInstance) prismaInstance = new PrismaClient();
  return prismaInstance;
}

export type { PrismaClient } from '@prisma/client';
```

- [ ] **Step 5: Generate the Prisma client**

```bash
pnpm install
DATABASE_URL=postgresql://localhost/pyawmal pnpm --filter @pyawmal/db generate
```

Expected: "Generated Prisma Client" message.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(m0): scaffold @pyawmal/db with Prisma"
```

---

### Task 13: Wire Prisma into `apps/api`

_Why:_ The api needs a Prisma client to talk to the database. We expose it on the Fastify instance so any route can use it via `app.prisma`.

**Files:** Modify `apps/api/package.json`, `apps/api/src/server.ts`. Create `apps/api/src/plugins/db.ts`.

- [ ] **Step 1: Add workspace dependency**

In `apps/api/package.json` dependencies section, add `"@pyawmal/db": "workspace:*"`. Run:

```bash
pnpm install
```

- [ ] **Step 2: Create `apps/api/src/plugins/db.ts`**

```ts
import fp from 'fastify-plugin';
import { getPrisma, type PrismaClient } from '@pyawmal/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const dbPlugin = fp(async (app) => {
  const prisma = getPrisma();
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 3: Install `fastify-plugin`**

```bash
pnpm --filter @pyawmal/api add fastify-plugin
```

- [ ] **Step 4: Register the plugin in `server.ts`**

Add to `apps/api/src/server.ts`:

```ts
import { dbPlugin } from './plugins/db.js';
// inside buildServer(): app.register(dbPlugin);
```

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/db pnpm-lock.yaml
git commit -m "feat(m0): wire Prisma client into api via plugin"
```

---

### Task 14: `/db-ping` endpoint

_Why:_ Confirms end-to-end connectivity from the api task to RDS. We'll hit this after every deploy.

**Files:** Create `apps/api/src/routes/db-ping.ts`. Modify `apps/api/src/server.ts`.

- [ ] **Step 1: Create `apps/api/src/routes/db-ping.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export async function dbPingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/db-ping', async (req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { db: 'ok' };
    } catch (err) {
      req.log.error(err, 'db-ping failed');
      return reply.code(503).send({ db: 'error' });
    }
  });
}
```

- [ ] **Step 2: Register in `server.ts`**

```ts
import { dbPingRoutes } from './routes/db-ping.js';
// app.register(dbPingRoutes);
```

- [ ] **Step 3: Verify manually after Task 15 (local Postgres up)**

Skip verification for now; Task 15 brings up Postgres locally and we'll curl this endpoint then.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/db-ping.ts apps/api/src/server.ts
git commit -m "feat(m0): add /db-ping endpoint"
```

---

### Task 15: docker-compose for local Postgres

_Why:_ Local dev mirrors production (same Postgres major version). One command spins up a local DB.

**Files:** Create `docker-compose.yml`. Create `apps/api/.env.local`.

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pyawmal
      POSTGRES_PASSWORD: pyawmal
      POSTGRES_DB: pyawmal
    ports: ['5432:5432']
    volumes:
      - pyawmal-pg:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U pyawmal']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pyawmal-pg:
```

- [ ] **Step 2: Create `apps/api/.env.local`**

```
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL=postgresql://pyawmal:pyawmal@localhost:5432/pyawmal
```

> `.env.local` is in `.gitignore` — do NOT commit secrets even in dev.

- [ ] **Step 3: Bring up Postgres and run the api against it**

```bash
docker compose up -d postgres
pnpm --filter @pyawmal/db generate
pnpm --filter @pyawmal/api dev
```

In another terminal:

```bash
curl http://localhost:3000/health   # expect { ok: true, ... }
curl http://localhost:3000/db-ping  # expect { db: "ok" }
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(m0): docker-compose for local Postgres"
```

---

## Phase 4 — Frontend & Shared (Tasks 16–19)

### Task 16: Scaffold `apps/web` (Next.js)

_Why:_ The frontend is a placeholder in M0 but the package needs to exist so Phase 7 CI/CD can build it.

**Files:** Create `apps/web/{package.json,tsconfig.json,next.config.mjs,app/layout.tsx,app/page.tsx}`.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@pyawmal/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "eslint-config-next": "14.2.5"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "isolatedModules": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

- [ ] **Step 4: Install & run**

```bash
pnpm install
pnpm --filter @pyawmal/web dev
```

Expected: Next.js starts on http://localhost:3001 (page placeholder comes next task).

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(m0): scaffold Next.js web app"
```

---

### Task 17: M0 placeholder page

**Files:** Create `apps/web/app/{layout.tsx,page.tsx,globals.css}`.

- [ ] **Step 1: Create `apps/web/app/globals.css`**

```css
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
```

- [ ] **Step 2: Create `apps/web/app/layout.tsx`**

```tsx
import './globals.css';

export const metadata = { title: 'pyawmal' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main style={{ padding: '4rem', textAlign: 'center' }}>
      <h1>pyawmal</h1>
      <p>M0 placeholder. Auth UI arrives in M1.</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter @pyawmal/web dev
```

Open http://localhost:3001 — expect the placeholder page.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app
git commit -m "feat(m0): placeholder home page for web app"
```

---

### Task 18: Scaffold `packages/shared`

_Why:_ This package holds zod schemas / TypeScript types shared between frontend and backend. In M0 it's empty; M1 fills it with auth request/response schemas.

**Files:** Create `packages/shared/{package.json,tsconfig.json,src/index.ts}`.

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@pyawmal/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p .",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared/src/index.ts`**

```ts
import { z } from 'zod';

// Placeholder schema so the package compiles. M1 replaces this with real auth schemas.
export const PlaceholderSchema = z.object({ ok: z.boolean() });
export type Placeholder = z.infer<typeof PlaceholderSchema>;
```

- [ ] **Step 4: Build & verify**

```bash
pnpm install
pnpm --filter @pyawmal/shared build
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(m0): scaffold @pyawmal/shared package"
```

---

### Task 19: Wire `@pyawmal/shared` into both apps

- [ ] **Step 1: Add as workspace dependency in `apps/api/package.json` and `apps/web/package.json`**

```json
"@pyawmal/shared": "workspace:*"
```

Run:

```bash
pnpm install
```

- [ ] **Step 2: Sanity-import in each app**

`apps/api/src/server.ts` — add (then leave it; M1 will use it):

```ts
import { PlaceholderSchema as _Placeholder } from '@pyawmal/shared';
void _Placeholder;
```

`apps/web/app/page.tsx` — add at top:

```ts
import { PlaceholderSchema as _Placeholder } from '@pyawmal/shared';
void _Placeholder;
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps pnpm-lock.yaml
git commit -m "feat(m0): wire shared package into api and web"
```

---

## Phase 5 — Terraform Foundation (Tasks 20–22)

### Task 20: Terraform state backend (one-time bootstrap)

_Why:_ Terraform state needs to live somewhere durable so multiple developers / CI can share it. An S3 bucket + DynamoDB lock table is the standard pattern. This task uses **local state** to provision those resources, then later environments use the bucket as their **remote backend**.

**Files:** Create `infra/bootstrap/{main,providers,variables}.tf`.

- [ ] **Step 1: Create `infra/bootstrap/providers.tf`**

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}

provider "aws" {
  region = var.region
}
```

- [ ] **Step 2: Create `infra/bootstrap/variables.tf`**

```hcl
variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "project" {
  type    = string
  default = "pyawmal"
}
```

- [ ] **Step 3: Create `infra/bootstrap/main.tf`**

```hcl
resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tflock" {
  name         = "${var.project}-tflock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute { name = "LockID" type = "S" }
}

data "aws_caller_identity" "current" {}

output "state_bucket" { value = aws_s3_bucket.tfstate.bucket }
output "lock_table"   { value = aws_dynamodb_table.tflock.name }
```

- [ ] **Step 4: Apply**

```bash
cd infra/bootstrap
terraform init
terraform apply
```

Save the outputs (`state_bucket` and `lock_table`).

- [ ] **Step 5: Commit**

```bash
cd ../..
git add infra/bootstrap
git commit -m "feat(m0): terraform bootstrap (state bucket + lock table)"
```

---

### Task 21: Dev environment scaffold

**Files:** Create `infra/envs/dev/{providers,backend,variables,outputs}.tf`.

- [ ] **Step 1: Create `infra/envs/dev/backend.tf`** (using the bucket name from Task 20 output)

```hcl
terraform {
  backend "s3" {
    bucket         = "pyawmal-tfstate-<YOUR_ACCOUNT_ID>"
    key            = "envs/dev/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "pyawmal-tflock"
    encrypt        = true
  }
}
```

- [ ] **Step 2: Create `infra/envs/dev/providers.tf`**

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = var.project, Environment = var.env } }
}
```

- [ ] **Step 3: Create `infra/envs/dev/variables.tf`**

```hcl
variable "region"  { type = string  default = "ap-southeast-1" }
variable "project" { type = string  default = "pyawmal" }
variable "env"     { type = string  default = "dev" }
```

- [ ] **Step 4: Create `infra/envs/dev/outputs.tf`** (empty for now; we'll add as resources land)

```hcl
# Outputs added as resources are created in later tasks.
```

- [ ] **Step 5: Init**

```bash
cd infra/envs/dev
terraform init
```

- [ ] **Step 6: Commit**

```bash
cd ../../..
git add infra/envs/dev
git commit -m "feat(m0): scaffold dev terraform environment"
```

---

### Task 22: VPC module

**Files:** Create `infra/modules/vpc/{main,variables,outputs}.tf`. Create `infra/envs/dev/network.tf`.

- [ ] **Step 1: Create `infra/modules/vpc/variables.tf`**

```hcl
variable "project"      { type = string }
variable "env"          { type = string }
variable "cidr"         { type = string  default = "10.0.0.0/16" }
variable "azs"          { type = list(string) }
variable "public_cidrs" { type = list(string) }
variable "private_cidrs"{ type = list(string) }
```

- [ ] **Step 2: Create `infra/modules/vpc/main.tf`**

```hcl
resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${var.project}-${var.env}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.project}-${var.env}-igw" }
}

resource "aws_subnet" "public" {
  count                   = length(var.public_cidrs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_cidrs[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${var.project}-${var.env}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = length(var.private_cidrs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_cidrs[count.index]
  availability_zone = var.azs[count.index]
  tags = { Name = "${var.project}-${var.env}-private-${count.index}" }
}

resource "aws_eip" "nat" { domain = "vpc" }

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.project}-${var.env}-nat" }
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.project}-${var.env}-public-rt" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }
  tags = { Name = "${var.project}-${var.env}-private-rt" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
```

- [ ] **Step 3: Create `infra/modules/vpc/outputs.tf`**

```hcl
output "vpc_id"          { value = aws_vpc.this.id }
output "public_subnets"  { value = aws_subnet.public[*].id }
output "private_subnets" { value = aws_subnet.private[*].id }
```

- [ ] **Step 4: Create `infra/envs/dev/network.tf`**

```hcl
module "vpc" {
  source         = "../../modules/vpc"
  project        = var.project
  env            = var.env
  azs            = ["ap-southeast-1a", "ap-southeast-1b"]
  public_cidrs   = ["10.0.0.0/24", "10.0.1.0/24"]
  private_cidrs  = ["10.0.10.0/24", "10.0.11.0/24"]
}
```

- [ ] **Step 5: Plan & apply**

```bash
cd infra/envs/dev
terraform init
terraform plan -out vpc.tfplan
terraform apply vpc.tfplan
```

Expected: VPC, 4 subnets, IGW, NAT GW, route tables created.

- [ ] **Step 6: Commit**

```bash
cd ../../..
git add infra/modules/vpc infra/envs/dev/network.tf
git commit -m "feat(m0): VPC with public+private subnets across 2 AZs"
```

---

## Phase 6 — AWS Resources (Tasks 23–29)

### Task 23: Security Groups

**Files:** Create `infra/envs/dev/security.tf`.

- [ ] **Step 1: Create `infra/envs/dev/security.tf`**

```hcl
resource "aws_security_group" "alb" {
  name        = "${var.project}-${var.env}-alb"
  vpc_id      = module.vpc.vpc_id
  description = "Public ingress to ALB"
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name        = "${var.project}-${var.env}-ecs"
  vpc_id      = module.vpc.vpc_id
  description = "ECS tasks; only ALB may reach :3000"
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-${var.env}-rds"
  vpc_id      = module.vpc.vpc_id
  description = "RDS; only ECS tasks may reach :5432"
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
}
```

- [ ] **Step 2: Apply**

```bash
cd infra/envs/dev
terraform apply
```

- [ ] **Step 3: Commit**

```bash
cd ../../..
git add infra/envs/dev/security.tf
git commit -m "feat(m0): security groups (alb, ecs, rds)"
```

---

### Task 24: RDS Postgres + Secrets Manager

**Files:** Create `infra/envs/dev/rds.tf`.

- [ ] **Step 1: Create `infra/envs/dev/rds.tf`**

```hcl
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project}-${var.env}-db"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "postgres" {
  identifier              = "${var.project}-${var.env}"
  engine                  = "postgres"
  engine_version          = "16.3"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_encrypted       = true
  db_name                 = "pyawmal"
  username                = "pyawmal"
  password                = random_password.db.result
  vpc_security_group_ids  = [aws_security_group.rds.id]
  db_subnet_group_name    = aws_db_subnet_group.this.name
  publicly_accessible     = false
  skip_final_snapshot     = true
  backup_retention_period = 7
  apply_immediately       = true
}

resource "aws_secretsmanager_secret" "db_url" {
  name = "${var.project}/${var.env}/DATABASE_URL"
}

resource "aws_secretsmanager_secret_version" "db_url" {
  secret_id     = aws_secretsmanager_secret.db_url.id
  secret_string = "postgresql://${aws_db_instance.postgres.username}:${random_password.db.result}@${aws_db_instance.postgres.address}:5432/${aws_db_instance.postgres.db_name}"
}

output "db_endpoint" { value = aws_db_instance.postgres.address }
```

- [ ] **Step 2: Add the `random` provider in `providers.tf`**

```hcl
required_providers {
  aws    = { source = "hashicorp/aws", version = "~> 5.60" }
  random = { source = "hashicorp/random", version = "~> 3.6" }
}
```

- [ ] **Step 3: Apply**

```bash
cd infra/envs/dev
terraform init -upgrade
terraform apply
```

Expected: RDS provisioning takes ~5-8 minutes. Secret created.

- [ ] **Step 4: Commit**

```bash
cd ../../..
git add infra/envs/dev/rds.tf infra/envs/dev/providers.tf
git commit -m "feat(m0): RDS Postgres + DATABASE_URL secret"
```

---

### Task 25: ECR repository

**Files:** Create `infra/envs/dev/ecr.tf`.

- [ ] **Step 1: Create `infra/envs/dev/ecr.tf`**

```hcl
resource "aws_ecr_repository" "api" {
  name                 = "${var.project}/api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

output "ecr_url" { value = aws_ecr_repository.api.repository_url }
```

- [ ] **Step 2: Apply + commit**

```bash
cd infra/envs/dev
terraform apply
cd ../../..
git add infra/envs/dev/ecr.tf
git commit -m "feat(m0): ECR repository for api"
```

---

### Task 26: CloudWatch log group

**Files:** Create `infra/envs/dev/logs.tf`.

- [ ] **Step 1: Create `infra/envs/dev/logs.tf`**

```hcl
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project}-${var.env}-api"
  retention_in_days = 14
}
```

- [ ] **Step 2: Apply + commit**

```bash
cd infra/envs/dev
terraform apply
cd ../../..
git add infra/envs/dev/logs.tf
git commit -m "feat(m0): CloudWatch log group for api"
```

---

### Task 27: ECS task execution + task IAM roles

**Files:** Create `infra/envs/dev/iam.tf`.

- [ ] **Step 1: Create `infra/envs/dev/iam.tf`**

```hcl
# Execution role: ECS uses this to pull the image and write logs
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${var.project}-${var.env}-task-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to read the DATABASE_URL secret
resource "aws_iam_role_policy" "task_execution_secrets" {
  role = aws_iam_role.task_execution.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.db_url.arn
    }]
  })
}

# Task role: what the application code can do at runtime (nothing in M0)
resource "aws_iam_role" "task" {
  name               = "${var.project}-${var.env}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
```

- [ ] **Step 2: Apply + commit**

```bash
cd infra/envs/dev
terraform apply
cd ../../..
git add infra/envs/dev/iam.tf
git commit -m "feat(m0): ECS task execution + task IAM roles"
```

---

### Task 28: ECS cluster + task definition + service

**Files:** Create `infra/envs/dev/ecs.tf`.

- [ ] **Step 1: Create `infra/envs/dev/ecs.tf`**

```hcl
resource "aws_ecs_cluster" "this" {
  name = "${var.project}-${var.env}"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project}-${var.env}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = "api"
    image     = "${aws_ecr_repository.api.repository_url}:latest"
    essential = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV",  value = "production" },
      { name = "PORT",      value = "3000" },
      { name = "LOG_LEVEL", value = "info" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.db_url.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${var.project}-${var.env}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.http]
  lifecycle { ignore_changes = [task_definition] }  # CI updates this
}
```

> Note: `aws_lb_target_group.api` and `aws_lb_listener.http` come from Task 29. If you apply in order, ECS service apply will fail until the ALB exists — apply Task 29 before re-applying Task 28's service block.

- [ ] **Step 2: Commit (don't apply yet — wait until Task 29)**

```bash
git add infra/envs/dev/ecs.tf
git commit -m "feat(m0): ECS cluster, task definition, service"
```

---

### Task 29: ALB + target group + listener

**Files:** Create `infra/envs/dev/alb.tf`.

- [ ] **Step 1: Create `infra/envs/dev/alb.tf`**

```hcl
resource "aws_lb" "this" {
  name               = "${var.project}-${var.env}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnets
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project}-${var.env}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

output "alb_dns" { value = aws_lb.this.dns_name }
```

- [ ] **Step 2: Apply everything (ALB + ECS)**

```bash
cd infra/envs/dev
terraform apply
```

Expected: ALB created, ECS task starts, health checks pass after ~1-2 minutes.

- [ ] **Step 3: Verify**

```bash
curl http://$(terraform output -raw alb_dns)/health
```

Expected: `{ "ok": true, ... }`. (The first deployed image is the placeholder — Task 33 will push the real one. If the image doesn't exist yet, the ECS service will fail to start; that's fine, fix it after Task 33.)

- [ ] **Step 4: Commit**

```bash
cd ../../..
git add infra/envs/dev/alb.tf
git commit -m "feat(m0): ALB + target group + HTTP listener"
```

---

## Phase 7 — CI/CD (Tasks 30–32)

### Task 30: GitHub OIDC provider + Actions role

_Why:_ OIDC lets GitHub Actions assume an AWS role without any long-lived AWS keys. The role's trust policy restricts which repo/branch can assume it.

**Files:** Create `infra/envs/dev/github-oidc.tf`.

- [ ] **Step 1: Create `infra/envs/dev/github-oidc.tf`**

```hcl
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

variable "github_repo" {
  type        = string
  description = "owner/repo (e.g. yourname/pyawmal)"
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main", "repo:${var.github_repo}:pull_request"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.project}-${var.env}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

resource "aws_iam_role_policy" "github_actions" {
  role = aws_iam_role.github_actions.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability","ecr:PutImage","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:BatchGetImage"], Resource = aws_ecr_repository.api.arn },
      { Effect = "Allow", Action = ["ecs:UpdateService","ecs:DescribeServices","ecs:RegisterTaskDefinition","ecs:DescribeTaskDefinition"], Resource = "*" },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = [aws_iam_role.task.arn, aws_iam_role.task_execution.arn] }
    ]
  })
}

output "github_actions_role_arn" { value = aws_iam_role.github_actions.arn }
```

- [ ] **Step 2: Add the `tls` provider in `providers.tf`**

```hcl
required_providers {
  aws    = { source = "hashicorp/aws", version = "~> 5.60" }
  random = { source = "hashicorp/random", version = "~> 3.6" }
  tls    = { source = "hashicorp/tls", version = "~> 4.0" }
}
```

- [ ] **Step 3: Apply (set `github_repo` to your `owner/repo`)**

```bash
cd infra/envs/dev
terraform init -upgrade
terraform apply -var "github_repo=YOUR_OWNER/YOUR_REPO"
```

Note the `github_actions_role_arn` output.

- [ ] **Step 4: Commit**

```bash
cd ../../..
git add infra/envs/dev/github-oidc.tf infra/envs/dev/providers.tf
git commit -m "feat(m0): GitHub OIDC provider + Actions role"
```

---

### Task 31: PR workflow

**Files:** Create `.github/workflows/ci.yml`.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test

  terraform:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ap-southeast-1
      - uses: hashicorp/setup-terraform@v3
        with: { terraform_version: 1.7.5 }
      - working-directory: infra/envs/dev
        run: |
          terraform init
          terraform fmt -check -recursive
          terraform validate
          terraform plan -var "github_repo=${{ github.repository }}"
```

- [ ] **Step 2: Add the `AWS_ROLE_ARN` GitHub secret**

In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret.
Name: `AWS_ROLE_ARN`. Value: the `github_actions_role_arn` from Task 30.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(m0): PR CI workflow (lint, typecheck, test, tf plan)"
```

---

### Task 32: Deploy workflow

**Files:** Create `.github/workflows/deploy.yml`.

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy
on:
  push:
    branches: [main]

concurrency:
  group: deploy-dev
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ap-southeast-1

      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }

      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test

      - id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, push
        env:
          REGISTRY: ${{ steps.ecr.outputs.registry }}
          REPO: pyawmal/api
          TAG: ${{ github.sha }}
        run: |
          docker build -t $REGISTRY/$REPO:$TAG -t $REGISTRY/$REPO:latest -f apps/api/Dockerfile .
          docker push $REGISTRY/$REPO:$TAG
          docker push $REGISTRY/$REPO:latest

      - name: Force ECS service update
        run: |
          aws ecs update-service \
            --cluster pyawmal-dev \
            --service pyawmal-dev-api \
            --force-new-deployment \
            --region ap-southeast-1

      - name: Wait for service to stabilise
        run: |
          aws ecs wait services-stable \
            --cluster pyawmal-dev \
            --services pyawmal-dev-api \
            --region ap-southeast-1

      - name: Smoke test
        run: |
          ALB=$(aws elbv2 describe-load-balancers --names pyawmal-dev-alb --query 'LoadBalancers[0].DNSName' --output text --region ap-southeast-1)
          for i in {1..30}; do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://$ALB/health)
            if [ "$STATUS" = "200" ]; then echo "✅ live"; exit 0; fi
            echo "attempt $i: $STATUS"
            sleep 5
          done
          echo "❌ /health did not return 200"; exit 1
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(m0): deploy workflow (build, push, deploy, smoke)"
```

---

## Phase 8 — First Deploy & Verification (Tasks 33–34)

### Task 33: First deploy

- [ ] **Step 1: Push everything to `main`**

```bash
git push origin main
```

- [ ] **Step 2: Watch the Actions tab on GitHub**

Expected timeline:

- Install + checks: ~2 min
- Build + push image: ~3 min
- ECS update + wait: ~2 min
- Smoke test: ~30 s

- [ ] **Step 3: If the deploy fails, common causes**

- ECS task can't pull image → check execution role permissions (Task 27).
- Task fails health check → check CloudWatch log group `/ecs/pyawmal-dev-api` for application errors.
- `/health` returns 503 → check that `loadEnv()` accepts whatever DATABASE_URL was injected (Task 7).

### Task 34: Manual verification

- [ ] **Step 1: Hit the live URL**

```bash
ALB=$(cd infra/envs/dev && terraform output -raw alb_dns)
curl http://$ALB/health
curl http://$ALB/db-ping
```

Expected: both endpoints return 200 with `ok`/`db: ok`.

- [ ] **Step 2: Tail CloudWatch logs**

```bash
aws logs tail /ecs/pyawmal-dev-api --follow --region ap-southeast-1
```

Expected: structured JSON log lines, each with a `reqId` field on request logs.

- [ ] **Step 3: Make a trivial change and merge to main**

E.g. update the `/health` response to include `{ env: 'dev' }`. Open a PR. Watch CI pass. Merge. Watch deploy. Verify the change is live within 10 minutes (this validates the M0 PRD success metric).

- [ ] **Step 4: Mark M0 complete**

```bash
git commit --allow-empty -m "chore(m0): milestone complete"
git push
```

M0 is shipped. Next milestone: M1 — Authentication.

---

## Cost note

Expected monthly AWS cost for M0 alone (Singapore, dev usage):

- ECS Fargate (256 CPU / 512 MB, 1 task): ~$9
- ALB: ~$16
- RDS t4g.micro: ~$13 (free tier first 12 months)
- NAT Gateway: ~$32 ← biggest line
- Route 53 / ECR / CloudWatch / Secrets Manager: ~$3
- **Total: ~$50-75/mo**
