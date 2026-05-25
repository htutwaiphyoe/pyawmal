# CloudWatch — From Scratch

> Companion to M0. Reference doc for Task 26 (CloudWatch log group) and any future observability work.

---

## 1. The mental model

Observability = three pillars:

1. **Logs** (what happened, text)
2. **Metrics** (how much / how often, numeric time-series)
3. **Traces** (request journey across services — AWS X-Ray, deferred)

CloudWatch covers 1 + 2. Distributed tracing comes later.

CloudWatch is actually **four products** under one name:
| Sub-service | Role |
|---|---|
| Logs | Stores logs |
| Metrics | Time-series numeric data |
| Alarms | Threshold-based notifications |
| EventBridge | Pub/sub event bus |

---

## 2. CloudWatch Logs

### Hierarchy

```
Log group: /ecs/pyawmal-dev-api
  └── Log streams (one per source: ECS task, Lambda invocation, …)
        └── Events (one log line with timestamp)
```

### Retention

```hcl
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/pyawmal-dev-api"
  retention_in_days = 14
}
```

Valid values: 1, 3, 5, 7, 14, 30, 60, 90, …, 3653 days, or `0` (forever). **Always set retention** — default is forever; bills grow.

### How `awslogs` from ECS works

Task definition:

```jsonc
"logConfiguration": {
  "logDriver": "awslogs",
  "options": {
    "awslogs-group":         "/ecs/pyawmal-dev-api",
    "awslogs-region":        "ap-southeast-1",
    "awslogs-stream-prefix": "api"
  }
}
```

1. ECS agent attaches Docker's `awslogs` driver to your container.
2. Every line your app writes to stdout/stderr is captured.
3. Driver ships lines via `PutLogEvents` to CloudWatch.
4. Stream name = `<prefix>/<container>/<task-id>`.
5. Execution role needs `logs:CreateLogStream` + `logs:PutLogEvents` (managed `AmazonECSTaskExecutionRolePolicy` covers).

**Implications:**

- Just `console.log` / `fastify.log` to stdout. Don't use the CW SDK directly.
- 1-3s lag before lines appear (not real-time).

---

## 3. Structured logging

```ts
// Bad — text
app.log.info(`User ${userId} sent message in conversation ${convId}`);

// Good — JSON
app.log.info({ userId, convId, action: 'send_message' }, 'message sent');
```

**Pino** (Fastify's logger) emits JSON in production by default. Don't bypass.

Every log line includes `reqId` (Task 9). Trace a request by filtering Logs Insights on that field.

**Don't log:** passwords, tokens, full request bodies, PII when avoidable.

---

## 4. Metric filters — extract metrics from logs

```hcl
resource "aws_cloudwatch_log_metric_filter" "errors" {
  name           = "api-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.level = \"error\" }"
  metric_transformation {
    name      = "ApiErrorCount"
    namespace = "Pyawmal/Api"
    value     = "1"
  }
}
```

JSON-aware pattern syntax:

- `{ $.level = "error" }`
- `{ $.statusCode >= 500 }`
- `{ $.userId = "*" && $.action = "login" }`

Resulting metric can be alarmed.

---

## 5. CloudWatch Metrics

Time-series numeric data with **dimensions** (key-value labels). Example: `AWS/ApplicationELB RequestCount` with dimensions `LoadBalancer=...`, `TargetGroup=...`.

### Built-in metrics (free)

| Namespace            | Useful metrics                                                                        |
| -------------------- | ------------------------------------------------------------------------------------- |
| `AWS/ECS`            | `CPUUtilization`, `MemoryUtilization`                                                 |
| `AWS/RDS`            | `CPUUtilization`, `DatabaseConnections`, `FreeableMemory`, `FreeStorageSpace`         |
| `AWS/ApplicationELB` | `RequestCount`, `TargetResponseTime`, `HTTPCode_Target_5XX_Count`, `HealthyHostCount` |
| `AWS/NATGateway`     | `BytesOutToDestination`, `ErrorPortAllocation`                                        |

### Custom metrics — two ways

1. **PutMetricData API** — code calls `cloudwatch.putMetricData(...)`. Costs per request.
2. **Embedded Metric Format (EMF)** — log lines include structured payload CloudWatch auto-extracts. **No extra API calls. Free.**

EMF example:

```ts
app.log.info({
  _aws: {
    Timestamp: Date.now(),
    CloudWatchMetrics: [
      {
        Namespace: 'Pyawmal/Api',
        Dimensions: [['Operation']],
        Metrics: [{ Name: 'MessagesSent', Unit: 'Count' }],
      },
    ],
  },
  Operation: 'send_message',
  MessagesSent: 1,
});
```

### Resolution

- **Standard** — 1-min, free.
- **High-resolution** — 1-sec, ~$0.30/metric/mo.

---

## 6. Alarms

```hcl
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "pyawmal-dev-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = aws_lb.this.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
  treat_missing_data  = "notBreaching"
}
```

Key fields:

- `evaluation_periods` × `period` — window for evaluation.
- `statistic` — `Sum`, `Average`, `Maximum`, `p95`, etc.
- `treat_missing_data` — `notBreaching` / `breaching` / `ignore` / `missing`.
- `alarm_actions` — usually SNS topic; fans out to email, Slack, PagerDuty, Lambda.

**Composite alarms** — boolean combinations of alarms. Reduces noise.

Common pipeline: Alarm → SNS → Lambda → Slack/PagerDuty.

M0: no alarms. M16: ALB 5xx, RDS connection saturation, ECS task failure, NAT GW errors.

---

## 7. Dashboards

JSON specs of widgets pulled from metrics/logs. M0: skip. M16: build a "service health" dashboard.

---

## 8. Logs Insights — the query interface

```
fields @timestamp, @message
| filter level = "error"
| sort @timestamp desc
| limit 50
```

Examples:

```
# Requests for one user
fields @timestamp, reqId, action, statusCode
| filter userId = "u_abc"
| sort @timestamp desc
```

```
# p99 latency per route
fields route
| stats pct(responseTime, 99) as p99 by route
```

```
# Top error endpoints
fields route
| filter statusCode >= 500
| stats count(*) as errors by route
| sort errors desc
| limit 10
```

```
# Trace a request
fields @timestamp, level, msg
| filter reqId = "uuid-here"
| sort @timestamp asc
```

Cost: ~$0.005 per GB scanned. Narrow time range to reduce cost. Save frequent queries.

---

## 9. CloudWatch Synthetics — canaries

Scheduled scripts that check your service from the outside. Failures increment a metric → alarm. Catch outages before customers.

M0: skip. M16: full sign-up → message-send → logout journey every 5 min.

---

## 10. EventBridge — the event bus

Pub/sub bus. Subscribe rules to route AWS-service events to Lambda/SQS/SNS.

```hcl
resource "aws_cloudwatch_event_rule" "ecs_task_failures" {
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = { lastStatus = ["STOPPED"], stopCode = ["TaskFailedToStart", "EssentialContainerExited"] }
  })
}
```

Uses:

- ECS failures → Slack
- Secret rotation → flush connection pools
- Scheduled cron-like Lambda triggers
- Alarms → remediation Lambdas

---

## 11. Our M0 CloudWatch

```hcl
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/pyawmal-dev-api"
  retention_in_days = 14
}
```

Task def wires `awslogs` → this group. pino JSON → stdout → CloudWatch.

Tail in dev:

```bash
aws logs tail /ecs/pyawmal-dev-api --follow --region ap-southeast-1
```

---

## 12. Common gotchas

- **No retention set** → bills creep up forever.
- **Unstructured logs** → can't filter; metric filters become regex spaghetti.
- **Logging PII/tokens** → compliance breach; add redaction.
- **Missing `logs:*` perms on execution role** → container runs, no logs appear.
- **High-cardinality metric dimensions** (e.g., `userId`) → bills explode.
- **No `treat_missing_data`** → alarms flap to INSUFFICIENT_DATA.
- **Logs Insights on huge ranges** → expensive + slow. Narrow time first.
- **Real-time expectation** — CW is 1-3s lag, not instant.

---

## Key takeaways

- CloudWatch = **Logs + Metrics + Alarms + EventBridge**.
- ECS `awslogs` driver ships stdout → log group; structured JSON makes it queryable.
- Always set log retention.
- Metric filters → log patterns become metrics; **EMF** is free + fast for custom app metrics.
- Alarms → SNS → Lambda → Slack/PagerDuty pipeline.
- Logs Insights is the daily-use query interface.
- M0 = just the log group. Everything else comes M16.
