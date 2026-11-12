# Platform Architecture & Scaling Strategy — DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`, `Identity.md`, `Finance.md`, `Commerce.md`, `Communications.md`, `Social.md`, `MiniApp.md`

Scope: Cross-cutting architectural principles, infrastructure scaling strategies (specifically tailored for self-hosted Supabase and FalkorDB), operational risk mitigation, and the evolutionary path from v1 pragmatism to hyper-scale.

Guiding constraint: **v1 pragmatism** — maximize developer velocity and user experience using shared physical infrastructure, while designing strict logical boundaries that allow for seamless horizontal scaling and physical separation when scale demands it.

---

## 1. Core Architectural Principles

The platform is built on five foundational pillars:

1. **Internal-First Financial Model**: The blockchain (FireFly/Besu) is strictly an on/off ramp. Blnk is the authoritative ledger. This eliminates gas fees for internal transfers, removes UX friction, and enables instant settlement.
2. **BFF + Contracts-First SDK**: All mobile traffic flows through a single NestJS BFF. The mobile app consumes a framework-free `@superapp/sdk` via thin, Promise-based clients, perfectly aligned with TanStack Query for client-side state management.
3. **Logical Isolation, Shared Physical Substrate**: Domains have strict logical boundaries (separate schemas, events, and contracts) but share physical infrastructure (Supabase, FalkorDB, MinIO) in v1 to minimize infrastructure tax.
4. **Event-Driven Sagas over Distributed Transactions**: Cross-domain workflows (provisioning, checkout) use Redis Streams (via FalkorDB) and the Outbox pattern for eventual consistency.
5. **Mini App Sandboxing**: Third-party apps run in isolated Ionic Portals (WebViews) and access platform services exclusively through a permissioned, scoped-JWT native bridge.

---

## 2. Data Layer & Scaling Strategy (The Supabase & FalkorDB Evolution)

In v1, all domains share a single self-hosted Supabase Postgres instance, and FalkorDB acts as our RESP-compatible Redis replacement. 

### 2.1 Database Scaling (Supabase Path)
*Architectural Decision:* We explicitly **avoid Citus** (Postgres sharding) because it fundamentally alters table storage metadata, which breaks Supabase's internal tooling (PostgREST, Realtime, GoTrue). Instead, we scale using Supabase's native horizontal scaling features.

* **Phase 1 (v1) - Connection Pooling:** 
  As the NestJS BFF scales horizontally, we will exhaust native Postgres connections. We will configure NestJS TypeORM to route all connections through **Supavisor** (Supabase's Rust-based connection pooler), allowing thousands of BFF pods to share a small pool of actual database connections.
* **Phase 2 (v2) - Read Replicas:** 
  When heavy read traffic (Social feeds, Commerce browsing) starves the primary database of IOPS needed for Finance writes, we will enable **Supabase Read Replicas** via logical replication. The BFF will be configured to route `SELECT` queries to the Read Replica endpoint, and `INSERT/UPDATE/DELETE` to the Primary.
* **Phase 3 (v3) - Physical Separation:** 
  When Read Replicas are no longer sufficient, we will **spin up a second, entirely separate Supabase Postgres instance** in k8s. We will migrate the Finance schema to the new instance, using the NestJS BFF to orchestrate cross-database reads. This preserves the integrity of Supabase's tooling while eliminating the bottleneck.

### 2.2 Event & Cache Backbone (FalkorDB Path)
*Architectural Decision:* In v1, FalkorDB is used purely as a standard, RESP-compatible Redis instance for Streams, Locks, and Caching, keeping the infrastructure footprint minimal.

* **Phase 1 (v1) - Unified Backbone:** 
  FalkorDB handles Redis Streams (Outbox pattern, `events:finance`), distributed locks (saga coordination), BFF caching, and session storage.
* **Phase 2 (v2/v3) - Topology Separation:** 
  When the product actually requires complex graph traversals (e.g., Social follower graphs, Commerce recommendations), we will **replace FalkorDB in the event backbone with a standard Redis instance** (or Redis Cluster). FalkorDB will then be moved to a dedicated, isolated service strictly for graph workloads. This prevents memory-intensive graph queries from causing latency spikes in critical financial event streams.

---

## 3. BFF Horizontal Scaling & Resilience

The NestJS BFF is currently a single point of failure for the mobile client. To scale it horizontally and eliminate this risk, the BFF must be strictly stateless and leverage FalkorDB/Supavisor for all coordination.

### Stateless Design
- **No in-memory session storage**: All session data (refresh tokens, Mini App scoped JWTs) must live in FalkorDB.
- **No request-affinity**: Any BFF pod must be able to handle any request. 
- **Stateless Outbox**: Multiple BFF pods can safely drain the `event_outbox` table using FalkorDB distributed locks to prevent duplicate event publishing.

### FalkorDB/Supavisor as the Coordination Layer
- **Session Store**: Maps `refresh_token → user_id` and `scoped_jwt → permissions`.
- **Rate Limiting**: Tracks per-user and per-Mini-App request counts using atomic counters.
- **Saga Coordination**: Uses distributed locks (e.g., `SETNX saga:lock:{orderId}`) to ensure only one pod processes a specific saga step at a time.
- **Database Pooling**: All BFF pods connect to the database exclusively via Supavisor.

### Kubernetes Deployment Patterns
- **Horizontal Pod Autoscaler (HPA)**: Scale BFF pods based on CPU/memory or custom metrics (e.g., active WebSocket connections, request rate).
- **Probes**: Readiness probes must verify successful connections to FalkorDB and Supavisor before k8s routes traffic to a pod.
- **Graceful Shutdown**: Implement `onModuleDestroy` hooks in NestJS to drain in-flight requests and close WebSocket connections cleanly before pod termination.

### Multi-Tier Caching Strategy
- **Tier 1 (Client)**: TanStack Query handles client-side caching, deduplication, and stale-while-revalidate. If the BFF experiences a brief outage, the mobile app shows cached data rather than a blank screen.
- **Tier 2 (Server)**: FalkorDB caches hot read paths on the BFF (e.g., product catalogs, social timelines, seller profiles).
- **Tier 3 (Invalidation)**: Cache invalidation is driven by events. When Commerce updates a product, it emits `commerce.product.updated` → BFF listens and invalidates the specific FalkorDB cache key.

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

### 4. FalkorDB Memory Pressure (v1 Specific)
- **Risk**: Because FalkorDB is acting as both our event backbone and our experimental graph DB in v1, a poorly optimized graph query could consume memory and delay critical Redis Stream processing (e.g., Finance events).
- **Mitigation**: Strictly monitor FalkorDB memory and stream consumer lag in v1. If lag occurs, immediately accelerate the Phase 2 topology separation (moving graph workloads out of FalkorDB's Redis role).

---

## 5. Future-Proofing: When to Break the v1 Rules

The v1 architecture is designed to be pragmatic, but here are the triggers for when we must evolve the stack:

| Trigger | Evolution |
| :--- | :--- |
| **BFF pods exhaust DB connections** or we see connection timeouts. | Ensure **Supavisor** is correctly configured and scaled. |
| **Read-heavy domains** (Social/Commerce) starve Finance of DB IOPS. | Enable **Supabase Read Replicas** and route read-traffic via the BFF. |
| **Database lock contention** persists, or Finance requires strict physical isolation. | Spin up a **second, isolated Supabase instance** for Finance. |
| **Redis Streams consumer groups fall behind** or we need >7 days of event retention. | Introduce **Kafka or NATS** for durable, high-throughput event streaming. |
| **Product requires actual graph traversals** (Social graphs, recommendations). | **Separate FalkorDB**: Move it to a dedicated graph service, replace it in the event backbone with standard Redis. |
| **Users demand self-custody** of their crypto assets. | Extend the `FinanceContract` to support non-custodial flows. |
| **Product requires external network effects** for the social graph. | Flip the switch on **GoToSocial federation** (update k8s NetworkPolicy and GTS config). |
| **Mini App ecosystem explodes** and bundle downloads become a bottleneck. | Move Mini App bundle storage from MinIO to a **dedicated global CDN**. |

