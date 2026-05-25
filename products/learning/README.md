# Learning Roadmap

The full catalogue of concepts you'll need to internalise across the pyawmal project. Tracks what's been written into a reference doc here and what's still to come.

**Status legend:** ✓ done · 〰 in progress · ☐ to do

Topics roughly track the milestone they're first introduced in, but most concepts get _reused_ across many milestones — once you learn IAM in M0, you'll use it every milestone after.

---

## Foundation — Cloud, Infra, DevOps (M0)

| #   | Topic                                                                                                           | Status | Doc                                                        |
| --- | --------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| 1   | **AWS Networking** — CIDR, VPC, subnets, AZs, IGW, NAT, route tables, security groups, NACLs                    | ✓      | [aws-networking.md](./aws-networking.md)                   |
| 2   | **IAM** — principals, policies, ARNs, roles + STS, trust vs permission policies, OIDC handshake, `iam:PassRole` | ✓      | [iam.md](./iam.md)                                         |
| 3   | **Terraform** — HCL, state, providers, plan/apply, modules, drift, env separation, refactoring                  | ✓      | [terraform.md](./terraform.md)                             |
| 4   | **ECS Fargate** — task definitions, services, deploys, draining, health checks, debugging                       | ✓      | [ecs-fargate.md](./ecs-fargate.md)                         |
| 5   | **ALB internals** — L4 vs L7, target groups, health checks, listeners, deregistration delay                     | ✓      | [alb.md](./alb.md)                                         |
| 6   | **RDS Postgres** — managed-DB operational model, parameter groups, snapshots, PITR, Multi-AZ                    | ✓      | [rds-postgres.md](./rds-postgres.md)                       |
| 7   | **ECR + container registries** — image lifecycle, scanning, immutable tags vs latest                            | ✓      | [ecr.md](./ecr.md)                                         |
| 8   | **Secrets Manager** — secret storage, versioning, rotation, KMS integration                                     | ✓      | [secrets-manager.md](./secrets-manager.md)                 |
| 9   | **CloudWatch** — log groups + streams, metric filters, alarms, retention                                        | ✓      | [cloudwatch.md](./cloudwatch.md)                           |
| 10  | **Route 53 + DNS** — hosted zones, record types, ACM cert + DNS validation (deferred)                           | ✓      | [route53-dns.md](./route53-dns.md)                         |
| 11  | **Docker / containers** — namespaces, cgroups, image layers, multi-stage builds, OCI                            | ✓      | [docker.md](./docker.md)                                   |
| 12  | **GitHub Actions** — runners, workflows, secrets, OIDC, matrix builds, concurrency groups                       | ✓      | [github-actions.md](./github-actions.md)                   |
| 13  | **Trunk-based development** — short-lived branches, always-green main, feature flags                            | ✓      | [trunk-based-development.md](./trunk-based-development.md) |
| 14  | **Infrastructure-as-code philosophy** — declarative vs imperative, drift, GitOps mindset                        | ✓      | [iac-philosophy.md](./iac-philosophy.md)                   |

## Code & Backend Foundations (M0 → M1)

| #   | Topic                                                                                       | Status | Doc |
| --- | ------------------------------------------------------------------------------------------- | ------ | --- |
| 15  | **Node.js runtime** — event loop, async I/O, single-threaded model, when it's wrong         | ☐      | —   |
| 16  | **Fastify** — plugin model, lifecycle hooks, encapsulation contexts, JSON schema validation | ☐      | —   |
| 17  | **Zod** — runtime validation, schema-as-source-of-truth, boundary parsing                   | ☐      | —   |
| 18  | **pnpm workspaces** — symlinked monorepo, lockfile semantics, workspace protocols           | ☐      | —   |
| 19  | **Turborepo** — task graph, caching, pipeline definitions, remote cache                     | ☐      | —   |
| 20  | **ESLint + Prettier** — rule design, conflicts with formatter, custom configs               | ☐      | —   |
| 21  | **Conventional Commits + Husky** — commit-msg hooks, lint scope, changelog generation       | ☐      | —   |
| 22  | **TypeScript at the backend** — strict mode, `noUncheckedIndexedAccess`, NodeNext modules   | ☐      | —   |

## Database (M0 → M1)

| #   | Topic                                                                                    | Status | Doc |
| --- | ---------------------------------------------------------------------------------------- | ------ | --- |
| 23  | **PostgreSQL fundamentals** — ACID, MVCC, isolation levels, vacuum, autovacuum           | ☐      | —   |
| 24  | **SQL theory** — joins, aggregations, query planner, EXPLAIN, sargability                | ☐      | —   |
| 25  | **Indexing** — B-tree, partial, multi-column, covering, when _not_ to index              | ☐      | —   |
| 26  | **Prisma** — schema → migration → typed client, query engine, raw queries                | ☐      | —   |
| 27  | **Migrations discipline** — forward-only, backwards-compatible, blue/green safe          | ☐      | —   |
| 28  | **Connection pooling** — PgBouncer, transaction vs session mode, why it matters at scale | ☐      | —   |
| 29  | **N+1 problem** — what causes it, how Prisma's `include` solves it                       | ☐      | —   |

## Authentication (M1)

| #   | Topic                                                                                     | Status | Doc |
| --- | ----------------------------------------------------------------------------------------- | ------ | --- |
| 30  | **Password hashing** — argon2 vs bcrypt vs scrypt, parameters, timing attacks             | ☐      | —   |
| 31  | **JWT vs sessions** — stateless vs stateful, when to use each                             | ☐      | —   |
| 32  | **Refresh-token rotation** — sliding sessions, replay detection, revocation               | ☐      | —   |
| 33  | **httpOnly cookies** — SameSite, Secure, the CSRF threat model                            | ☐      | —   |
| 34  | **OAuth 2.0 + OIDC** — Authorization Code + PKCE, state, nonce, ID tokens                 | ☐      | —   |
| 35  | **Email infrastructure (SES)** — SPF, DKIM, DMARC, sandbox vs production, bounce handling | ☐      | —   |
| 36  | **Rate limiting** — token bucket, leaky bucket, sliding window, where to enforce          | ☐      | —   |
| 37  | **CORS** — the actual mechanism, preflight, credentials, common misconfigurations         | ☐      | —   |

## Real-time messaging (M3 → M6)

| #   | Topic                                                                          | Status | Doc |
| --- | ------------------------------------------------------------------------------ | ------ | --- |
| 38  | **WebSocket protocol** — handshake, frames, ping/pong, close codes             | ☐      | —   |
| 39  | **Sticky sessions on ALB** — why WS needs them, target group stickiness        | ☐      | —   |
| 40  | **Fan-out patterns** — direct, hub, pub/sub-backed                             | ☐      | —   |
| 41  | **Redis** — data structures, ephemeral state, pub/sub semantics, persistence   | ☐      | —   |
| 42  | **ElastiCache Redis** — clustering, failover, parameter groups                 | ☐      | —   |
| 43  | **Presence patterns** — heartbeats, last-seen, multi-device                    | ☐      | —   |
| 44  | **Idempotency** — keys, retries, exactly-once vs at-least-once                 | ☐      | —   |
| 45  | **Cursor pagination** — vs offset, keyset queries, stable sort orders          | ☐      | —   |
| 46  | **Optimistic UI** — server-authoritative reconciliation, message status states | ☐      | —   |

## Media — images, voice (M8 → M9)

| #   | Topic                                                                     | Status | Doc |
| --- | ------------------------------------------------------------------------- | ------ | --- |
| 47  | **S3** — buckets, objects, versioning, lifecycle, presigned URLs          | ☐      | —   |
| 48  | **Direct-to-S3 uploads** — presigned PUT/POST, security implications      | ☐      | —   |
| 49  | **Image processing** — sharp/imagemagick, on-the-fly vs on-upload         | ☐      | —   |
| 50  | **CloudFront CDN** — distributions, origin, cache behaviours, signed URLs | ☐      | —   |
| 51  | **Audio handling** — formats, codecs (Opus/AAC), recording in the browser | ☐      | —   |

## Push notifications + multi-device (M10 → M11)

| #   | Topic                                                                       | Status | Doc |
| --- | --------------------------------------------------------------------------- | ------ | --- |
| 52  | **Web Push + VAPID** — service workers, subscription objects, push protocol | ☐      | —   |
| 53  | **APNs / FCM** — token-based auth, payload format, silent vs visible        | ☐      | —   |
| 54  | **Device registry** — token lifecycle, invalidation, multi-device fanout    | ☐      | —   |
| 55  | **Cross-device event sync** — last-read markers, vector clocks (lite)       | ☐      | —   |

## Background jobs + offline (M12)

| #   | Topic                                                                        | Status | Doc |
| --- | ---------------------------------------------------------------------------- | ------ | --- |
| 56  | **Queues** — BullMQ vs SQS, delivery semantics, dead-letter queues           | ☐      | —   |
| 57  | **Outbox pattern** — transactional event publishing, idempotent consumers    | ☐      | —   |
| 58  | **Client-side outbox** — IndexedDB queue, retry/backoff, conflict resolution | ☐      | —   |

## WebRTC — calls (M13)

| #   | Topic                                                                    | Status | Doc |
| --- | ------------------------------------------------------------------------ | ------ | --- |
| 59  | **WebRTC** — peer connection, SDP, ICE, media tracks                     | ☐      | —   |
| 60  | **STUN / TURN** — NAT traversal, when each is needed, coturn             | ☐      | —   |
| 61  | **Signaling** — out-of-band, why it's _not_ part of WebRTC, our WS reuse | ☐      | —   |

## E2E encryption (M14)

| #   | Topic                                                                    | Status | Doc |
| --- | ------------------------------------------------------------------------ | ------ | --- |
| 62  | **Public-key crypto basics** — asymmetric vs symmetric, key exchange     | ☐      | —   |
| 63  | **Signal protocol** — X3DH, double ratchet, forward secrecy              | ☐      | —   |
| 64  | **Key management** — per-device keys, identity vs ephemeral, key servers | ☐      | —   |

## Production engineering (M16)

| #   | Topic                                                                            | Status | Doc |
| --- | -------------------------------------------------------------------------------- | ------ | --- |
| 65  | **Observability** — logs/metrics/traces, RED method, USE method                  | ☐      | —   |
| 66  | **SLOs / SLIs / SLAs** — defining, measuring, error budgets                      | ☐      | —   |
| 67  | **Runbooks** — incident playbooks, on-call, postmortems                          | ☐      | —   |
| 68  | **Auto-scaling** — target tracking, step scaling, predictive                     | ☐      | —   |
| 69  | **AWS WAF** — rules, rate-based rules, managed rule groups                       | ☐      | —   |
| 70  | **Multi-AZ posture** — failure domains, RTO/RPO, graceful degradation            | ☐      | —   |
| 71  | **Load testing** — k6, capacity planning, soak vs spike vs stress tests          | ☐      | —   |
| 72  | **Cost engineering** — Cost Explorer, savings plans, reserved instances, tagging | ☐      | —   |
