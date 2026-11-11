# Domain SDK Architecture — DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

## Goal

Expose the NestJS server as a Backend-for-Frontend (BFF) to the Expo mobile app through a
typed, domain-isolated abstraction layer. Each business domain becomes a standalone
TypeScript library; a top-level SDK composes them into one client surface.

```
mobile app ──HTTP/WS──▶ Nest BFF ──▶ domain adapters ──▶ k8s services
                                     (libs/domain/*)      (infra/*.yaml)
```

## Domains & Downstream Mapping

| Domain          | Lib                       | BFF Module                 | Downstream k8s services (infra/)                                   |
|-----------------|---------------------------|----------------------------|--------------------------------------------------------------------|
| Identity        | @project/domain-identity  | DomainIdentityModule       | identity-server, identity-worker, Authentik                        |
| Finance         | @project/domain-finance   | DomainFinanceModule        | finance-ledger, finance-processor, finance-connector, FireFly/Besu, ethereum |
| Commerce        | @project/domain-commerce  | DomainCommerceModule       | commerce-api, commerce-worker, Vendure, commerce-media             |
| Social          | @project/domain-social    | DomainSocialModule         | social-api, GoToSocial, social-storage                             |
| Communications  | @project/domain-communications | DomainCommunicationsModule | communication-messaging, communication-media, ejabberd, LiveKit |

Shared substrate (Supabase Postgres, Redis, MinIO) stays in `server/src/core` /
`storage` / `adapters` — domains depend on it, never duplicate it.

## Library Layout (Nx libs under `libs/domain/`)

Each domain lib is **transport-agnostic and framework-free** (plain TS, no Nest/RN deps)
so it can be consumed by the server AND the mobile app:

```
libs/domain/identity/
├── project.json               # @nx/js lib
├── src/
│   ├── index.ts               # public API barrel
│   ├── types/                 # DTOs (re-exported from @project/shared-types where applicable)
│   │   └── identity.dto.ts
│   ├── contracts/             # THE key piece: interface describing the domain capability
│   │   └── identity.contract.ts
│   └── client/                # HTTP implementation of the contract (fetch-based)
│       └── identity-client.ts
```

### Contracts-first principle

Every domain exports an interface (`IdentityContract`, `FinanceContract`, …). The Nest BFF
implements the contract server-side (controllers/services satisfy it); the client-side
implementation calls it over HTTP. This gives us:

1. Compile-time parity between BFF endpoints and SDK calls.
2. Ability to swap implementations (mocks in tests, direct service calls in monolith mode).
3. A stable boundary so domain teams evolve internals without breaking consumers.

## Top-Level SDK: `@project/sdk` (libs/sdk)

```ts
const client = createClient({ baseUrl, getToken, wsUrl? });
client.identity.session();
client.finance.balances();
client.commerce.catalog();
client.social.feed();
client.communications.conversations();
```

- Re-exports the five domain clients with shared config (auth headers, retries, error model).
- Shared `HttpClient` core (in `libs/sdk-core`): JWT bearer injection via `getToken()`,
  refresh hook on 401, Zod validation at runtime boundaries, normalized `SdkError`.
- Optional realtime channel (Socket.IO/WebSocket) namespaced per domain.

## BFF Surface in Nest

New module tree in `server/src/domain/`:

```
server/src/domain/
├── identity/        domain-identity.module.ts + identity.controller.ts (@Controller('v1/identity'))
├── finance/         ...
├── commerce/        ...
├── social/          ...
└── communications/  ...
```

- Controllers implement the domain contracts, delegate to existing services
  (auth, users, storage, adapters) or downstream HTTP calls into cluster services.
- Global prefix `v1`; versioning lives at the BFF edge so downstream services stay free to change.
- Auth guard (passport-jwt / Authentik OIDC) applied at the BFF; domains assume an
  authenticated principal (`req.user`) and enforce per-domain authorization policies.
- Existing feature modules migrate behind domain controllers incrementally; old routes
  remain until the mobile app switches over.

## Error & Response Model (defined once, in libs/sdk-core)

```ts
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: SdkError };
interface SdkError { code: string; message: string; details?: unknown; requestId?: string }
```

- Nest exception filter emits this shape; SDK throws typed `SdkError`.
- `requestId` correlation header (`x-request-id`) threaded through BFF → downstream.

## Config / Env

- Server reads downstream base URLs from env (k8s Service DNS names):
  `IDENTITY_URL`, `FINANCE_LEDGER_URL`, `COMMERCE_API_URL`, `SOCIAL_API_URL`,
  `XMPP_URL` / `LIVEKIT_URL`, etc. One `DomainConfigService` wraps them.
- Mobile only needs `EXPO_PUBLIC_BFF_URL` (+ websocket URL). The topology of the cluster
  is invisible to clients — that is the point of the BFF.

## Build & DX

- Path aliases added to `tsconfig.base.json` (`@project/domain-*`, `@project/sdk`, `@project/sdk-core`).
- Contract conformance tests: jest suite asserting each Nest controller satisfies its contract
  (type-level check + runtime route tests).

## Rollout Plan

1. **Phase 0** — Scaffold `libs/domain/*` (5 libs) + `libs/sdk-core` + `libs/sdk`; wire tsconfig paths; CI build green.
2. **Phase 1** — Identity vertical slice: contract → BFF controller wrapping existing auth/users → fetch client → SDK wiring → mobile login uses `client.identity.*`.
3. **Phase 2** — Remaining domains in priority order (Finance → Commerce → Communications → Social), each following the identity template.
4. **Phase 3** — Realtime channels, pagination/filter conventions, idempotency keys for finance mutations, mini-app sandbox hooks.

## Open Decisions

1. Naming scope: `@project/*` vs org package name? (Placeholders used.)
2. Runtime validation: keep Zod at SDK boundaries, or generate DTO validators from OpenAPI/Swagger emitted by Nest?
3. Should domain libs ship only contracts+types to mobile with HTTP clients auto-generated from Nest's Swagger, or hand-written fetch clients as proposed above?
4. Auth flow in mobile: full OIDC redirect via expo-auth-session against Authentik, with the BFF issuing its own short-lived JWTs? (Recommended.)
5. Version per-domain (`/v1/finance` independently) or lockstep the whole BFF at `/v1`? (Recommend lockstep v1 now, per-domain opt-in later.)
