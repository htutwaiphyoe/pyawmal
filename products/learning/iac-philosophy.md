# Infrastructure-as-Code Philosophy — From Scratch

> Companion to M0. The "why" behind Terraform, complementing the mechanical Terraform doc.

---

## 1. The mental model

Infrastructure is software too: source-controlled, reviewed, testable, deployable, rollbackable. The state of your infra = the state of your repo.

Benefits:

- Reproducibility (recreate the stack from repo).
- Reviewability (PR review like app code).
- Auditability (git log shows who/what/when).
- Disaster recovery.
- Onboarding (read the repo).
- Collaboration (parallel work without stepping on each other).

Price: **discipline**. The moment someone clicks in the console, the guarantees evaporate.

---

## 2. Pre-IaC nightmare

- Manual provisioning → screenshots → wiki pages → no one remembers.
- Snowflake environments diverging over time.
- Recreating an env = impossible six months later.

This was normal in 2010. Don't slide back.

---

## 3. Declarative vs imperative

### Imperative

"Run these steps."

```bash
aws ec2 create-vpc --cidr 10.0.0.0/16
aws ec2 create-subnet --vpc-id <from-above> ...
```

Easy to read; brittle on rerun; you handle every edge case.

### Declarative (Terraform, CloudFormation, Pulumi, CDK, k8s manifests)

"This is the end state."

```hcl
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
resource "aws_subnet" "public" { vpc_id = aws_vpc.main.id, ... }
```

Idempotent; dependency-aware; safe to rerun.

**Mindset shift:** stop thinking in steps; think in end states.

---

## 4. Idempotency

Same code, same result, every time. Terraform `apply` with no changes does nothing.

Properties enabled:

- Schedule periodic reapply to repair drift.
- Safe CI/CD integration.
- New environments = same config, new context.

When writing custom infra scripts: **make them idempotent.** Check before create. Treat as reconciliation, not procedure.

---

## 5. GitOps mindset

**Git = source of truth.**

- PR → merge → automation applies.
- Drift from repo → repo wins; automation reverts.
- Lose repo → lose operational truth.

Tools like ArgoCD apply this rigorously for k8s. Terraform analog: CI-driven plan + apply on every PR/merge.

M0: apply-from-laptop while bootstrapping. M16: CI-only apply.

---

## 6. Drift and convergence

**Drift** = reality diverged from code. Causes: console clicks, AWS auto-rotations, separate tools.

### Eventual convergence (default with Terraform)

`terraform plan` surfaces drift on next run; engineer decides revert vs accept.

### Continuous reconciliation

Controller runs `apply` on a schedule (every 5 min). Drift reverted automatically. Risky for things that legitimately self-adjust (autoscaling); great for application config (k8s).

We use eventual convergence + plan-in-CI on every PR.

---

## 7. Immutable infrastructure

Never mutate a running server. Bake a new image; roll out new instances; tear down old.

Containers + ECS make this default. Benefits:

- What you tested = what runs.
- Each running version maps to a commit.
- Trivial rollback (redeploy previous image).
- No snowflake servers.

Anti-pattern: SSH-ing into prod to "just check"; ending up changing config. The next deploy erases it; the next outage you can't explain.

---

## 8. Environments as code → parity

Same modules, different variables, across dev/staging/prod. They differ only in scale and risk knobs (`multi_az`, `instance_class`, `backup_retention_period`).

Our `infra/envs/dev/` + `infra/envs/prod/` (later) call shared `infra/modules/*`. Each env = thin variable assignment + module calls.

Trade-off: occasionally prod needs something dev doesn't (alarms, WAF, CDN). Either add a flag in the module or accept slight divergence.

---

## 9. Modules — DRY for infra

Without modules: copy-paste VPC+subnets+IGW+NAT for every env. Drift between envs. Fix in five places.

With modules: encapsulate once, call N times.

But **over-modularising is a sin.** A module with twelve variables and one usage is harder to read than the raw resources.

Rules:

- **Single responsibility.** "VPC module" creates VPC + subnets + routing only.
- **Small interface.** 5 inputs OK; 15 is a smell.
- **Outputs consumers need.** Not 47 attributes.
- **Versioned if shared across repos.**
- **Default to flat resources first; extract module only when you have a real second caller.**

---

## 10. Secrets in IaC

Resources committed to git. Secrets must NOT.

Patterns:

- **Reference, never embed** — Terraform reads ARNs; value lives in Secrets Manager.
- **Generate at apply time** — `random_password`; lands in state, not code.
- **Bootstrap then rotate** — Terraform sets initial; out-of-band rotates; Terraform `ignore_changes` after.
- **External secret stores** — SOPS, sealed-secrets, or Secrets Manager.

**State files contain secrets** — even when configs don't. State must be encrypted at rest, access-controlled, never committed.

Task 20: S3 backend with SSE encryption + IAM-locked bucket.

---

## 11. `terraform plan` as review surface

Plans show exactly what will change. Reviewer's job: read the plan, ask "is this what we want?"

Plan symbols matter:

- `+` create — safe.
- `~` in-place update — usually safe.
- `-` destroy — read carefully.
- **`-/+` replacement (destroy then create)** — read VERY carefully. Possible downtime / data loss.

Reading plans is a learned skill. RDS engine-version upgrade looks innocent but triggers an in-place upgrade with possible downtime.

---

## 12. Where IaC ends

IaC manages **infrastructure shape**. Not:

- Runtime application state (DB rows, S3 files) — backups/replication.
- Imperative one-offs (migrations, marketing emails) — scripts or one-shot Lambdas.
- Real-time orchestration (autoscaling, failover) — platform primitives.

Common mistake: managing RDS _contents_ (users, schemas) via Terraform Postgres provider. State explodes; lock contention awful. Use Prisma migrations for schemas; Terraform for the RDS instance around them.

---

## 13. Anti-patterns we'll avoid

| Anti-pattern                                          | Why bad                                |
| ----------------------------------------------------- | -------------------------------------- |
| Manual console changes                                | Drift, lost history, no review         |
| `terraform apply` from laptop to prod                 | No audit trail, no CI gate             |
| One giant `main.tf` per env                           | Unreadable                             |
| Premature modularisation (no second caller)           | Adds complexity without value          |
| Secrets in `.tf` files                                | Leaked to git                          |
| `Resource: "*"` IAM                                   | Privilege creep                        |
| Skipping `plan` for "small" changes                   | The plan would have shown the surprise |
| Long-lived infra branches                             | Conflicts compound                     |
| `terraform destroy` to "start fresh" without snapshot | Catastrophic for stateful              |
| Disabling `prevent_destroy` casually                  | Removes safety net                     |

---

## 14. M0 vs M16 trajectory

**M0 (now):**

- Terraform with S3 + DynamoDB state backend.
- One env directory (`dev/`).
- One reusable module (`vpc/`).
- Plan-in-CI on every PR.
- Apply-from-laptop acceptable while bootstrapping.

**M16 (production hardening):**

- Apply-from-CI only (devs lose write access to prod state).
- Separate AWS accounts for dev/prod.
- IAM permission boundaries.
- `prevent_destroy` on all stateful resources.
- Drift detection scheduled.
- Module library matures.

---

## Key takeaways

- Infrastructure = code. Reviewable, testable, source-controlled.
- **Discipline beats tooling.** No console clicks.
- Declarative + idempotent = central mindset. End states, not steps.
- GitOps: git is the source of truth.
- Drift happens. Eventual convergence (plan-in-CI) is usually enough.
- Immutable infrastructure = predictable, auditable, easy rollback.
- Environments as code → parity by construction.
- Modules for DRY, but only with ≥2 real callers.
- Secrets stay out of code; state encrypted at rest.
- Read `terraform plan` carefully — especially `-/+` replacements.
- IaC manages shape, not data or orchestration.
