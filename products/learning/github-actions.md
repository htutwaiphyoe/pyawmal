# GitHub Actions + OIDC — From Scratch

> Companion to M0. Reference doc for Tasks 31–32 (CI and deploy workflows) and the runtime side of Task 30 (OIDC).

---

## 1. The mental model

GitHub Actions = "execute these bash steps on a fresh VM whenever an event fires." The YAML configures the graph (which workflows, when, what steps); the rest is just running commands.

```
Event in repo → GitHub matches workflow → allocates runner → runs steps → destroys runner
```

---

## 2. The four nouns

### Workflow — YAML in `.github/workflows/`

```yaml
name: CI
on: pull_request
jobs:
  app: { ... }
  terraform: { ... }
```

### Job — runs on one runner

```yaml
jobs:
  app:
    runs-on: ubuntu-latest
    steps: [...]
```

Jobs in the same workflow run in **parallel** by default. Use `needs:` to serialize.

### Step — `run:` (bash) or `uses:` (Action)

```yaml
- run: pnpm install --frozen-lockfile
- uses: aws-actions/configure-aws-credentials@v4
  with: { role-to-assume: ${{ secrets.AWS_ROLE_ARN }}, aws-region: ap-southeast-1 }
```

### Action — reusable step

- **JavaScript actions** — Node code (most common).
- **Docker actions** — runs in a container.
- **Composite actions** — wrap several steps.

Reference: `owner/repo@ref`. **Pin security-critical actions to commit SHAs** (defends against supply-chain compromises).

---

## 3. Runners

### GitHub-hosted

| `runs-on`        | What you get                      |
| ---------------- | --------------------------------- |
| `ubuntu-latest`  | Ubuntu LTS, Node, Docker, AWS CLI |
| `windows-latest` | Windows + MSVC                    |
| `macos-latest`   | macOS + Xcode (expensive)         |

Free on public repos; minute budget then per-minute on private.

### Self-hosted

Your machine, polling GitHub. For GPUs, on-prem access, or budget overruns. We won't use these.

---

## 4. Triggers

```yaml
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  schedule: [{ cron: '0 6 * * *' }]
  workflow_dispatch: # manual UI button
  workflow_call: # reusable from another workflow
```

PRs from **forks** run with restricted permissions (no secrets). `pull_request_target` allows secrets but is usually a security mistake.

---

## 5. Permissions

```yaml
permissions:
  contents: read
  id-token: write # CRITICAL for OIDC
  pull-requests: write
```

Default behavior is repo-dependent. **Always declare explicitly.** `id-token: write` is required to request OIDC tokens.

---

## 6. OIDC handshake from the runner's side

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ap-southeast-1
```

Step by step:

1. With `id-token: write`, GitHub provisions an OIDC token endpoint **inside the runner**. Two env vars are set: `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN`.

2. `configure-aws-credentials` fetches a JWT from that endpoint, audience `sts.amazonaws.com`.

3. GitHub generates the JWT with claims:

   ```json
   {
     "iss": "https://token.actions.githubusercontent.com",
     "sub": "repo:hwp/pyawmal:ref:refs/heads/main",
     "aud": "sts.amazonaws.com",
     "actor": "hwp",
     "workflow": "Deploy",
     "ref": "refs/heads/main",
     "sha": "abc123",
     "run_id": "789"
   }
   ```

4. Action calls AWS STS `AssumeRoleWithWebIdentity` with the JWT.

5. STS verifies signature + evaluates trust-policy `sub`/`aud` conditions → returns ~1h credentials.

6. Action writes creds to env vars; subsequent steps use them automatically.

**No static AWS keys anywhere.**

### Refining trust by `sub`

```
repo:owner/repo:ref:refs/heads/main           # only main
repo:owner/repo:ref:refs/tags/v*              # only version tags
repo:owner/repo:environment:production         # only "production" env
repo:owner/repo:pull_request                   # only PR runs
```

Production typically combines `environment:` (with required reviewers) + `sub` constraint.

---

## 7. Caching

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20, cache: pnpm }
```

`setup-node`/`setup-go`/`setup-python` have built-in cache. Custom caches:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.terraform.d/plugin-cache
    key: terraform-${{ runner.os }}-${{ hashFiles('infra/**/*.tf') }}
```

Per-repo, 5 GB total, LRU eviction. Reduces CI from ~3 min → ~30 s for typical Node projects.

---

## 8. Concurrency

```yaml
concurrency:
  group: deploy-dev
  cancel-in-progress: false # false for deploys; true for PR checks
```

Prevents two concurrent merges from racing on the same deploy.

---

## 9. Secrets & variables

```yaml
- env:
    AWS_ROLE_ARN: ${{ secrets.AWS_ROLE_ARN }}
  run: ./deploy.sh
```

Scopes:

- **Repo secrets** — all workflows in the repo.
- **Environment secrets** — only with `environment:` declared.
- **Org secrets** — shared, repo-allowlisted.

**Variables** (`${{ vars.X }}`) — same shape, not encrypted, for config.

With OIDC: only **one** secret (`AWS_ROLE_ARN`). That's the whole point.

---

## 10. Reusable workflows + composite actions

**Composite action** (share steps) — `.github/actions/setup/action.yml`:

```yaml
name: 'Setup'
runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v4
      with: { version: 9 }
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: pnpm }
    - run: pnpm install --frozen-lockfile
      shell: bash
```

Use: `- uses: ./.github/actions/setup`.

**Reusable workflow** — workflow with `on: workflow_call:` called by `uses: ./.github/workflows/deploy.yml`. For multi-service repos.

We won't need these in M0.

---

## 11. Our M0 workflows

### `ci.yml` (PR)

Two parallel jobs:

- **app** — install, lint, typecheck, test.
- **terraform** — assume role via OIDC, run `fmt -check`, `validate`, `plan` (read-only).

Both must be green to merge (branch protection).

### `deploy.yml` (on push to main)

```
1. Checkout
2. configure-aws-credentials via OIDC
3. Setup pnpm + Node
4. Install + lint + typecheck + test (re-run gates)
5. ECR login
6. docker build + push (commit SHA + latest)
7. aws ecs update-service --force-new-deployment
8. aws ecs wait services-stable
9. Smoke test: curl /health on ALB
```

`concurrency: { group: deploy-dev, cancel-in-progress: false }` — sequential.

---

## 12. Common gotchas

- **Missing `id-token: write`** → OIDC token request fails.
- **Trust policy `sub` mismatch** → STS AccessDenied. Use `StringLike` for branch wildcards.
- **Action pinned to moving ref (`@v4`, `@main`)** → supply-chain risk. Pin to SHA for security-critical actions.
- **Echoing secrets** → masking is best-effort, not foolproof.
- **`pull_request_target` + checking out fork code** → secret leak.
- **Caching `node_modules` directly** → breaks on lockfile changes; cache pnpm-store via `setup-node` instead.
- **Workflow rename** → orphans branch protection rules.
- **`GITHUB_TOKEN` permissions** → default varies by repo; declare explicitly.

---

## 13. End-to-end deploy

```
Merge to main
  ↓
GitHub matches deploy.yml
  ↓
Fresh ubuntu-latest runner
  ↓
git clone @ commit SHA
  ↓
Request OIDC token (id-token: write) → GitHub returns signed JWT
  ↓
configure-aws-credentials calls STS AssumeRoleWithWebIdentity
  ↓
STS verifies + returns temp credentials (1h)
  ↓
ECR login, docker build, docker push
  ↓
aws ecs update-service --force-new-deployment
  ↓
aws ecs wait services-stable
  ↓
curl /health on ALB → 200
  ↓
Workflow green; runner destroyed.
```

---

## Key takeaways

- Workflow = YAML file; **job** = steps on a runner; **step** = `run:` or `uses:`.
- Pin security-critical actions to commit SHAs.
- `id-token: write` required for OIDC.
- OIDC = per-job JWT requested inside the runner, redeemed at AWS STS for temp credentials. No long-lived AWS keys.
- Refine trust by `sub` claim (branch, tag, env, PR).
- Use `actions/cache@v4` and `setup-*` actions for speed.
- `concurrency:` prevents racing deploys.
- Composite actions / reusable workflows DRY up later.
