# AWS Networking — From Scratch

> Companion to M0. Reference doc you can re-read as you implement Tasks 22–23.

---

## 1. The mental model: a private office building

Imagine renting a whole floor of an office building. You decide:
- The address space of your floor (what room numbers exist)
- Which rooms get a phone line to the outside (public access)
- Which rooms can only be reached from other rooms on your floor (private)
- Which doors lock and who has keys (firewalls)

That's a VPC. Everything in AWS networking is variations on that idea.

---

## 2. IP addresses and CIDR notation

Every device on a network has an **IP address** — a 32-bit number written as four 0-255 numbers separated by dots (`10.0.5.42`). Think of it as a phone number for a machine.

A **CIDR block** describes a *range* of IPs that share the first N bits. Notation is `address/N`:

```
10.0.0.0/16
└────┬───┘└┬┘
     │     └── "the first 16 bits are fixed; the rest are variable"
     └──────── starting point: 10.0.0.0
```

`10.0.0.0/16` means addresses `10.0.0.0` through `10.0.255.255`. That's 2³² ⁻ ¹⁶ = 2¹⁶ = **65,536 addresses**.

Smaller CIDRs mean fewer addresses:

| CIDR | Fixed bits | Variable bits | Total addresses |
|---|---|---|---|
| `/16` | 16 | 16 | 65,536 |
| `/20` | 20 | 12 | 4,096 |
| `/24` | 24 | 8 | 256 |
| `/28` | 28 | 4 | 16 |

In our config, `10.0.0.0/16` is the whole VPC. `10.0.10.0/24` is one subnet inside it — its `10.0.10.*` prefix is a subset of `10.0.*.*`.

> **AWS reserves 5 IPs per subnet** for routing/DNS/future use (`.0`, `.1`, `.2`, `.3`, `.255`). A `/24` gives you 251 usable IPs.

---

## 3. Public vs private IP ranges

Three IP blocks are designated "private" — they're not routable on the public internet. Everyone uses them inside private networks:

- `10.0.0.0/8` (16.7M addresses)
- `172.16.0.0/12` (1M)
- `192.168.0.0/16` (65,536)

Two different AWS accounts can both use `10.0.0.0/16` — they're isolated; the IPs never see each other.

A **public IP** is globally unique and routable on the internet. AWS assigns these from its pool when you attach an Elastic IP or enable auto-assign on a subnet.

---

## 4. The VPC

A **VPC** (Virtual Private Cloud) is the boundary of your private network in AWS. One VPC = one isolated address space.

A VPC has:
- A name (`pyawmal-dev-vpc`)
- A CIDR block (`10.0.0.0/16`) — **immutable**
- A region (`ap-southeast-1` — VPCs cannot span regions)
- DNS settings (`enable_dns_hostnames` lets resources resolve hostnames inside the VPC)

```
┌────────────────────────────────────────────────────────┐
│  VPC: pyawmal-dev-vpc                                  │
│  CIDR: 10.0.0.0/16                                     │
│  Region: ap-southeast-1                                 │
│  (empty — no subnets, no gateways yet)                  │
└────────────────────────────────────────────────────────┘
```

**Pick the CIDR generously.** It's immutable. `/16` is the safe default.

---

## 5. Subnets and Availability Zones

A **subnet** is a slice of the VPC's address space, pinned to **exactly one Availability Zone**.

An **AZ** is a physically separate datacenter within a region. Singapore has three: `ap-southeast-1a`, `ap-southeast-1b`, `ap-southeast-1c`. They're connected by sub-millisecond links but in separate buildings — a power outage in 1a doesn't affect 1b. Production-grade apps spread across ≥2 AZs.

**Why subnets are AZ-pinned:** physical reality. An IP exists on a switch in a specific datacenter.

Our four subnets:

```
┌──────────────────────────────────────────────────────────────┐
│  VPC: 10.0.0.0/16                                            │
│                                                              │
│  ┌────────────────────────┐  ┌────────────────────────┐    │
│  │  AZ 1a                  │  │  AZ 1b                  │    │
│  │                          │  │                          │    │
│  │  public:  10.0.0.0/24    │  │  public:  10.0.1.0/24    │    │
│  │  private: 10.0.10.0/24   │  │  private: 10.0.11.0/24   │    │
│  └────────────────────────┘  └────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Why two AZs even though M0 runs one task?** Subnets must exist before you can place anything in them. We pre-create the multi-AZ structure so M16 can scale without re-architecting. Subnets are free.

**The "public" and "private" labels mean nothing yet** — they become meaningful only after we attach gateways and route tables (§ 7).

---

## 6. Internet Gateway, NAT, Route Tables

### Internet Gateway (IGW)

A logical object attached to a VPC. **One per VPC. Free.** The door to the internet.

```
                Internet
                   │
              ┌────▼─────┐
              │   IGW    │
              └──────────┘
              │
         (inside VPC)
```

An IGW (1) provides a target you can route traffic to, (2) translates between public IPs and the internet.

**Attaching an IGW alone exposes nothing.** A resource is reachable from the internet only if (a) the IGW exists, (b) the subnet's route table sends `0.0.0.0/0` → IGW, and (c) the resource has a public IP. All three.

### NAT Gateway

Sits in a public subnet, has its own public IP, acts as a **one-way valve** for outbound traffic from private subnets.

```
   Private subnet      Public subnet            Internet
   ┌──────────┐        ┌──────────┐
   │ ECS task │ ─────▶ │ NAT GW   │ ────▶ ─────▶ (anywhere)
   │ (no pub  │ ◀───── │          │ ◀──── ◀───── (replies)
   │  IP)     │        └──────────┘
   └──────────┘
```

Outbound packets get source IP rewritten to NAT's IP. Replies come back to NAT, which translates the destination back. **Inbound connections from the internet cannot traverse NAT** — they have no way to initiate a session through it.

**Cost reality:** NAT Gateway is ~$32/mo + per-GB traffic. Biggest line item in our $50–75/mo budget. Alternatives:
- **NAT instance** — t4g.nano EC2 running NAT software. ~$3/mo. Single point of failure; you patch it. OK for dev.
- **VPC Interface Endpoints** — for AWS services only (ECR, S3, Secrets Manager, CloudWatch), traffic stays in-VPC, no NAT needed. ~$7/mo per endpoint.

### Route Tables

A list of `(destination CIDR → target)` rules. Each subnet is associated with one route table.

When a packet leaves a subnet, AWS looks up the destination IP and forwards to the **most specific** matching rule (longest prefix match).

**Public route table:**
```
destination       target
10.0.0.0/16   →   local              ← always present; intra-VPC
0.0.0.0/0     →   <igw-id>           ← everything else: internet
```

**Private route table:**
```
destination       target
10.0.0.0/16   →   local
0.0.0.0/0     →   <nat-gw-id>        ← outbound only
```

> The `local` route is automatic; you can't remove it. Intra-VPC traffic always stays in the VPC.

---

## 7. So what makes a subnet "public" or "private"?

**Pure routing.** Nothing else.

A subnet is *effectively* public if its route table has `0.0.0.0/0 → IGW` AND its resources have public IPs.
A subnet is *effectively* private if its route table has `0.0.0.0/0 → NAT` or no internet route at all.

There's no "public" flag on a subnet — only how it's wired. Get the route table wrong and your "private" subnet is anything but.

---

## 8. Security Groups

A **Security Group** is a stateful firewall attached to a network interface (ENI). ECS tasks and RDS instances get one or more SGs; the SG's rules decide what's allowed in (ingress) and out (egress).

**Stateful** means: if you allow an inbound connection on port 3000, the reply traffic is automatically allowed back, even with no matching egress rule. AWS tracks connection state.

**Defaults:** new SG denies all inbound, allows all outbound.

**Our three SGs:**

```
┌──────────────┐
│ ALB SG       │ ingress: 0.0.0.0/0 → :80    (anyone can hit the LB)
│              │ egress:  all
└──────┬───────┘
       │ "ECS allows packets from ALB SG"
       ▼
┌──────────────┐
│ ECS SG       │ ingress: ALB SG → :3000     (only the ALB)
│              │ egress:  all                 (so it can reach RDS, ECR, ...)
└──────┬───────┘
       │ "RDS allows packets from ECS SG"
       ▼
┌──────────────┐
│ RDS SG       │ ingress: ECS SG → :5432     (only the api task)
│              │ (no egress needed)
└──────────────┘
```

**The critical trick:** ingress rules reference *other SG IDs*, not CIDRs. "ECS SG can talk to RDS SG" means *any ENI with the ECS SG attached* can reach *any ENI with the RDS SG attached*. IPs churn as tasks come and go; SG IDs are stable.

Even if someone discovers your RDS private IP, they can't connect from the internet: the RDS SG only allows packets from things with the ECS SG, and only ECS tasks have that SG.

---

## 9. NACLs — the other firewall

A second firewall layer: **Network ACLs**, attached to *subnets* (not ENIs). NACLs are **stateless** (define ingress and egress separately) and support **Allow + Deny** rules evaluated in numeric order.

Use SGs by default. NACLs are for coarse "block this CIDR entirely from this subnet" cases (e.g., blocking known-malicious IP ranges). We won't touch them for pyawmal.

---

## 10. Our M0 architecture, mapped

```
                 Internet
                    │
              ┌─────▼──────┐
              │    IGW     │
              └─────┬──────┘
                    │
   ┌────────────────┼────────────────┐
   │   Public subnets (2 AZs)         │   route: 0.0.0.0/0 → IGW
   │   ┌────────────────┐            │
   │   │     ALB        │  SG: ingress 0.0.0.0/0:80
   │   │     NAT GW     │            │
   │   └────────┬───────┘            │
   └────────────┼────────────────────┘
                │
   ┌────────────▼────────────────────┐
   │   Private subnets (2 AZs)        │   route: 0.0.0.0/0 → NAT GW
   │                                  │
   │   ┌──────────────┐               │
   │   │ ECS Fargate  │  SG: ingress ALB SG → :3000
   │   │  task (api)  │               │
   │   └──────┬───────┘               │
   │          │                       │
   │   ┌──────▼───────┐               │
   │   │ RDS Postgres │  SG: ingress ECS SG → :5432
   │   └──────────────┘               │
   └──────────────────────────────────┘
```

Each Terraform block in Tasks 22–23 maps to:
- `aws_vpc.this` — the building.
- `aws_subnet.public/private` — floors.
- `aws_internet_gateway.this` — the front door.
- `aws_nat_gateway.this` + `aws_eip.nat` — the one-way valve and its public number.
- `aws_route_table.public/private` + associations — the routing map for each floor.
- `aws_security_group.alb/ecs/rds` — door locks with keycards.

---

## Key takeaways

- VPC CIDR is permanent → pick big.
- Subnets are AZ-pinned; production spans ≥2 AZs.
- "Public" vs "private" is purely routing, not a flag.
- IGW is bidirectional; NAT is outbound-only.
- Security Groups are stateful (define ingress; replies are automatic).
- Reference SGs by ID, not CIDR, so resource churn doesn't break things.
- NACLs exist but you'll rarely need them.
