# ECR (Elastic Container Registry) — From Scratch

> Companion to M0. Reference doc for Task 25 (ECR repository) and the CI push step in Task 32.

---

## 1. The mental model

Private OCI container registry inside your AWS account. Docker Hub, but yours: IAM-authenticated, in-region, same VPC.

---

## 2. The five things ECR has

| Term             | What                                                    |
| ---------------- | ------------------------------------------------------- |
| Registry         | Account-scoped, one per region, auto-created            |
| Repository       | Named container of one image's versions (`pyawmal/api`) |
| Image            | OCI bytes; identified by digest (`sha256:abc...`)       |
| Tag              | Human label pointing to a digest (mutable by default)   |
| Lifecycle policy | Auto-deletion rules                                     |

Repo URL: `<account>.dkr.ecr.<region>.amazonaws.com/<repo>`.

---

## 3. Repository config

```hcl
resource "aws_ecr_repository" "api" {
  name                 = "pyawmal/api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}
```

### `image_tag_mutability`

- **MUTABLE** (default) — pushing same tag replaces. Risky in prod.
- **IMMUTABLE** — pushing existing tag errors. **Production should be IMMUTABLE.**

M0: `MUTABLE` for `:latest` convenience. M16: flip to IMMUTABLE + force commit-SHA tags only.

### `force_delete = true`

Allows `terraform destroy` to delete repo with images. Dev only.

---

## 4. Lifecycle policies

```hcl
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
```

Other selections:

- `tagStatus: "untagged"` — clean dangling (very common).
- `tagPrefixList: ["pr-"]` + count — delete preview-env images.
- `countType: "sinceImagePushed"`, `countUnit: "days"` — age-based.

Rules evaluated in priority order; first match wins.

---

## 5. Image scanning

### Basic (free)

- `scan_on_push = true` runs CVE scan per push (Clair-based).
- Findings → console + EventBridge.

### Enhanced (~$0.09/image-month) — Amazon Inspector

- Continuous re-scan as new CVEs disclosed.
- Container + OS package scanning.

M0: basic. M16: enhanced on production repos.

---

## 6. Authentication

IAM, not username/password.

```bash
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  123.dkr.ecr.ap-southeast-1.amazonaws.com

docker push 123.dkr.ecr.ap-southeast-1.amazonaws.com/pyawmal/api:abc123
```

In CI: `aws-actions/amazon-ecr-login@v2` does both steps.

### IAM actions

For **pushing**:

- `ecr:GetAuthorizationToken` (resource `*`)
- `ecr:BatchCheckLayerAvailability`
- `ecr:PutImage`
- `ecr:InitiateLayerUpload` / `UploadLayerPart` / `CompleteLayerUpload`

For **pulling** (ECS task-execution role):

- `ecr:GetAuthorizationToken`
- `ecr:BatchCheckLayerAvailability`
- `ecr:GetDownloadUrlForLayer`
- `ecr:BatchGetImage`

Managed policy `AmazonECSTaskExecutionRolePolicy` already covers the pull set.

---

## 7. Pull-through cache

ECR acts as caching proxy for public registries (Docker Hub, Quay, GHCR).

```hcl
resource "aws_ecr_pull_through_cache_rule" "dockerhub" {
  ecr_repository_prefix = "dockerhub"
  upstream_registry_url = "registry-1.docker.io"
}
```

Then pull `123.dkr.ecr.ap-southeast-1.amazonaws.com/dockerhub/library/node:20-alpine`.

Benefits: avoids Docker Hub rate limits + outages, faster (in-region).

Not strictly needed M0; useful by M4+.

---

## 8. Cross-account access (M16+)

ECR repo policy grants cross-account pull:

```hcl
resource "aws_ecr_repository_policy" "shared" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    Statement = [{
      Effect = "Allow"
      Principal = { AWS = "arn:aws:iam::<prod-account>:role/ecs-task-exec" }
      Action = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability"]
    }]
  })
}
```

Pattern: one "builder" account hosts ECR; envs pull from there.

---

## 9. Our M0 ECR

```hcl
aws_ecr_repository "api":
  name                 = "pyawmal/api"
  image_tag_mutability = "MUTABLE"         # M0 only; M16 → IMMUTABLE
  scan_on_push         = true

aws_ecr_lifecycle_policy "api":
  rule = "Keep last 10 images"
```

CI tags with `:latest` + `:<sha>`, pushes both. ECS pulls `:latest` on deploy.

---

## 10. Common gotchas

- `MUTABLE` + `:latest` → two engineers stomp each other in prod. Pin commit SHA.
- Missing lifecycle policy → unbounded storage costs.
- Task-execution role missing pull perms → `CannotPullContainerError`.
- ECR in wrong region → cross-region pulls (slow + extra cost).
- Docker Hub rate limits → use pull-through cache.
- Auth token expires after 12h → don't cache it longer.
- Scan findings ignored → wire to EventBridge → Slack so someone reviews.

---

## Key takeaways

- ECR = private OCI registry; IAM-authenticated; per region.
- **IMMUTABLE tags + commit-SHA pinning in production.**
- **Always set a lifecycle policy.**
- Pull-through cache mitigates Docker Hub rate limits.
- Auth = IAM → `get-login-password` → `docker login`; tokens last 12h.
- Cross-account ECR enables shared builder-account pattern.
