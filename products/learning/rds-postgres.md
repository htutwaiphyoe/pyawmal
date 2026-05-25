# RDS Postgres Operations — From Scratch

> Companion to M0. Reference doc for Task 24 (RDS + Secrets Manager). Postgres _internals_ (ACID/MVCC/indexes) live in a separate doc.

---

## 1. The split

| What AWS owns                     | What you own               |
| --------------------------------- | -------------------------- |
| OS, patching, the Postgres binary | Schema design + migrations |
| Backups + WAL shipping            | Queries + indexes          |
| Failover (Multi-AZ)               | Parameter tuning           |
| Disk-level snapshots              | Instance sizing            |
| Monitoring infrastructure         | Verifying restores work    |

RDS owns operations; you own the data model + workload.

---

## 2. RDS vs Aurora vs Serverless v2 vs self-hosted

|              | RDS Postgres         | Aurora Postgres               | Aurora Serverless v2 | Self-hosted EC2      |
| ------------ | -------------------- | ----------------------------- | -------------------- | -------------------- |
| Engine       | Vanilla              | AWS fork + custom storage     | Aurora autoscaling   | Anything             |
| Storage      | EBS (gp3)            | Distributed (6x across 3 AZs) | Same                 | DIY                  |
| Backup       | Snapshots + WAL → S3 | Continuous → S3               | Same                 | DIY                  |
| Failover     | 60-120s (Multi-AZ)   | ~30s                          | Same as Aurora       | DIY                  |
| Cost (small) | ~$13/mo              | ~$25/mo                       | Per ACU-hour         | $5-20/mo + your time |

**Use vanilla RDS** unless scale justifies Aurora. M0 uses RDS; M16 might revisit.

---

## 3. Instance types and storage

### Instance class

- `db.t4g.*` — burstable ARM; cheap. Sustained high CPU burns credits.
- `db.m7g.*` — general purpose, no bursting.
- `db.r7g.*` — memory-optimized.
- `db.x2g.*` — gigantic memory.

**RAM matters most** for Postgres (buffer cache). M0: `db.t4g.micro`.

### Storage

- `gp3` (default) — 3000 IOPS baseline + 125 MB/s.
- `io2` — provisioned IOPS, expensive.
- `magnetic` — don't.

**Enable storage autoscaling** (`max_allocated_storage`) — manually resizing is multi-hour.

### Encryption

Always on. Can't encrypt unencrypted instances after the fact — must snapshot → encrypted-restore. Encrypt from day one.

---

## 4. Parameter groups (Postgres `postgresql.conf` for RDS)

You can't edit `postgresql.conf` directly. Use a **parameter group**:

```hcl
resource "aws_db_parameter_group" "pyawmal" {
  name   = "pyawmal-dev-pg16"
  family = "postgres16"
  parameter { name = "log_statement", value = "ddl" }
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }
}
```

- **Dynamic** params apply immediately.
- **Static** params need a reboot (`apply_method = "pending-reboot"`).

Useful params: `max_connections`, `log_min_duration_statement` (slow query log), `shared_preload_libraries` (enable extensions), `rds.force_ssl`.

M0 uses default param group. M16 adds custom with `pg_stat_statements` + slow-query logging.

---

## 5. Subnet group

```hcl
resource "aws_db_subnet_group" "this" {
  subnet_ids = module.vpc.private_subnets
}
```

Must cover ≥2 AZs (required even for single-AZ deployments).

**Always private subnets. Always `publicly_accessible = false`.**

---

## 6. Backups + Point-in-Time Recovery (PITR)

- Daily automated snapshot during the backup window.
- Continuous WAL shipping to S3.
- Restore to any second within `backup_retention_period` (max 35 days for Postgres).

```hcl
backup_retention_period = 7
backup_window           = "02:00-04:00"
```

Restore:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier pyawmal-dev \
  --target-db-instance-identifier pyawmal-dev-restored \
  --restore-time 2026-05-25T14:32:00Z \
  --db-subnet-group-name pyawmal-dev-db
```

Creates a **new** instance. Original untouched.

> **Test PITR quarterly.** Automated backups you've never restored aren't backups — they're hope.

`backup_retention_period = 0` disables PITR entirely. Never in production.

---

## 7. Snapshots

- **Automated** — daily, deleted after retention.
- **Manual** — `aws rds create-db-snapshot`, live forever.

Use manual snapshots before risky operations:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier pyawmal-dev \
  --db-snapshot-identifier pyawmal-pre-m7-migration
```

Restoring creates a new instance. Cross-region copy via `copy-db-snapshot` (DR).

---

## 8. Multi-AZ vs read replicas

### Multi-AZ (high availability)

Synchronous standby in another AZ. Same endpoint; transparent failover.

```hcl
multi_az = true
```

- Failover: 60-120s.
- Doubles cost.
- Standby is **not queryable** — pure HA.

M0: `multi_az = false`. M16 enables it.

### Read replicas (read scaling)

Async replicas with own endpoints. App-side routing decides what reads from where.

- Replica lag typically <1s; unbounded under load.
- Can be promoted to primary in DR.

Not needed until ~M8 (chat is write-heavy in real time).

---

## 9. Version upgrades

### Minor (16.3 → 16.4)

Backwards-compatible. `auto_minor_version_upgrade = true` lets RDS apply during maintenance window. **Recommended.** Add `lifecycle { ignore_changes = [engine_version] }` in Terraform.

### Major (16 → 17)

May have breaking changes. You choose when.

```bash
aws rds modify-db-instance --engine-version 17.1 --apply-immediately
```

Requires ~10-30 min downtime (or blue/green for seconds).

**Always:** snapshot first → test on non-prod → read release notes.

---

## 10. Maintenance windows

Weekly window when RDS can apply OS patches + minor upgrades + reboots for parameter changes.

```hcl
maintenance_window = "sun:05:00-sun:07:00"   # UTC
```

Multi-AZ: maintenance on standby first, then failover — minimal downtime. Single-AZ: real outage.

---

## 11. Monitoring

### CloudWatch metrics (free, basic)

- `CPUUtilization` → alarm >80%
- `DatabaseConnections` vs `max_connections`
- `FreeableMemory` (running low = swap pain)
- `FreeStorageSpace` → alarm <20%
- `ReadIOPS` / `WriteIOPS`
- `ReplicaLag` (if multi-AZ or replicas)

### Enhanced Monitoring (~$1.30/mo)

OS-level per-process metrics at 1-60s intervals.

### Performance Insights (free first 7 days)

**The most useful RDS feature.** Shows which queries consume DB time, broken down by wait events.

```hcl
performance_insights_enabled          = true
performance_insights_retention_period = 7
```

### `pg_stat_statements`

Postgres extension for aggregated query stats. Enable via parameter group:

```sql
SELECT query, calls, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

---

## 12. Connecting to RDS

### From inside VPC (normal path)

ECS task → ECS SG → RDS SG → :5432. `DATABASE_URL` from Secrets Manager.

### From your laptop

Private subnet = no direct connect. Options:

1. **ECS Exec into a task running `psql`** — lightest:
   ```bash
   aws ecs execute-command --cluster pyawmal-dev --task <id> --container api \
     --command "psql $DATABASE_URL" --interactive
   ```
2. **SSM Session Manager port-forward** via bastion.
3. **VPN** (Client VPN to VPC).

### IAM auth (optional security upgrade)

Exchange IAM credential for a 15-min DB token. No long-lived password. M16 territory.

---

## 13. Our M0 RDS

```hcl
random_password "db" { length = 32 }

aws_db_subnet_group "this" {
  subnet_ids = module.vpc.private_subnets
}

aws_db_instance "postgres" {
  identifier              = "pyawmal-dev"
  engine                  = "postgres"
  engine_version          = "16.3"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_encrypted       = true
  db_name                 = "pyawmal"
  username                = "pyawmal"
  password                = random_password.db.result
  vpc_security_group_ids  = [aws_security_group.rds.id]
  db_subnet_group_name    = aws_db_subnet_group.this.name
  publicly_accessible     = false
  skip_final_snapshot     = true     # M0 only; flip in M16
  backup_retention_period = 7
  apply_immediately       = true
}

aws_secretsmanager_secret "db_url" {
  name = "pyawmal/dev/DATABASE_URL"
}

aws_secretsmanager_secret_version "db_url" {
  secret_string = "postgresql://pyawmal:<random>@<endpoint>:5432/pyawmal"
}
```

---

## 14. Common gotchas

- **`publicly_accessible = true`** — instantly exposes the DB.
- **`skip_final_snapshot = true`** in production — destruction loses everything.
- **`backup_retention_period = 0`** — disables PITR.
- **Connection storms** — too many short-lived connections crush Postgres. Add a pooler when concurrency rises.
- **Storage running out** — Postgres stops accepting writes. Enable `max_allocated_storage` autoscaling.
- **Minor upgrade ↔ Terraform fight** — TF says 16.3, AWS upgraded to 16.4 → next apply downgrades. Use `lifecycle { ignore_changes = [engine_version] }`.
- **Encrypting late** — only via snapshot → encrypted-restore. Encrypt from day one.
- **Restoring from snapshot creates a NEW instance** — DNS endpoint changes; update app config or swap.
- **`pg_stat_statements` not preloaded** when diagnosing slow queries — enable it now, not during incident.

---

## Key takeaways

- RDS = AWS owns ops; you own schema + workload.
- Vanilla RDS Postgres is sane default; Aurora later if scale justifies.
- gp3 storage with autoscaling; encryption from day one.
- Parameter groups replace `postgresql.conf` edits.
- Always private subnets; never `publicly_accessible = true`.
- PITR + snapshots = killer feature, but **test restore quarterly**.
- Multi-AZ = HA (one endpoint); read replicas = read scaling (separate endpoints).
- Performance Insights + `pg_stat_statements` for slow-query analysis.
- Connect from laptop via ECS Exec + psql, not by exposing.
