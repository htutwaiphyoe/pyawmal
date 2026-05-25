# M0 — Infrastructure Foundation: Technical Design

> **Related PRD:** [`../requirements/infrastructure.md`](../requirements/infrastructure.md)
> **Status:** Draft — awaiting user review

## Stack

| Layer                        | Choice                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Backend language             | Node.js 20 + TypeScript                                                                                                     |
| API framework                | Fastify                                                                                                                     |
| Database                     | PostgreSQL 16                                                                                                               |
| ORM                          | Prisma                                                                                                                      |
| Frontend (placeholder in M0) | Next.js 14 (App Router)                                                                                                     |
| Monorepo                     | pnpm workspaces + Turborepo                                                                                                 |
| Cloud                        | AWS — region `ap-southeast-1` (Singapore)                                                                                   |
| Compute                      | ECS Fargate (single task, single AZ for M0)                                                                                 |
| Database hosting             | RDS Postgres (`db.t4g.micro`, single-AZ)                                                                                    |
| Ingress                      | Application Load Balancer (HTTP-only in M0 since no custom domain; HTTPS added when a domain attaches in a later milestone) |
| Image registry               | ECR                                                                                                                         |
| Secrets                      | AWS Secrets Manager                                                                                                         |
| Logs                         | CloudWatch Logs                                                                                                             |
| Infrastructure as code       | Terraform                                                                                                                   |
| CI/CD                        | GitHub Actions (OIDC; no long-lived AWS keys)                                                                               |
| Container                    | Docker (multi-stage build)                                                                                                  |

## Architecture

```
                 Internet
                    │
            ┌───────▼────────┐
            │      ALB       │  public subnet · HTTP only in M0
            └───────┬────────┘
                    │
            ┌───────▼────────────┐
            │  ECS Fargate task  │  private subnet
            │  Fastify API       │  image pulled from ECR
            │  /health, /db-ping │  logs → CloudWatch
            └───────┬────────────┘
                    │
            ┌───────▼────────────┐
            │  RDS Postgres      │  private subnet
            │  empty schema      │  credentials in Secrets Manager
            └────────────────────┘
```

## Why these choices

- **Node.js + TypeScript** — same language family as the frontend; minimal cognitive switching while you learn backend.
- **Fastify** — faster and more structured than Express, first-class TypeScript support.
- **Prisma** — declarative schema, auto-generated migrations, type-safe client; easiest SQL ramp for a frontend-first engineer.
- **PostgreSQL** — relational integrity matters for chat (users, conversations, memberships); the default for real apps.
- **ECS Fargate** — managed containers; no servers to patch; scale by replica count.
- **ALB** — standard L7 load balancer; teaches target groups, health checks, request routing.
- **Terraform** — industry-standard IaC; portable to other clouds; better state model than AWS CDK.
- **GitHub Actions + OIDC** — built into GitHub; OIDC means zero AWS keys in repo or CI secrets.
- **AWS region `ap-southeast-1` (Singapore)** — chosen by user (lowest latency for the target user base).

## CI/CD pipeline

**On every pull request**

- Install dependencies (`pnpm install`).
- Lint, type-check, run unit tests.
- `terraform validate` + `terraform plan` (no apply).

**On merge to `main`**

- Everything above.
- Build the API image (multi-stage Docker).
- Push to ECR.
- Update the ECS service to use the new image (rolling deploy).
- Verify the live ALB URL responds to `/health`.
