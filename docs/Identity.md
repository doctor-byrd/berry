# Identity Domain — Architecture & Implementation Plan - DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`

Scope: single sign-on via Authentik (OIDC/OAuth2), user lifecycle, and event-driven
provisioning/de-provisioning of accounts in every downstream domain service.

Guiding constraint: **v1 pragmatism** — reuse existing infra (Supabase Postgres, Redis,
Authentik already deployed under `infra/`), no new brokers or sidecars, minimal moving parts.

---

## 1. Responsibilities & Boundaries

The Identity domain owns:

1. **Authentication** — OIDC code+PKCE flow with Authentik; Nest is the only party that
   exchanges codes and validates tokens. Clients never talk to Authentik directly.
2. **User record of truth** — an internal `users` table in the shared Supabase Postgres,
   keyed by a UUID, mapped to `authentik_sub`. This internal id is the **join key for every
   downstream service**.
3. **Provisioning saga** — orchestrating account creation in Vendure, Blnk, FireFly III,
   GoToSocial, ejabberd, LiveKit, etc., via events.
4. **Deletion lifecycle** — soft delete + cascading de-provisioning saga.

It does NOT own: domain data in downstream services, messaging media, ledger logic. Those
live behind their own domain modules; Identity only knows *that* they were provisioned and
the external ids returned.

### Nest-first rule

All user-facing operations go through the Nest BFF first so we retain observability and
control. **Exception:** after Nest has validated authn/authz, the client may open *direct*
connections to downstream services using short-lived, scoped credentials minted by Nest
(e.g., ejabberd BOSH/WebSocket JWT, LiveKit access tokens). The direct connection is
bootstrap-by-BFF, not bypass-by-BFF.

---

## 2. System Credentials Decision

Super-app best practice (WeChat/Line/Telegram model): **the platform holds one system
(service) credential per downstream service; end users never hold downstream credentials.**

- Nest authenticates to downstream admin APIs with per-service service-account keys stored
  as k8s Secrets injected via env (`VENDURE_ADMIN_TOKEN`, `BLNK_SECRET_KEY`, `FIREFLY_CLIENT_ID/SECRET`, `GOTOSOCIAL_APP_TOKEN`, `LIVEKIT_API_KEY/SECRET`, `AUTHENTIK_ADMIN_TOKEN`).
- Trust boundary = a mapping table row created only by the provisioning saga:
  `external_account_id ⇔ internal_user_id`. Handlers must verify this mapping before any
  proxied call; the mobile client can never address another user's external account.
- Per-user OAuth linkage is rejected for v1: most of these backends (Blnk, Vendure,
  GoToSocial app tokens) don't support it meaningfully, and it multiplies secret management cost.
- Where a downstream service *does* need per-user credentials for direct client connections
  (ejabberd, LiveKit), Nest mints **ephemeral, short-TTL tokens** at request time
  (see §6 exception path). These are derived from the system credential and scoped to one user/session.

Secret hygiene: no secrets in code or ConfigMaps; all via k8s Secrets → env; rotation is a
deploy-time concern.

---

## 3. Authentication Flow (OIDC Code + PKCE)

```
mobile ──(1) GET /v1/identity/auth/url────────▶ Nest
     ◀── authorize URL (client_id, redirect_uri, state, code_challenge)
mobile ──(2) browser: Authentik hosted login/signup──▶ Authentik
Authentik ──(3) redirect w/ code──▶ mobile deep link ──(4) POST /v1/identity/auth/token {code, verifier}──▶ Nest
Nest ──(5) exchange at Authentik token endpoint (client secret stays in Nest)──▶
Nest ──(6) validate ID token (JWKS), upsert local user by authentik_sub──▶
     ◀── session bundle: { accessToken(Nest-signed), refreshToken, expiresIn, profile }
```

Decisions:

- **Nest-signed session JWT** (not raw Authentik tokens) handed to clients: stable claims
  (`sub` = internal user id, `sid`, `scope`), independent TTL policy, and lets us revoke via
  a Redis denylist without touching Authentik. Authentik tokens stay server-side in an
  encrypted `auth_sessions` row (refresh rotation).
- Signup happens through the same hosted flow (Authentik enrollment enabled); Nest learns
  about new users two ways: the code-exchange upsert **and** Authentik webhooks (§4) —
  webhook is the trigger for provisioning even when the user record was created out-of-band
  (admin console, future social logins).
- Refresh: `POST /v1/identity/auth/refresh` with Nest refresh token; rotation + reuse
  detection (reuse ⇒ revoke family). Access token TTL 15 min, refresh 30 days.
- Mobile storage: Expo `SecureStore` for tokens (SDK handles this; see §7).

Existing `server/src/auth` (Authentik OIDC passport strategy) becomes the guard layer for
`/v1/*` routes — we adapt it to accept the Nest-signed JWT rather than replacing it.

---

## 4. Event Backbone (Redis Streams)

Confirmed choice: **Redis Streams with consumer groups** for durable domain events
(at-least-once, PEL, replay). BullMQ (already used) remains for scheduled/retryable jobs.
No Kafka/NATS in v1 — Redis is already deployed (`infra/redis-deployment.yaml`).

Conventions:

- Stream names: `events:identity`, `events:provisioning` (one stream per aggregate area;
  consumers read groups like `cg:provisioner:vendure`).
- Envelope (all streams):
  ```json
  { "id": "ulid", "type": "identity.user.created", "occurredAt": "iso",
    "aggregateId": "<internalUserId>", "payload": {}, "traceId": "...", "version": 1 }
  ```
- **Outbox pattern**: any SQL write that emits an event writes an `event_outbox` row in the
  same transaction; a lightweight poller/cron drains outbox → `XADD` → marks sent.
  Guarantees no lost events on crash. (Cron drain is fine at our scale; no CDC needed in v1.)
- Consumer rules: idempotent handlers (dedupe by envelope `id` in `events_processed`),
  max-delivery attempts then move to `events:deadletter` + alert log.

### Authentik webhooks

`POST /v1/identity/webhooks/authentik` — verified with Authentik's HMAC/shared-secret header,
raw body persisted to `webhook_inbox` (idempotency on event uuid), converted to an internal
Stream event, respond 2xx fast. Never process inline.

---

## 5. Provisioning Saga

Trigger: `identity.user.created` (from code-exchange upsert or webhook).

```
                    ┌─▶ vendure   ─┐
identity.user.created├─▶ blnk      ─┤ each handler: check mapping → create external
(coordinator spawns ├─▶ firefly    ─┤ account (idempotency key = internal user id) →
tasks per service)  ├─▶ gotosocial  ─┤ emit provisioning.<svc>.completed|failed
                    ├─▶ ejabberd    ─┤
                    └─▶ livekit     ─┘
                       ▼
        coordinator tracks user_provisionings rows
        all completed → identity.user.provisioned
        any failed after retries → status=blocked + ops alert (no rollback of siblings in v1)
```

Schema (shared Postgres):

- `users` (id uuid pk, authentik_sub unique, email, display_name, status enum
  `active|provisioning|suspended|deleted_pending|deleted`, timestamps, deleted_at)
- `user_external_accounts` (user_id fk, service enum, external_id, metadata jsonb,
  status, provisioned_at) — **unique (service, external_id)** and **unique (user_id, service)**.
- `user_provisionings` (user_id, service, state `pending|running|succeeded|failed|blocked`,
  attempts, last_error) — the saga ledger.
- `auth_sessions` (family_id, user_id, hashed refresh token, authentik tokens encrypted, revoked_at)
- `event_outbox`, `events_processed`, `webhook_inbox`

Handlers are thin adapters per service (`server/src/domain/identity/provisioners/*`), each
implementing `create / suspend / delete / fetchStatus`. All deletes are soft where supported;
where not (Blnk), mark records inactive/metadata flag.

Client visibility: mobile polls `GET /v1/identity/me/provisioning` (or subscribes later) →
returns coarse `{status, features: {commerce: ready|pending|failed, ...}}`. **Feature gating**:
each domain module checks the provisioning state before serving that feature. Downstream
service names never leak into the SDK contract beyond opaque feature keys.

Retry policy (v1): exponential backoff via BullMQ delayed jobs (max 5), then `blocked`.

---

## 6. Deletion Lifecycle

Requested semantics: **soft delete + cascading deletes**, GDPR-ish timeline.

1. `DELETE /v1/identity/me` → user.status=`deleted_pending`, grace period 30 days,
   sessions revoked, immediate logout everywhere. Emit `identity.user.delete_requested`.
2. During grace: reactivation possible (`POST /v1/identity/me/reactivate`) — nothing
   destructive has happened yet.
3. After grace (scheduled job): emit `identity.user.deleted` → saga mirrors provisioning:
   each provisioner soft-deletes/suspends the external account, exports anything portable
   (avatar/media → MinIO archive bucket) before deletion where feasible.
4. On full completion: anonymize `users` row (keep tombstone + external-id hashes for
   anti-re-registration/dedupe), hard-delete `auth_sessions`, mark provisioning rows done.
5. Direct-connection exception: ephemeral ejabberd/LiveKit tokens have ≤5-min TTL, so
   revocation is effectively automatic; long-lived downstream creds are never given out.

---

## 7. SDK Contract

Framework-free TS lib per `docs/sdk-architecture.md`; Nest controller implements parity.

```ts
interface IdentityContract {
  getAuthorizeUrl(params: { redirectUri: string; prompt?: 'login' | 'consent' }): Promise<AuthorizeUrlResponse>;
  exchangeCode(body: { code: string; codeVerifier: string; redirectUri: string }): Promise<SessionBundle>;
  refresh(refreshToken: string): Promise<SessionBundle>;
  logout(refreshToken: string): Promise<void>;
  session(): Promise<SessionSummary>;              // who am I (profile + scopes)
  provisioningStatus(): Promise<ProvisioningState>; // coarse feature map
  requestDeletion(): Promise<{ graceEndsAt: string }>;
  reactivate(): Promise<SessionBundle>;
}
```

`libs/sdk-core` responsibilities: token storage adapter (SecureStore on RN), auto-refresh on
401 with request queueing, Zod validation of responses, normalized `SdkError`.

---

## 8. Module Layout in Nest

```
server/src/domain/identity/
├── domain-identity.module.ts
├── identity.controller.ts          # /v1/identity/* (implements IdentityContract)
├── webhooks.controller.ts          # /v1/identity/webhooks/authentik
├── services/
│   ├── oidc.service.ts             # code exchange, JWKS, session mint/revoke
│   ├── users.service.ts            # upsert, status transitions
│   ├── provisioning-coordinator.service.ts
│   └── deletion.service.ts
├── provisioners/                   # vendure/blnk/firefly/gotosocial/ejabberd/livekit adapters
├── listeners/                      # stream consumers (identity.*, provisioning.*)
└── entities/                       # users, user_external_accounts, user_provisionings, auth_sessions (+ outbox tables in core)
```

Shared substrate reused, not duplicated: TypeORM/Supabase (`core`), Redis client wrapper
(`core`), BullMQ config, MinIO (`storage`). New in `core`: `EventBusService` (XADD/XREADGROUP
wrapper) + outbox drain job — built once here, used by all five domains.

---

## 9. Roadmap

1. **P0** — `EventBusService` + outbox tables + envelope types in `core` (testable with fakeredis).
2. **P0** — Lib scaffold `libs/domain/identity` (types/contract/client) + `sdk-core` HTTP client.
3. **P0** — OIDC code+PKCE endpoints in Nest; adapt existing auth guard to Nest-signed JWT;
   mobile login E2E against deployed Authentik.
4. **P1** — Users/external-accounts/saga schema + coordinator; first provisioner: Vendure
   (proves the pattern end-to-end).
5. **P1** — Remaining provisioners (blnk, firefly, gotosocial, ejabberd, livekit) as parallel work.
6. **P1** — Authentik webhook ingestion; provisioning-status endpoint + feature gating hook.
7. **P2** — Deletion saga + scheduled grace-period jobs; dead-letter alerting; refresh-reuse detection.

Out of scope for v1: passkeys/social IdPs, device-bound tokens, NATS/Kafka migration,
per-user downstream OAuth linkage, cross-domain identity federation beyond internal id.
