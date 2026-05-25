# IAM — From Scratch

> Companion to M0. Reference doc for Tasks 27, 30 (IAM roles + GitHub OIDC).

---

## 1. The mental model: keycards in an office building

Every door is locked by default. To open one, you swipe a **keycard** that (a) identifies you, (b) lists which doors you can open, (c) sometimes adds conditions ("only between 9am–5pm").

IAM is the same: every AWS API call goes through a keycard check. `s3:GetObject`, `ecs:UpdateService`, `iam:PassRole` — all of them. **AWS denies by default**; a new IAM user can do nothing until you explicitly grant permissions.

---

## 2. The six concepts

| Term | One-line definition |
|---|---|
| **Principal** | *Who* is acting — person, role session, AWS service, or federated identity |
| **Action** | *What* they want to do — always `service:Operation` (e.g., `s3:GetObject`) |
| **Resource** | *Which* AWS object — always an ARN |
| **Condition** | *Under what circumstances* — JSON predicates |
| **Policy** | A JSON document binding Effect + Action + Resource + Condition |
| **Trust policy** | A special policy on a Role saying *who is allowed to assume it* |

---

## 3. ARNs — the universal naming scheme

```
arn:aws:<service>:<region>:<account-id>:<resource-path>
```

```
arn:aws:s3:::pyawmal-tfstate-123                ← bucket (no region/account)
arn:aws:s3:::pyawmal-tfstate-123/envs/dev/state ← object (path after /)
arn:aws:iam::123:role/pyawmal-dev-task          ← IAM is global (no region)
arn:aws:ecs:ap-southeast-1:123:service/cluster/api
```

Wildcards work: `arn:aws:s3:::pyawmal-*`. Bucket and bucket objects are separate ARNs — bucket policies usually list both.

---

## 4. Policy anatomy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadingSecret",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": ["arn:aws:secretsmanager:...:secret:pyawmal/dev/DATABASE_URL-*"]
    },
    {
      "Sid": "DenyOutsideSingapore",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": { "aws:RequestedRegion": "ap-southeast-1" }
      }
    }
  ]
}
```

- `Version` always `"2012-10-17"`. Not a date.
- `Statement` is an array; each entry is one rule.
- `Effect` is `"Allow"` or `"Deny"`. **Explicit `Deny` always wins.**
- `Action` accepts strings or arrays; wildcards work.
- `Resource` accepts ARNs; `"*"` means any resource (some actions can't be scoped).
- `Condition` uses operators (`StringEquals`, `StringLike`, `IpAddress`, etc.).

**Evaluation:**
1. Start with deny (default).
2. Look at all policies attached.
3. Any matching `Deny` → final: **Deny**.
4. Any matching `Allow` → final: **Allow**.
5. Otherwise → **Deny**.

---

## 5. Identity-based vs resource-based policies

**Identity-based** — attached to a User/Role/Group. `Principal` omitted (implicit).
**Resource-based** — attached to the resource (S3 bucket, KMS key, IAM Role *trust policy*). `Principal` field is required.

Effective permission = union of identity + resource policies, with any explicit `Deny` winning.

Cross-account access usually needs both: source account grants the call via identity policy, target account grants source via resource policy.

---

## 6. Roles + STS — temporary credentials

**IAM User** = persistent identity with long-lived credentials (access key + secret). **Almost never the right answer in production** — leaks happen.

**IAM Role** = identity *without* credentials. Principals call **AWS STS** (Security Token Service) to *assume* the role and get **temporary credentials** valid 15 min – 12 h.

```
Original principal             STS                Temporary credentials
─────────────────              ───                ─────────────────────
ECS service ────────────▶ AssumeRole ────────▶ AccessKeyId
(on task startup)                                SecretAccessKey
                                                 SessionToken
                                                 Expiration: 1h
```

**Three variants:**
| API | Used by |
|---|---|
| `sts:AssumeRole` | IAM users/roles, same or other account |
| `sts:AssumeRoleWithSAML` | SAML-federated (corporate SSO) |
| `sts:AssumeRoleWithWebIdentity` | OIDC-federated (GitHub Actions, others) |

---

## 7. Trust policy vs permission policy

A Role has both. They're orthogonal.

**Trust policy** — exactly one resource-based policy answering "who is allowed to assume me?"

Example for our ECS task role:
```json
{
  "Effect": "Allow",
  "Principal": { "Service": "ecs-tasks.amazonaws.com" },
  "Action": "sts:AssumeRole"
}
```

**Permission policies** — zero or more identity-based policies answering "what can the assumed session do?"

> **Aha moment:** trust and permissions don't reference each other. Trust = "who can become this role." Permissions = "what this role can do once assumed." Both must be satisfied.

---

## 8. GitHub Actions OIDC handshake

### Setup (Task 30, once)

1. Register GitHub as OIDC provider:
```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [<GitHub cert thumbprint>]
}
```

2. Create a role whose trust policy allows the OIDC provider, restricted by JWT claims:
```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::123:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:hwp/pyawmal:ref:refs/heads/main" }
  }
}
```

> Without the `Condition`, any GitHub repo in the world could assume this role.

### Runtime (every workflow run)

3. Workflow declares `permissions: id-token: write`.
4. `configure-aws-credentials` action requests a JWT from GitHub.
5. GitHub generates and signs:
```json
{
  "iss": "https://token.actions.githubusercontent.com",
  "sub": "repo:hwp/pyawmal:ref:refs/heads/main",
  "aud": "sts.amazonaws.com",
  "actor": "hwp",
  "exp": 1716543200
}
```
6. Action calls `sts:AssumeRoleWithWebIdentity` with the JWT.
7. STS verifies JWT signature against GitHub's public keys.
8. STS evaluates trust-policy conditions against JWT claims.
9. All conditions pass → temp credentials returned (1 h default).
10. Action writes creds to env vars; subsequent steps use them.
11. Creds expire in 1 h — useless if leaked outside that window.

**Why it's great:** zero long-lived AWS keys anywhere. Forking the workflow doesn't grant access — the `sub` won't match.

---

## 9. `iam:PassRole` — the trap

When service A wants to *use* role B on your behalf, your principal needs `iam:PassRole` on role B.

When GitHub Actions deploys a new ECS task definition, ECS will use the task role for the running task. **GitHub Actions must have `iam:PassRole` on the task role**, or:

```
AccessDenied: not authorized to perform: iam:PassRole on resource:
arn:aws:iam::123:role/pyawmal-dev-task
```

Mental model: "use this role" is itself a permission. You're not just creating a task — you're *passing* a role to it. The control plane checks.

---

## 10. Our M0 roles, mapped

| Role | Trust (who can assume) | Permissions |
|---|---|---|
| `pyawmal-dev-task-exec` | `ecs-tasks.amazonaws.com` | Pull from ECR, write to CloudWatch, read DATABASE_URL secret |
| `pyawmal-dev-task` | `ecs-tasks.amazonaws.com` | Nothing in M0 (M2+: S3 access etc.) |
| `pyawmal-dev-github-actions` | GitHub OIDC, restricted to `repo:hwp/pyawmal:ref:refs/heads/main` | ECR push, ECS update-service, `iam:PassRole` on the two task roles |

**Why two task roles?**
- **Task execution role** — used by the ECS *agent* at task startup (pull image, fetch secrets, configure logs). Your code never sees these.
- **Task role** — used by your *application code* at runtime. The AWS SDK auto-discovers via the ECS metadata endpoint.

Least-privilege: app code doesn't need ECR pull; the agent doesn't need S3 write.

---

## 11. Common pitfalls

- Forgetting `iam:PassRole` when CI deploys task definitions.
- Trust policy `"Principal": "*"` — anyone in the world can assume.
- Missing OIDC `Condition` → any GitHub repo can assume the role.
- Wildcards in `Resource` on dangerous actions (`iam:CreateRole` etc.).
- Confusing trust and permission policies — they're independent.
- Using IAM Users in production instead of roles.

---

## Key takeaways

- AWS denies by default; explicit `Allow` required.
- `Deny` always wins, can't be overridden by `Allow`.
- Use **Roles + STS**, not IAM Users.
- Trust = "who can become me." Permissions = "what I can do once assumed." Both required.
- OIDC = federated trust between an external IdP and AWS, no static credentials.
- `iam:PassRole` is a separate permission.
- Constrain by `Condition` aggressively, especially `sub` claims on OIDC.
