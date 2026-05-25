# M0 — Infrastructure Foundation

M0 sets up the platform on which every future feature ships. No user-facing features yet — just the chassis.

## Services

- Frontend app (placeholder in M0)
- Backend API (M0 only exposes a health check)
- Database (empty in M0)
- CI/CD pipeline

## Environments

One environment in M0 (`dev`). No public custom domain — we use whatever URL the cloud provider gives us.

## Git flow

- `main` is always-deployable; the live environment reflects whatever is in `main`.
- Work happens on short-lived feature branches → pull request → merge to `main`.
- Merge only when the pipeline is green.

## Pipeline actions

- **On every pull request:** install dependencies, lint, type-check, run unit tests.
- **On merge to `main`:** same checks, then build the API and deploy it to the live environment.

## Roles

Only the **developer** role matters in M0. End-user roles (`user`, `moderator`, `admin`) will be introduced starting in M1 (the first user-facing feature).
