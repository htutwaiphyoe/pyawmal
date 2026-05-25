# Trunk-Based Development — From Scratch

> Companion to M0. Reference doc for our git/CI/CD workflow (the PRD's Git Flow section and Tasks 31–32).

---

## 1. The mental model

One long-lived branch (`main`), short-lived feature branches. `main` is **always deployable**. Combined with CI + feature flags, this enables continuous deployment.

```
Trunk-based:           main ──────────────────────────────────
                       feat/x  └──┐         ┌────
                       feat/y      └──┐  ┌──
                                      └──┘
```

Compare to GitFlow:

```
GitFlow:               main    ─────●─────●─────●─────
                       develop ─●───●─●───●─●───●─
                       feature/* sprouting from develop, merging back
                       release/* and hotfix/* layered on
```

---

## 2. Why GitFlow falls over for SaaS

GitFlow (Vincent Driessen, 2010) used `main`, `develop`, `feature/*`, `release/*`, `hotfix/*`. Problems:

- Long-lived `develop` accumulates conflicts.
- Release branches add ceremony.
- Doesn't fit continuous deployment.

The author retracted his recommendation in 2020 for web-style apps.

**GitFlow still fits** versioned/packaged software with multiple supported versions. **Not for SaaS.**

---

## 3. The three practices

### A. Short-lived feature branches

| Lifetime | Verdict      |
| -------- | ------------ |
| < 1 day  | Ideal        |
| 1-3 days | Fine         |
| 1 week   | Smell        |
| > 1 week | Anti-pattern |

### B. `main` always green

- CI gates (lint, typecheck, tests, terraform plan).
- Branch protection: PRs only, required checks, required reviews.
- After merge: auto-deploy.

If `main` breaks, fixing it is the team's top priority.

### C. Feature flags for incomplete work

Merge unfinished features behind a flag set to `off`. Iterate over PRs. Roll out: staff → beta → all. Delete flag after rollout.

We won't need flags until M3; the capability lives in architecture from M1.

---

## 4. Branch lifetimes (concrete targets)

| Phase              | Time bound        |
| ------------------ | ----------------- |
| Push first commit  | Day 1             |
| Open PR (even WIP) | Day 1             |
| Reviewer responds  | < 4h              |
| Merge              | < 3 days from cut |

Going past 3 days → branch too big / review too slow / CI too slow. Diagnose.

---

## 5. Code review

**Small PRs** (<200 lines, single-screen) are the default. Big PRs get rubber-stamped or block for days.

**Stacked PRs** (advanced): chain of PRs where each depends on the previous. Tools: Graphite, `gh stack`. Skip for M0/M1.

---

## 6. CI gates — must be fast + trusted

| Gate              | Target   |
| ----------------- | -------- |
| Lint              | < 30s    |
| Typecheck         | < 1 min  |
| Unit tests        | < 2 min  |
| Integration       | < 5 min  |
| Total PR feedback | < 10 min |

Slow CI = momentum dies. Invest in caches (Task 31's pnpm + turbo cache).

**Flaky tests sabotage TBD** — everyone learns to retry instead of diagnose. Real failures get ignored. Zero tolerance for flakes.

---

## 7. Release cadence

### Continuous deployment (our M0)

Every merge to `main` → production. No human approval.

Works when:

- CI is strong.
- Rollback is fast.
- Feature flags hide unfinished work.

### Continuous delivery + manual promotion

Every merge → staging. Human clicks "promote." For regulated industries, gnarly migrations.

M16 may add this tier.

---

## 8. Hotfixes — no special branches

1. Branch off `main`.
2. Fix.
3. PR → CI → merge → auto-deploy.

If you want `hotfix/*`, you've probably let `main` accumulate undeployed changes. Don't.

---

## 9. When TBD doesn't fit

- Versioned software with parallel supported versions.
- Mobile _binary_ releases (server can still be TBD).
- Regulatory environments with formal ceremony.
- Risk-averse cultures (transition first via feature-flag investment).

For our project (SaaS web + mobile API): textbook fit.

---

## 10. Daily flow

```bash
git checkout main && git pull
git checkout -b feat/auth-signup

# Work in small commits (commitlint enforces Conventional Commits)
git commit -m "feat(auth): add signup endpoint"
git commit -m "test(auth): cover signup happy path"

git push -u origin feat/auth-signup
gh pr create --base main --title "feat(auth): signup endpoint" --body "..."

# CI runs; reviewer responds within 4h
# Address feedback, push more commits

# Once green + approved
gh pr merge --squash --delete-branch

# deploy.yml runs; production reflects main within ~10 min
```

Branch protection on `main`:

- Require PR.
- Require status checks.
- Require ≥1 approving review.
- Dismiss stale approvals on new commits.
- Restrict direct pushes (only deployment automation).

---

## 11. Common objections + answers

| Objection                                  | Answer                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Small PRs slow delivery (review overhead)  | Backwards — big PRs sit for days; small PRs reviewed in minutes                                              |
| Need `develop` as a safety buffer          | That buffer becomes a bottleneck; fix `main` quality with CI + flags                                         |
| Feature flags are tech debt                | Short-lived flags < long-lived branches (less hidden state); delete after rollout                            |
| Big refactors don't fit                    | Land as additive PR sequence: add new alongside old → migrate caller A → migrate caller B → delete old       |
| Long-lived experiments                     | Personal/fork branch; only merge when promoted to feature                                                    |
| Rollbacks scarier without release branches | `git revert <merge-sha>` + push, or redeploy previous ECS task def revision — both faster than hotfix branch |

---

## 12. How TBD shapes pyawmal

- ONE environment (`dev`) in M0 — no `develop` → `staging` → `prod` chain.
- CI is fast + required (Task 31).
- Deploy is automated on merge (Task 32).
- Conventional Commits + commitlint (Task 5) → parseable history for changelogs.

When M3+ adds feature flags:

- Merge incomplete behind `pyawmal.<feature>` flag, default off.
- Roll out via flag service (LaunchDarkly, ConfigCat, or simple Postgres table).
- Watch metrics; ramp 1% → 10% → 100%; delete flag.

---

## Key takeaways

- `main` is the only long-lived branch.
- TBD = short branches + fast CI + feature flags + small PRs.
- Branch protection enforces the discipline.
- Big features → many small additive PRs (flag-hidden if unfinished).
- Hotfixes use the normal PR flow — no special branches.
- Not for versioned software / heavy regulation; perfect for SaaS.
- Every merge to `main` auto-deploys; production = `main`.
