# Terraform — From Scratch

> Companion to M0. Reference doc for Tasks 20–30 (Terraform bootstrap + all AWS resource provisioning).

---

## 1. The mental model: a reconciliation loop

```
            ┌───────────────────────────┐
            │   Desired state (.tf)     │   you write this
            └─────────────┬─────────────┘
                          │
                          ▼
            ┌───────────────────────────┐
            │     Terraform Engine      │   compares all three
            └─────────────┬─────────────┘
                          │
       ┌──────────────────┼──────────────────┐
       │                                       │
       ▼                                       ▼
┌──────────────┐                    ┌───────────────────────┐
│  Recorded    │                    │  Actual state         │
│  state file  │                    │  (queried via AWS API) │
└──────────────┘                    └───────────────────────┘
```

Each `terraform apply` is one cycle: read config → read state → query cloud → compute plan → execute → update state.

---

## 2. HCL — the configuration language

### Resources
```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
}
```
Format: `resource "<TYPE>" "<NAME>"`. Reference via `aws_vpc.main.id`.

### Data sources (read-only lookups)
```hcl
data "aws_caller_identity" "current" {}
```

### Providers (plugins)
```hcl
provider "aws" { region = "ap-southeast-1" }
```

### Variables
```hcl
variable "env" { type = string, default = "dev" }
# Used as: var.env
```

### Outputs
```hcl
output "alb_dns" { value = aws_lb.this.dns_name }
# Read via: terraform output -raw alb_dns
```

### Locals
```hcl
locals { name_prefix = "${var.project}-${var.env}" }
# Used as: local.name_prefix
```

### References create dependencies
`aws_subnet.public { vpc_id = aws_vpc.main.id }` tells Terraform: create the VPC first. You never specify order explicitly; the dependency graph is inferred.

---

## 3. The state file

`terraform.tfstate` is a JSON document mapping `(resource type, name) → cloud ID + attributes`.

**Why it exists:** cloud APIs have no "list everything I own" endpoint. Without state, Terraform couldn't know whether a resource already exists or needs creation.

**State holds:**
1. Resource address → cloud ID mapping.
2. Last-observed attributes.
3. Metadata (Terraform version, lineage UUID, serial number).

**State is sacred:**
- Lose state → infrastructure still runs, but Terraform has no idea what's yours.
- Corrupt state → next apply is incoherent.
- Secrets land in state (RDS passwords, random_password, OAuth client secrets) → state must be encrypted.

### State backends

```hcl
terraform {
  backend "s3" {
    bucket         = "pyawmal-tfstate-123"
    key            = "envs/dev/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "pyawmal-tflock"
    encrypt        = true
  }
}
```

| Backend | When |
|---|---|
| `local` | Solo experiments only — no locking, no sharing |
| `s3` + DynamoDB | Team standard — encrypted, versioned, locked |
| Terraform Cloud / HCP | Paid managed; UI, RBAC, remote runs |

### Locking
DynamoDB conditional PUT for `LockID=<state-key>`. Second apply blocks until the first finishes. **The bootstrap config (Task 20) creates the bucket and lock table using local state**, then later environments use them as their remote backend.

---

## 4. Plan/apply lifecycle

```bash
terraform init        # download providers, configure backend
terraform fmt         # auto-format
terraform validate    # syntax + type check
terraform plan        # compute the diff
terraform apply       # execute
terraform destroy     # delete state-managed resources
terraform output      # show last apply's outputs
terraform state list  # show resources in state
terraform state show <addr>
```

### Plan symbols — read religiously

```
  + resource "aws_vpc" "main" {           # CREATE
  ~ resource "aws_subnet" "public" {      # in-place UPDATE
  - resource "aws_eip" "old" {            # DESTROY
  -/+ resource "aws_db_instance" "main" { # REPLACE (destroy then create)
```

| Symbol | Meaning | Safe? |
|---|---|---|
| `+` | Create | Yes |
| `~` | In-place update | Usually yes |
| `-` | Destroy | Read carefully |
| `-/+` | Destroy then create | **Always inspect — possible downtime/data loss** |

### Saved plans
```bash
terraform plan -out=tfplan
# review carefully
terraform apply tfplan
```
Guarantees you apply *exactly* what you reviewed.

---

## 5. Resource lifecycle blocks

```hcl
resource "aws_db_instance" "main" {
  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
    ignore_changes        = [password]
  }
}
```

| Flag | Effect |
|---|---|
| `create_before_destroy = true` | For replacements, create new first then destroy old. Zero downtime; uniqueness gotchas. |
| `prevent_destroy = true` | Refuse to destroy. Critical for stateful resources (RDS, S3 with data). |
| `ignore_changes = [attr]` | Don't fight reality on this attribute. Common for `task_definition` on ECS service (CI manages it). |

---

## 6. Modules — composition

```hcl
module "vpc" {
  source         = "../../modules/vpc"
  project        = var.project
  azs            = ["ap-southeast-1a", "ap-southeast-1b"]
  public_cidrs   = ["10.0.0.0/24", "10.0.1.0/24"]
  private_cidrs  = ["10.0.10.0/24", "10.0.11.0/24"]
}

# Use the module's outputs
resource "aws_lb" "alb" {
  subnets = module.vpc.public_subnets
}
```

**Sources:** local path, public registry, git URL.

**Design rule:** one module = one responsibility. VPC module creates VPC/subnets/routing — *not* RDS or IAM (those are separate modules).

---

## 7. Drift

Drift = reality changed outside Terraform (console click, AWS auto-rotation, autoscaling adjustment). Next `plan` shows the diff and offers to revert.

Strategies:
1. **Never click the console** for TF-managed resources.
2. `terraform refresh` updates state without changing infra (folded into `plan` now).
3. `terraform import <addr> <id>` brings existing cloud resources into state.
4. `lifecycle { ignore_changes = [...] }` for fields that *should* drift.

---

## 8. Workspaces vs env directories

| Pattern | Pros | Cons |
|---|---|---|
| **Workspaces** (`terraform workspace new staging`) | One config, less duplication | Easy to apply to wrong env — huge blast radius |
| **Env directories** (`infra/envs/dev`, `infra/envs/prod`) | Explicit, safer, CI runs in specific dir | Some duplication (modules mostly eliminate) |

Use env directories. The safety beats the duplication.

---

## 9. Refactoring without recreation — `moved` blocks

Renaming a resource normally triggers destroy + create:

```diff
- resource "aws_vpc" "main" {
+ resource "aws_vpc" "production" {
```

Add a `moved` block:

```hcl
moved {
  from = aws_vpc.main
  to   = aws_vpc.production
}
```

Plan shows no changes — only the state key is renamed.

`moved` works across modules too. Essential for refactoring without downtime.

---

## 10. Common patterns and gotchas

- **Composition via outputs** — modules expose what others consume.
- **Provider aliases** — `provider "aws" { alias = "us", region = "us-east-1" }` for multi-region.
- **`sensitive = true` outputs** — redact in console; state still has the value (encrypt state).
- **`for_each` > `count`** — identity-based vs index-based; `count` shifts indices on deletion.
- **`depends_on = [...]`** — explicit dependency when there's no reference (IAM propagation races).
- **`terraform fmt -recursive`** before committing; CI fails on unformatted.

---

## 11. Our M0 Terraform shape

```
infra/
├── bootstrap/                   one-time with local state to create:
│   └── main.tf                     • S3 state bucket
│                                    • DynamoDB lock table
├── modules/
│   └── vpc/                     reusable VPC + subnets + IGW + NAT
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── envs/
    └── dev/                     the dev environment
        ├── backend.tf            points at the bootstrapped bucket
        ├── providers.tf
        ├── variables.tf
        ├── network.tf            module "vpc" {...}
        ├── security.tf           SGs
        ├── rds.tf                RDS + Secrets Manager
        ├── ecr.tf                ECR
        ├── ecs.tf                ECS cluster + task def + service
        ├── alb.tf                ALB + target group + listener
        ├── iam.tf                task roles
        ├── logs.tf               CloudWatch log group
        ├── github-oidc.tf        GitHub OIDC + Actions role
        └── outputs.tf            alb_dns, db_endpoint, ...
```

When M16 adds `prod`, it's a sibling of `dev` reusing the same modules.

---

## Key takeaways

- Terraform = reconciliation loop between desired config, recorded state, actual cloud.
- State is sacred → S3 backend + DynamoDB lock + encryption.
- Plan symbols: `+` create, `~` in-place, `-` destroy, `-/+` replace (dangerous).
- `lifecycle` block: `create_before_destroy`, `prevent_destroy`, `ignore_changes`.
- Modules = composition; env directories = isolation. Use both.
- Drift = reality changed; `plan` surfaces it; `ignore_changes` for intentional drift.
- `moved` blocks refactor without destruction.
- Workspaces are tempting; env directories are safer.
