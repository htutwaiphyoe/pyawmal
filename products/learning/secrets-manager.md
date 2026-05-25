# AWS Secrets Manager — From Scratch

> Companion to M0. Reference doc for the secrets portion of Task 24 (DATABASE_URL secret).

---

## 1. The mental model

Env vars are visible (in `ps`, memory dumps, accidental logs) and don't rotate. A dedicated secret store gives you encryption at rest, audit log, IAM gating, versioning, and rotation. Use Secrets Manager for credentials, API tokens, signing keys.

---

## 2. Secrets Manager vs SSM Parameter Store

|                          | Secrets Manager                    | Parameter Store                             |
| ------------------------ | ---------------------------------- | ------------------------------------------- |
| Purpose                  | Secrets with rotation              | Config (SecureString supports secrets)      |
| Auto-rotation            | First-class, Lambda templates      | Not built-in                                |
| Cost                     | $0.40/secret/month + $0.05/10k API | Standard tier free; Advanced $0.05/param/mo |
| Max size                 | 64 KB                              | 4-8 KB                                      |
| Cross-region replication | Native                             | Manual                                      |
| Resource policies        | Yes                                | Advanced only                               |

**Use Secrets Manager** for things that rotate or are genuinely secret. **Use Parameter Store** for non-secret config + cheap secrets that don't rotate.

---

## 3. Anatomy of a secret

```
Secret (name, ARN)
 ├── Version 1 — label: AWSPREVIOUS
 ├── Version 2 — label: AWSCURRENT
 └── Version 3 — label: AWSPENDING  (during rotation)
```

Stable name+ARN; versions hold values; **staging labels** coordinate access.

- `AWSCURRENT` — default returned by `GetSecretValue`.
- `AWSPREVIOUS` — last current; useful for rollback.
- `AWSPENDING` — being rotated; promoted to CURRENT on success.

Custom labels allowed (`STAGING`, `CANARY`).

---

## 4. Encryption (KMS)

### `aws/secretsmanager` (AWS-managed)

Free, can't grant cross-account, can't audit.

### Customer-managed KMS key (CMK)

~$1/mo, fine-grained policies, required for cross-account, CloudTrail-audited.

M0: AWS-managed. M16: customer-managed for prod.

---

## 5. Rotation

### Manual

```bash
aws secretsmanager put-secret-value \
  --secret-id pyawmal/dev/DATABASE_URL \
  --secret-string "..."
```

New version → AWSCURRENT; old → AWSPREVIOUS.

### Automatic (Lambda + schedule)

```hcl
resource "aws_secretsmanager_secret_rotation" "db" {
  secret_id           = aws_secretsmanager_secret.db_url.id
  rotation_lambda_arn = aws_lambda_function.rotator.arn
  rotation_rules { automatically_after_days = 30 }
}
```

AWS publishes Lambda templates: RDS Postgres/MySQL/etc.

**Catch:** rotation requires app-side cooperation (Postgres template uses two alternating DB users). Defer until app handles this.

---

## 6. Access via IAM

```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": "arn:aws:secretsmanager:ap-southeast-1:123:secret:pyawmal/dev/DATABASE_URL-*"
}
```

**Trailing `-*` is mandatory** — Secrets Manager appends 6 random chars to ARNs.

Resource policies on the secret enable cross-account.

Useful conditions: `aws:SourceVpce`, `aws:SourceIp`, `secretsmanager:VersionStage`.

---

## 7. ECS integration

Task definition:

```jsonc
"secrets": [
  { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:...:secret:pyawmal/dev/DATABASE_URL-xY8c" }
]
```

At task startup:

1. ECS agent reads task def.
2. For each `secrets[]` entry, calls `GetSecretValue` using **execution role**.
3. Value injected as env var.
4. Container starts; `process.env.DATABASE_URL` populated.

Application code is identical to using `environment[]`. The win: secret value never appears in task definition JSON (visible to anyone with `ecs:DescribeTaskDefinition`).

For JSON-valued secrets, sub-key syntax:

```
"valueFrom": "<secret-arn>:host::"
```

---

## 8. Cost

- $0.40/secret/month
- $0.05/10,000 API calls

ECS reads on every new task launch → essentially free for typical deploy frequency. Secret count dominates.

**Consolidate** related secrets into one JSON blob; reference sub-keys.

---

## 9. Our M0 setup

```hcl
resource "random_password" "db" { length = 32 }

resource "aws_secretsmanager_secret" "db_url" {
  name = "pyawmal/dev/DATABASE_URL"
}

resource "aws_secretsmanager_secret_version" "db_url" {
  secret_id     = aws_secretsmanager_secret.db_url.id
  secret_string = "postgresql://${aws_db_instance.postgres.username}:${random_password.db.result}@${aws_db_instance.postgres.address}:5432/${aws_db_instance.postgres.db_name}"
}
```

Task-execution role allows `secretsmanager:GetSecretValue` on `<secret-arn>-*`.

> **Caveat:** the value lands in Terraform state. State is encrypted in S3 but anyone with state-read access can see the password. M16: bootstrap-then-rotate so password Terraform sets is rotated to one it doesn't know.

---

## 10. Common gotchas

- **Missing `-*` on ARN** → cryptic "Resource not found."
- **Secret in Terraform state** → bootstrap-then-rotate; or `lifecycle { ignore_changes = [secret_string] }` after first write.
- **Stale tasks after rotation** → existing tasks have old value in env; force redeploy.
- **Cross-region** → Secrets Manager is regional. Use replication or duplicate.
- **`aws/` prefix in name** → reserved; fails oddly.
- **Deleting** → 7-day recovery window by default; `--force-delete-without-recovery` to skip.
- **Version accumulation** with frequent rotation → AWS auto-deletes after 100; set tighter retention if needed.

---

## Key takeaways

- Vault with IAM + KMS + rotation + versioning.
- Use for credentials/tokens; Parameter Store for non-secret config.
- Stable name+ARN; versions hold values; staging labels coordinate rotation.
- ECS `secrets[]` block fetches at startup via execution role; secret never in task def JSON.
- IAM policies need `-*` ARN suffix.
- Rotation needs app-side dual-credential handling; defer until ready.
- $0.40/secret/mo — consolidate when possible.
