# Application Load Balancer (ALB) — From Scratch

> Companion to M0. Reference doc for Task 29 (ALB + target group + listener).

---

## 1. The mental model

ALB = reverse proxy with HTTP intelligence. Clients see only the ALB; the ALB picks a backend per request.

```
Client → ALB → backend ECS tasks
```

For the client, the ALB _is_ your service.

---

## 2. L4 vs L7 — NLB vs ALB

|                   | NLB           | ALB                   |
| ----------------- | ------------- | --------------------- |
| OSI layer         | 4 (TCP/UDP)   | 7 (HTTP/HTTPS)        |
| Inspects HTTP?    | No            | Yes                   |
| Path/host routing | No            | Yes                   |
| TLS termination   | Pass-through  | Terminates            |
| Sticky sessions   | By connection | By cookie             |
| Protocols         | TCP, UDP      | HTTP, HTTPS, gRPC, WS |
| Static IPs        | Yes           | No (DNS only)         |

We use ALB. NLB only when needing lowest latency, raw TCP/UDP, or static IPs.

---

## 3. The four objects

```
aws_lb (the load balancer)
  └── aws_lb_listener (port + protocol)
      └── default_action / aws_lb_listener_rule (conditional routing)
          └── forward → aws_lb_target_group
                          └── registered targets
```

| Object                 | Role                                                   |
| ---------------------- | ------------------------------------------------------ |
| `aws_lb`               | The ALB itself; sits in ≥2 public subnets              |
| `aws_lb_listener`      | "Traffic on port X, protocol Y → route by these rules" |
| `aws_lb_listener_rule` | Conditional routing on listener (path/host)            |
| `aws_lb_target_group`  | Pool of backends + health-check spec                   |

---

## 4. Target groups

```hcl
resource "aws_lb_target_group" "api" {
  name        = "pyawmal-dev-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"           # required for Fargate
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}
```

### `target_type`

| Value      | Targets are      | Used when              |
| ---------- | ---------------- | ---------------------- |
| `instance` | EC2 instance IDs | EC2 launch type        |
| `ip`       | IP addresses     | **Fargate (required)** |
| `lambda`   | Lambda functions | API behind ALB         |

### Registration

ECS auto-registers/deregisters task IPs via the service's `load_balancer` block. You don't manage targets manually.

### Health check fields

- `path` — URL to GET on the **target's port** (not 80).
- `matcher` — "200", "200-299", "200,301".
- `interval` — seconds between checks.
- `timeout` — seconds before failed.
- `healthy_threshold` — consecutive successes to mark healthy.
- `unhealthy_threshold` — consecutive failures to mark unhealthy.

---

## 5. Listeners and rules

```hcl
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
```

One listener per (port, protocol). M0 has one: `:80/HTTP`.

### HTTP → HTTPS redirect

```hcl
default_action {
  type = "redirect"
  redirect { port = "443", protocol = "HTTPS", status_code = "HTTP_301" }
}
```

### Listener rules (M4+ for path-based routing)

```hcl
resource "aws_lb_listener_rule" "ws" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100
  action       { type = "forward", target_group_arn = aws_lb_target_group.ws.arn }
  condition    { path_pattern { values = ["/ws/*"] } }
}
```

---

## 6. HTTPS and ACM (M0 skips this)

To do HTTPS, attach an ACM cert to an HTTPS listener:

```hcl
resource "aws_lb_listener" "https" {
  port            = 443
  protocol        = "HTTPS"
  ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = aws_acm_certificate.cert.arn
  default_action { ... }
}
```

**ACM** issues free TLS certs for domains _you control_. DNS validation. Auto-renews.

**Catch:** ACM doesn't issue certs for AWS's `*.elb.amazonaws.com`. Without a custom domain, no ACM cert. **M0 is HTTP-only.** When we attach a domain (likely M1), we'll add the cert + HTTPS listener + redirect + open :443 on the ALB SG.

TLS termination = ALB decrypts inbound, forwards over HTTP to backends (path is private inside the VPC). End-to-end encryption to backend possible but most apps don't bother.

---

## 7. Connection draining

```
1. Target deregistered (ECS replacing task).
2. ALB enters draining for `deregistration_delay` (default 300s).
3. No new requests to target; existing connections continue.
4. After delay, force-close remaining; remove from target group.
```

This is what gives your container time to gracefully shut down (SIGTERM → `fastify.close()`).

For WebSockets (M4+): lower to ~60s + send "going away" frame from server so clients reconnect immediately.

---

## 8. Sticky sessions

For HTTP: ALB freely picks any healthy target. That's load balancing.

For WebSocket: the WS handshake is HTTP, but once established the TCP connection is pinned to one backend. ALB doesn't _need_ stickiness for WS. Only if the same client opens multiple WS connections expecting the same backend.

Skip in M0; revisit at M4.

---

## 9. Request path step by step

```
1. DNS resolves <alb-dns> → ALB public IP.
2. Browser opens TCP to ALB:80.
3. ALB parses HTTP.
4. ALB looks at port-80 listener → default_action.
5. Picks a healthy target (round-robin).
6. Opens new TCP to target IP:3000.
7. ECS SG allows it (ingress from ALB SG → :3000).
8. Fastify routes /health → 200 + JSON.
9. ALB returns response to browser.
```

Status codes from the ALB itself:

- **502 Bad Gateway** — target unreachable / refused.
- **503 Service Unavailable** — no healthy targets.
- **504 Gateway Timeout** — target too slow.

---

## 10. Our M0 ALB, recapped

```
aws_lb "this":
  internal           = false
  type               = application
  security_groups    = [alb_sg]                    # only :80 from internet
  subnets            = vpc.public_subnets          # 2 AZs

aws_lb_target_group "api":
  port               = 3000
  protocol           = HTTP
  target_type        = ip                          # Fargate
  health_check       = /health, 200, 15s, 2 healthy / 3 unhealthy

aws_lb_listener "http":
  port               = 80
  protocol           = HTTP
  default_action     = forward to api TG

ecs_service "api":
  load_balancer { target_group_arn = api_tg.arn, container_name = "api", container_port = 3000 }
```

DNS: `pyawmal-dev-alb-1234567.ap-southeast-1.elb.amazonaws.com`. `curl http://<that>/health` to verify.

---

## 11. Common gotchas

- **Port mismatch** (container ≠ task-def `containerPort` ≠ target-group `port`) — #1 cause of 502s.
- **Wrong `target_type`** (instance vs ip) — Fargate needs `ip`.
- **Health-check path 404** — ALB marks unhealthy → ECS replaces → loop.
- **Aggressive health check** (interval=5, threshold=2) — GC pause kills tasks. Lean to `interval=15+`, `unhealthy_threshold=3+`.
- **ALB SG missing :443** when adding HTTPS — connection refused.
- **`internal = true`** makes ALB only reachable within VPC.
- **Stale targets after deploy** — `deregistration_delay=300s` means draining tasks linger 5 min.
- **`health_check_grace_period_seconds` too short** for slow-starting containers → ECS kills during deploy.

---

## Key takeaways

- ALB = L7 reverse proxy; NLB = L4.
- Four objects: ALB · Listener · Listener rules · Target Group.
- Fargate requires `target_type = "ip"`.
- ECS auto-registers/deregisters via `load_balancer` on the service.
- HTTPS needs ACM cert; ACM needs custom domain (M0 uses HTTP).
- `deregistration_delay` enables graceful shutdown.
- 502 = backend unreachable; 503 = no healthy targets; 504 = backend timeout.
- Port mismatch (3 places) is the #1 bug.
