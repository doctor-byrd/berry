# Platform Architecture & Scaling Strategy — DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`, `Identity.md`, `Finance.md`, `Commerce.md`, `Communications.md`, `Social.md`, `MiniApp.md`

Scope: Cross-cutting architectural principles, infrastructure scaling strategies (specifically tailored for self-hosted Supabase, FalkorDB, and NATS), operational risk mitigation, and the evolutionary path from v1 pragmatism to hyper-scale.

Guiding constraint: **v1 pragmatism** — maximize developer velocity and user experience using shared physical infrastructure, while designing strict logical boundaries that allow for seamless horizontal scaling and physical separation when scale demands it.

---

## 1. Core Architectural Principles

The platform is built on five foundational pillars:

1. **Internal-First Financial Model**: The blockchain (FireFly/Besu) is strictly an on/off ramp. Blnk is the authoritative ledger. This eliminates gas fees for internal transfers, removes UX friction, and enables instant settlement.
2. **BFF + Contracts-First SDK**: All mobile traffic flows through a single NestJS BFF. The mobile app consumes a framework-free `@superapp/sdk` via thin, Promise-based clients, perfectly aligned with TanStack Query for client-side state management.
3. **Logical Isolation, Shared Physical Substrate**: Domains have strict logical boundaries (separate schemas, events, and contracts) but share physical infrastructure (Supabase, FalkorDB, NATS, MinIO) in v1 to minimize infrastructure tax.
4. **Event-Driven Sagas over Distributed Transactions**: Cross-domain workflows (provisioning, checkout) use NATS JetStream and the Outbox pattern for eventual consistency, avoiding fragile Two-Phase Commit (2PC) protocols.
5. **Mini App Sandboxing**: Third-party apps run in isolated Ionic Portals (WebViews) and access platform services exclusively through a permissioned, scoped-JWT native bridge.

---

## 2. Data Layer & Scaling Strategy (The Supabase, FalkorDB & NATS Evolution)

In v1, all domains share a single self-hosted Supabase Postgres instance, FalkorDB acts as our RESP-compatible Redis replacement for caching/sessions, and NATS JetStream serves as the dedicated event backbone.

### 2.1 Database Scaling (Supabase Path)
*Architectural Decision:* We explicitly **avoid Citus** (Postgres sharding) because it fundamentally alters table storage metadata, which breaks Supabase's internal tooling (PostgREST, Realtime, GoTrue). Instead, we scale using Supabase's native horizontal scaling features.

* **Phase 1 (v1) - Connection Pooling:** 
  As the NestJS BFF scales horizontally, we will exhaust native Postgres connections. We will configure NestJS TypeORM to route all connections through **Supavisor** (Supabase's Rust-based connection pooler), allowing thousands of BFF pods to share a small pool of actual database connections.
* **Phase 2 (v2) - Read Replicas:** 
  When heavy read traffic (Social feeds, Commerce browsing) starves the primary database of IOPS needed for Finance writes, we will enable **Supabase Read Replicas** via logical replication. The BFF will be configured to route `SELECT` queries to the Read Replica endpoint, and `INSERT/UPDATE/DELETE` to the Primary.
* **Phase 3 (v3) - Physical Separation:** 
  When Read Replicas are no longer sufficient, we will **spin up a second, entirely separate Supabase Postgres instance** in k8s. We will migrate the Finance schema to the new instance, using the NestJS BFF to orchestrate cross-database reads. This preserves the integrity of Supabase's tooling while eliminating the bottleneck.

### 2.2 Event Backbone (NATS JetStream)
*Architectural Decision:* We use **NATS JetStream** from day one as a purpose-built, lightweight event backbone, avoiding the operational complexity of Kafka while providing superior performance and durability compared to Redis Streams.

* **NATS JetStream Responsibilities:**
  - **Durable event streaming** with at-least-once delivery guarantees
  - **Consumer groups** for saga coordination (e.g., Identity provisioning saga, Finance checkout saga)
  - **Outbox pattern**: The `event_outbox` table is drained and published to NATS subjects
  - **Dead-letter queues**: Failed events are routed to dead-letter subjects after max delivery attempts
  - **Replay capability**: Events can be reprocessed from a specific point in time for debugging or recovery
  - **Acknowledgment tracking**: NATS tracks which events have been processed by each consumer group

* **Why NATS over Redis Streams:**
  - **Purpose-built for event streaming**: NATS is optimized for high-throughput, low-latency message delivery
  - **Clean separation of concerns**: FalkorDB focuses on caching/sessions; NATS handles events
  - **Lightweight operational overhead**: NATS is ~15MB, easy to deploy and monitor
  - **Avoids painful migration**: Starting with NATS prevents the need to migrate from Redis Streams later when scale demands it

### 2.3 Cache & Session Layer (FalkorDB)
*Architectural Decision:* In v1, FalkorDB is used purely as a standard, RESP-compatible Redis instance for caching, sessions, and coordination primitives.

* **FalkorDB Responsibilities:**
  - **BFF caching**: Hot read paths (product catalogs, social timelines, seller profiles)
  - **Session storage**: Refresh tokens, Mini App scoped JWTs, auth state
  - **Rate limiting**: Per-user and per-Mini-App request counters
  - **Distributed locks**: Saga coordination (e.g., `SETNX saga:lock:{orderId}`)
  - **Idempotency keys**: Finance transfer idempotency tracking

* **Phase 2 (v2/v3) - Topology Separation:** 
  When the product actually requires complex graph traversals (e.g., Social follower graphs, Commerce recommendations), we will **enable FalkorDB's graph features** while keeping it as our cache/session layer. If graph workloads become memory-intensive and impact cache performance, we will **separate FalkorDB into a dedicated graph service** and replace it in the cache layer with standard Redis.

---

## 3. BFF Horizontal Scaling & Resilience

The NestJS BFF is currently a single point of failure for the mobile client. To scale it horizontally and eliminate this risk, the BFF must be strictly stateless and leverage FalkorDB/Supavisor/NATS for all coordination.

### Stateless Design
- **No in-memory session storage**: All session data (refresh tokens, Mini App scoped JWTs) must live in FalkorDB.
- **No request-affinity**: Any BFF pod must be able to handle any request. 
- **Stateless Outbox**: Multiple BFF pods can safely drain the `event_outbox` table using FalkorDB distributed locks to prevent duplicate event publishing. Events are then published to NATS.

### FalkorDB/Supavisor/NATS as the Coordination Layer
- **Session Store (FalkorDB)**: Maps `refresh_token → user_id` and `scoped_jwt → permissions`.
- **Rate Limiting (FalkorDB)**: Tracks per-user and per-Mini-App request counts using atomic counters.
- **Saga Coordination (FalkorDB + NATS)**: Uses FalkorDB distributed locks to ensure only one pod processes a specific saga step at a time. NATS consumer groups ensure events are processed exactly once per consumer group.
- **Database Pooling (Supavisor)**: All BFF pods connect to the database exclusively via Supavisor.
- **Event Publishing (NATS)**: All domain events are published to NATS subjects after being written to the outbox.

### Kubernetes Deployment Patterns
- **Horizontal Pod Autoscaler (HPA)**: Scale BFF pods based on CPU/memory or custom metrics (e.g., active WebSocket connections, request rate).
- **Probes**: Readiness probes must verify successful connections to FalkorDB, Supavisor, and NATS before k8s routes traffic to a pod.
- **Graceful Shutdown**: Implement `onModuleDestroy` hooks in NestJS to drain in-flight requests, close WebSocket connections cleanly, and finish processing any in-flight NATS messages before pod termination.

### Multi-Tier Caching Strategy
- **Tier 1 (Client)**: TanStack Query handles client-side caching, deduplication, and stale-while-revalidate. If the BFF experiences a brief outage, the mobile app shows cached data rather than a blank screen.
- **Tier 2 (Server)**: FalkorDB caches hot read paths on the BFF (e.g., product catalogs, social timelines, seller profiles).
- **Tier 3 (Invalidation)**: Cache invalidation is driven by events. When Commerce updates a product, it emits `commerce.product.updated` to NATS → BFF listens and invalidates the specific FalkorDB cache key.

---

## 4. Operational Risks & Mitigations

### 1. The Downstream Services Tax
- **Risk**: Running 8 complex, stateful third-party services (Authentik, Blnk, FireFly, Vendure, GoToSocial, ejabberd, LiveKit) in k8s creates a massive DevOps burden for upgrades, backups, and debugging.
- **Mitigation**: Invest heavily in standardized Helm charts, automated backup/restore testing, and centralized logging (OpenTelemetry). No service should be a "black box."

### 2. The UX of Eventual Consistency
- **Risk**: Asynchronous sagas mean things happen in the background. A user might tap "Finance" before their wallet is provisioned, or tap "Checkout" before the ledger hold is confirmed.
- **Mitigation**: The mobile UI must be designed for asynchronous states. Use skeleton loaders, optimistic UI updates (via TanStack Query), and clear messaging so users understand the system is working.

### 3. Mini App Bridge Security
- **Risk**: WebViews are vulnerable. A malicious Mini App could attempt to abuse the native bridge, scrape data, or spam the BFF.
- **Mitigation**: Enforce strict Content Security Policies (CSP) on Mini App bundles. The native bridge must strictly validate the `appId` and `scopes` on *every single call*. Implement aggressive rate-limiting on the bridge endpoints at the BFF level.

### 4. NATS Operational Monitoring
- **Risk**: NATS is lightweight, but if consumer groups fall behind or messages pile up, it can indicate a processing bottleneck.
- **Mitigation**: Monitor NATS consumer lag, message rates, and memory usage. Set up alerts for consumer lag exceeding a threshold (e.g., >1000 pending messages). If lag persists, scale consumer pods or investigate slow handlers.

---

## 5. Future-Proofing: When to Break the v1 Rules

The v1 architecture is designed to be pragmatic, but here are the triggers for when we must evolve the stack:

| Trigger | Evolution |
| :--- | :--- |
| **BFF pods exhaust DB connections** or we see connection timeouts. | Ensure **Supavisor** is correctly configured and scaled. |
| **Read-heavy domains** (Social/Commerce) starve Finance of DB IOPS. | Enable **Supabase Read Replicas** and route read-traffic via the BFF. |
| **Database lock contention** persists, or Finance requires strict physical isolation. | Spin up a **second, isolated Supabase instance** for Finance. |
| **NATS consumer lag** persists despite scaling consumers, or we need multi-region event replication. | Consider migrating to **Kafka** for advanced partitioning and cross-cluster replication. |
| **FalkorDB cache performance degrades** due to graph workloads or memory pressure. | **Separate FalkorDB**: Move it to a dedicated graph service, replace it in the cache layer with standard Redis. |
| **Users demand self-custody** of their crypto assets. | Extend the `FinanceContract` to support non-custodial flows. |
| **Product requires external network effects** for the social graph. | Flip the switch on **GoToSocial federation** (update k8s NetworkPolicy and GTS config). |
| **Mini App ecosystem explodes** and bundle downloads become a bottleneck. | Move Mini App bundle storage from MinIO to a **dedicated global CDN**. |

---

## 6. Infrastructure Topology Summary

| Component | Role | Technology | Phase |
| :--- | :--- | :--- | :--- |
| **Database** | Relational data, domain schemas | **Supabase** (Postgres + PostgREST + Realtime) | v1+ |
| **Connection Pooling** | BFF → Postgres connection management | **Supavisor** | v1+ |
| **Event Backbone** | Event streaming, sagas, outbox pattern | **NATS JetStream** | v1+ |
| **Cache & Sessions** | BFF caching, refresh tokens, rate limiting, distributed locks | **FalkorDB** (RESP-compatible) | v1+ |
| **Graph Workloads** | (Future) Social graphs, Commerce recommendations | **FalkorDB** (graph features) or **Dedicated Redis** | v2/v3 |
| **Object Storage** | Media, Mini App bundles, backups | **MinIO** | v1+ |

