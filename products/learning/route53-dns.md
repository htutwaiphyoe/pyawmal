# Route 53 + DNS — From Scratch

> Companion to M0/M1 transition. Reference doc for when we attach a real domain + HTTPS in M1.

---

## 1. The mental model

DNS = distributed phonebook. Resolvers walk root → TLD → authoritative servers to find name-to-IP mappings. Heavily cached via TTLs.

```
.                       (root)
.com                    (TLD)
pyawmal.com             (your domain)
api.pyawmal.com         (subdomain)
```

Resolution path:

1. Resolver checks cache.
2. If miss: asks root → TLD → authoritative nameservers (Route 53 for us).
3. Caches the answer for the record's TTL.

---

## 2. Record types

| Record               | Points to                 | Use                                    |
| -------------------- | ------------------------- | -------------------------------------- |
| A                    | IPv4                      | `api.pyawmal.com` → `52.x.x.x`         |
| AAAA                 | IPv6                      | Same for IPv6                          |
| CNAME                | Another DNS name          | `www.pyawmal.com` → `pyawmal.com`      |
| MX                   | Mail server               | Email delivery                         |
| TXT                  | Arbitrary text            | DKIM/SPF/DMARC, ownership verification |
| NS                   | Authoritative nameservers | At domain apex                         |
| SOA                  | Start of authority        | Auto-managed                           |
| **Alias** (Route 53) | AWS resource              | Killer feature; see §6                 |

Rules:

- **CNAME at apex is illegal** in standard DNS. Apex must be A/AAAA/Alias.
- TXT records carry SPF/DKIM/DMARC for email + third-party verifications.
- NS at apex tells the world which servers are authoritative.

---

## 3. TTL — caching and propagation

Every record has a TTL (seconds). Resolvers cache for that long.

Common values:

- 86400 (1 day) — stable.
- 300 (5 min) — changes occasionally.
- 60 (1 min) — active migration.

**"DNS propagation" reality:** authoritative server updates instantly; resolvers holding old values won't re-fetch until cached TTL expires. **Lower TTL 24-48h before planned changes**, raise after.

---

## 4. Hosted zones

### Public

Internet-resolvable. $0.50/zone/month + $0.40/million queries.

```hcl
resource "aws_route53_zone" "main" { name = "pyawmal.com" }
```

After creation, take the 4 nameservers and update NS records at your registrar.

### Private

Resolvable only from associated VPC(s). Internal service discovery.

```hcl
resource "aws_route53_zone" "internal" {
  name = "internal.pyawmal"
  vpc { vpc_id = module.vpc.vpc_id }
}
```

---

## 5. Routing policies

| Policy             | Behaviour                                         |
| ------------------ | ------------------------------------------------- |
| Simple             | One or more values, returned randomly             |
| Weighted           | Split by weights (canary, A/B)                    |
| Latency            | Lowest-latency AWS region for client              |
| Geolocation        | By country/continent                              |
| Geoproximity       | Geo with weighted bias                            |
| Failover           | Primary + secondary, flip on health-check failure |
| Multi-value answer | Up to 8 healthy targets; client picks             |
| IP-based           | By client IP range                                |

Start with Simple. Weighted = DNS-level canary. Failover = active/passive HA.

---

## 6. Alias records — the killer feature

CNAME issues for AWS use:

1. Illegal at apex.
2. Two lookups (CNAME → A).

**Alias** = Route 53 extension. Looks like A/AAAA to clients; target is an AWS resource (ALB, CloudFront, S3 website, API Gateway, another Route 53 record).

Benefits:

- Works at apex.
- One lookup.
- Free (no per-query charge).
- Auto-tracks target IPs.

```hcl
resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.pyawmal.com"
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}
```

---

## 7. Health checks + failover

```hcl
resource "aws_route53_health_check" "api" {
  fqdn              = "api.pyawmal.com"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30
}
```

With Failover routing → DNS-level cross-region active/passive HA.

Cost: ~$0.50/check/mo (HTTP); ~$2 (HTTPS w/ string match).

---

## 8. DNS validation for ACM

ACM cert request gives you a CNAME to add:

```
_xxx.api.pyawmal.com → _yyy.acm-validations.aws
```

When hosted zone + ACM are in the same account, fully automated via Terraform:

```hcl
resource "aws_acm_certificate" "api" {
  domain_name       = "api.pyawmal.com"
  validation_method = "DNS"
}

resource "aws_route53_record" "api_validation" {
  for_each = { for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
    name = dvo.resource_record_name, type = dvo.resource_record_type, record = dvo.resource_record_value
  }}
  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_validation : r.fqdn]
}
```

ACM certs **auto-renew indefinitely** as long as the validation CNAME stays.

---

## 9. Domain registration

Route 53 supports `aws route53domains register-domain` (`.com` ~$12/yr). Or register elsewhere and update NS at that registrar to point to Route 53's nameservers.

---

## 10. M0 status

No domain in M0. ALB reachable at `pyawmal-dev-alb-1234567.ap-southeast-1.elb.amazonaws.com`, HTTP only.

When we attach a domain (M1):

1. Register or own a domain.
2. Public hosted zone in Route 53.
3. Update NS at registrar.
4. ACM cert + DNS validation (auto via Terraform).
5. Alias record `api.<domain>` → ALB.
6. HTTPS listener on ALB.
7. Optional HTTP → HTTPS redirect.

One Terraform apply.

---

## 11. Common gotchas

- **CNAME at apex** — illegal. Use Alias.
- **Not updating NS at registrar** — Route 53 records exist but nobody resolves them. `dig +trace` shows it.
- **High TTL during migration** — old values cached for days. Lower before, raise after.
- **Route 53 health check failing** with endpoint healthy — usually SG blocking checker IPs.
- **Deleting ACM validation CNAME** — auto-renewal fails. Keep forever.
- **Multiple A records, no policy** → Simple, random pick. Often unexpected.
- **Geo routing + VPNs** → wrong continent.
- **Over-eager health checks across regions** → costs add up.
- **Cross-account ACM + ALB** → doable but adds trust complexity; prefer same account.

---

## Key takeaways

- DNS = name→IP, hierarchical, cached at TTLs.
- Apex needs A/AAAA/Alias (no CNAME).
- Lower TTL before planned changes, raise after.
- Public vs private hosted zones.
- Eight routing policies (Simple → Failover → Geo → Latency → Weighted → IP-based → Multi-value → Geoproximity).
- **Alias** beats CNAME for AWS resources: apex-safe, one lookup, free, auto-updates.
- ACM DNS validation fully automatable when zone + cert in same account.
- M0 has no domain. M1 attaches one + adds HTTPS.
