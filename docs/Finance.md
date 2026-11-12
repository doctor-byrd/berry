# Finance Domain — Architecture & Implementation Plan - DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`

Scope: payments and money movement for the super app — user wallets, balances, P2P and
merchant payments (QR), internal transfers, and on-chain stablecoin settlement.

Core technologies: **Blnk** (authoritative ledger of record) and **Hyperledger Firefly III**
(blockchain/orchestration rail to an EVM chain). Dev chain: Besu; production: any
EVM-compatible chain. Asset scope v1: **stablecoins only** (one or a small allowlist), not
general crypto/DeFi.

Guiding constraint: **v1 pragmatism** — reuse existing infra (Supabase Postgres, Redis
Streams/BullMQ already used by Identity, MinIO). No new brokers, no custody hardware, no
new chains tooling beyond what is deployed under `infra/`.

---

## 1. Responsibilities & Boundaries

The Finance domain owns:

1. **Ledger of record** — Blnk holds wallets, balances, and double-entry transaction
   history for every user and merchant account in the ecosystem. *Blnk is authoritative
   for "how much does user X have".* Nothing else is queried for balances.
2. **Settlement rail** — Firefly III + connectors move value on/off chain (deposits,
   withdrawals, treasury sweeps). *Firefly is authoritative for "what is on chain".*
3. **Payment intents** — QR-based P2P and merchant payment flows, invoices, and the
   reserve→capture saga consumed by Commerce.
4. **Reconciliation** — continuous agreement between Blnk ledger state and on-chain
   balances/events.

It does NOT own: authentication (Identity), catalog/order state (Commerce), social graph
(Social), message transport (Communications). Other domains consume Finance through its
contract/event surface only.

### Internal-first model (core decision)

- **Deposits**: user sends stablecoins to their assigned deposit address → confirmed
  on-chain → Finance credits the user's Blnk wallet. On-chain confirmation gates the
  available balance.
- **Everything after deposit is internal**: P2P transfers, merchant payments, marketplace
  checkouts are Blnk-only ledger entries. Instant, free, reversible-by-saga, no gas.
- **Withdrawals**: debit Blnk first (hold), then Firefly executes on-chain send; release
  hold on confirmation, refund ledger entry on failure.
- Consequence: ~99% of user transactions never touch a chain. The chain is a
  bridge/in/out path plus optional proof-of-reserves, not the transaction medium.

### Custodial model (core decision)

v1 is **custodial**: the platform holds on-chain keys (single treasury per asset with
per-user deposit addresses via Firefly accounts / HD derivation where the connector
supports it). Users see balances and payment capabilities, not seed phrases. Rationale:
UX simplicity, gas abstraction (users never pay gas), instant internal transfers, and
consistency with a messaging super-app pattern (WeChat Pay / UPI-style wallets). Non-
custodial/self-custody is explicitly out of scope for v1; the contract surface keeps this
possible later (see §8 open items).

### Nest-first rule (inherited from Identity)

All finance operations go through the Nest BFF. Clients never talk to Blnk or Firefly
directly. System credentials for both live only in Nest secrets; the BFF maps
`internalUserId → blnkAccountId / fireflyKeyId` using the Identity domain's
`user_external_accounts` table.

---

## 2. Data Model (Postgres, shared Supabase instance)

Finance-owned tables (schema prefix `finance_` or separate schema — v1: same database,
distinct tables, consistent with Identity's approach):

| Table | Purpose |
|---|---|
| `finance_wallets` | 1:1 with internal user (or merchant/org) id. Columns: `id`, `owner_type` (user/merchant/treasury/escrow), `owner_id`, `currency` (stablecoin code), `blnk_account_id`, `status`. Unique on `(owner_id, currency)`. |
| `finance_ledger_refs` | Maps Blnk ledger/transaction ids ↔ our internal `transaction_id`. Every money movement gets one row here first. |
| `finance_payment_intents` | QR/invoice objects: `id`, `kind` (p2p/merchant/marketplace), `payer_id?`, `payee_id`, `amount`, `currency`, `memo`, `status` (pending/reserved/captured/settled/expired/cancelled), `expires_at`, `qr_nonce`. |
| `finance_transfers` | Internal Blnk debits/credits with `intent_id`, `idempotency_key`, direction, and link to `finance_ledger_refs`. |
| `finance_chain_accounts` | Deposit addresses / Firefly token accounts per wallet or treasury, with `firefly_account_id`, derivation info, chain id. |
| `finance_deposits` / `finance_withdrawals` | On-chain in/out requests: tx hash, confirmations, status, linked credit/debit ledger entry. |
| `finance_reconciliation_runs` | Last-checked block height, diffs found, resolutions. |

**Idempotency rule:** every mutating finance endpoint requires an
`Idempotency-Key` header (client-generated UUID). Stored and replayed — a retried network
call can never double-spend or double-credit. This is the single most important invariant
in the domain.

**Money representation:** integer minor units everywhere (e.g., USDC = 6 decimals → store
as bigint string/numeric). Never floats. Currency + scale stored alongside.

---

## 3. Event Surface (Redis Streams, per Identity conventions)

Stream: `events:finance`. Outbox pattern identical to Identity (write event row in the
same Postgres transaction as the state change; publisher drains to stream).

Events emitted (consumers noted):

| Event | Payload (key fields) | Consumers |
|---|---|---|
| `finance.wallet.provisioned` | wallet_id, owner_id, currency | Identity saga completion, SDK status |
| `finance.deposit.detected` | address, amount, currency, tx_hash | Notifications (Communications) |
| `finance.deposit.credited` | wallet_id, amount, ledger_ref | SDK, Analytics |
| `finance.transfer.completed` | intent_id, payer, payee, amount | Communications (chat receipt), Commerce |
| `finance.withdrawal.requested/completed/failed` | wallet_id, amount, tx_hash | SDK, ops alerting |
| `finance.intent.reserved` / `.captured` / `.released` / `.expired` | intent_id, order ref | Commerce checkout saga |
| `finance.reconciliation.diff` | wallet/account, expected vs actual | Ops alerting only — never auto-fixes |

Events consumed:

- `identity.user.created` → provision wallet(s) (Blnk account + wallet row + deposit
  address request). Part of the Identity provisioning saga; Finance registers as a
  participant exactly like Vendure/ejabberd did.
- `identity.user.deletion.*` → freeze wallets, zero-out/sweep to treasury per deletion
  policy, emit `finance.wallet.closed`.

Contract-first rule: event schemas live in the `finance` SDK package (shared-types style)
and are validated on both publish and consume (zod), same as Identity.

---

## 4. QR Payment System

Two QR kinds, both resolved by the BFF — **the QR never contains money instructions,
only a reference.**

1. **Static QR (pay me)** — encodes `https://{deep_link_host}/pay/u/{handle}?n={nonce}`
   printed/displayed by a user or merchant. Scanning opens the app (or falls back to a
   web page); the app calls `POST /finance/intents` with payee handle + nonce, then the
   payer confirms amount. Good for recurring merchants, personal handles.
2. **Dynamic QR (invoice)** — merchant/checkout generates an intent *first*
   (`POST /finance/intents` with fixed amount/currency/expiry), receives a short-lived
   URL embedding only the `intent_id` + signature. Scanner resolves the intent via BFF,
   shows payee name, amount, memo; payer confirms → capture. Expires in N minutes.

Security rules:
- Intent URLs are signed (HMAC) and single-use-ish (state machine prevents replay:
  `pending → reserved → captured`, terminal states immutable).
- Amount is set by the *payee side* in dynamic mode; static mode requires explicit payer
  entry. Payer confirmation always happens inside the authenticated app against BFF data,
  never against QR contents.
- Cross-app scanners (generic camera apps) hit a public landing page that deep-links into
  the app — standard universal-link pattern.

Flows:
- **P2P**: resolve intent → Blnk internal debit/credit in one saga step →
  `finance.transfer.completed` → chat notification.
- **Merchant (Commerce)**: checkout creates a marketplace intent; cart total reserved at
  order placement (`intent.reserved`), captured on order acceptance, released on cancel/
  timeout. Same primitives as merchant payments — Vendure never talks to Blnk directly.

---

## 5. Provisioning Saga Participation

On `identity.user.created`, Finance must create (each step idempotent, keyed by internal
user id):

1. Blnk ledger/account for the default stablecoin (system credential; map into
   `finance_wallets.blnk_account_id`).
2. Request deposit address from Firefly connector (async; may pend until chain op
   completes — wallet is usable for internal features immediately, deposits gated on
   address availability).
3. Emit `finance.wallet.provisioned`; report success to the Identity saga coordinator.

Failure semantics: retries via BullMQ with backoff; permanent failure marks the wallet
`provisioning_failed` and surfaces in the user's `getProvisioningStatus` (Identity) —
never silently swallowed.

---

## 6. Reconciliation Loop

Scheduled BullMQ job (every N blocks / M minutes):

1. Pull chain balance & transfer events per `finance_chain_accounts` (via Firefly or RPC).
2. Compute expected balance from Blnk ledger entries marked settled.
3. Diff → write `finance_reconciliation_runs`; any non-zero diff emits
   `finance.reconciliation.diff` for ops alerting.

Policy: **reconciliation detects, humans resolve.** v1 has no automated corrections —
auto-adjusting a financial ledger is how silent corruption happens. Diffs block treasury
sweeps until cleared (simple circuit breaker flag in DB).

---

## 7. Nest Module Structure

```
server/src/finance/
  finance.module.ts
  auth/            # guards reusing identity session; role checks (treasury ops)
  wallets/         # WalletController (BFF endpoints), WalletService
  payments/        # IntentsController, QrService (encode/sign/resolve), TransferService
  ledger/          # BlnkClient (typed HTTP wrapper, system creds, retry+idempotency)
  chain/           # FireflyClient, DepositWatcher, WithdrawalExecutor
  events/          # finance publisher/consumers (uses EventBusService from identity doc)
  reconciliation/  # cron jobs, diff reporting
  dto/             # zod schemas re-exported from @scope/finance sdk package
```

- `BlnkClient` and `FireflyClient` are the only places credentials appear; they read from
  env/secret store, log redacted.
- Controllers expose only BFF-shaped DTOs (balances, intents, transfers) — never raw Blnk
  or Firefly payloads. Downstream response shapes are adapter-isolated so Blnk upgrades
  don't leak into the SDK.

### BFF endpoints (v1 surface)

| Method | Path | Purpose |
|---|---|---|
| GET | `/finance/wallet` | balances per currency, wallet status |
| POST | `/finance/transfers` | P2P by handle/id (idempotency key required) |
| POST | `/finance/intents` | create invoice/dynamic QR intent |
| GET | `/finance/intents/:id` | resolve scanned QR |
| POST | `/finance/intents/:id/capture` | payer confirms & pays |
| POST | `/finance/intents/:id/cancel` | payee cancels |
| GET | `/finance/transactions` | paginated statement (cursor) |
| GET | `/finance/deposits/:address/status` | on-chain deposit tracking |
| POST | `/finance/withdrawals` | request on-chain withdrawal |

---

## 8. SDK Contract (`@scope/finance`)

Framework-free package, mirrors Identity's structure: `types.ts` (zod schemas for
wallet/intent/transfer/statement), `client.ts` (fetch-based, implements
`FinanceContract`), `events.ts` (event schemas for Redis consumers).

```ts
interface FinanceContract {
  getWallet(): Promise<WalletSummary>;                 // balances, status, deposit addr
  listTransactions(q: StatementQuery): Promise<Page<Transaction>>;
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>; // returns qrPayload/url
  resolveIntent(ref: string): Promise<ResolvedIntent>;
  captureIntent(intentId: string, opts: { idempotencyKey: string }): Promise<Transfer>;
  transferP2P(input: P2PInput & { idempotencyKey: string }): Promise<Transfer>;
  requestWithdrawal(input: WithdrawalInput & { idempotencyKey: string }): Promise<Withdrawal>;
  depositStatus(address: string): Promise<DepositStatus>;
}
```

Deliberately absent from the contract: anything mentioning Blnk, Firefly, Besu, chain ids,
or account numbers. Chain-specific concepts (tx hash, confirmations) appear only as
read-only status fields. This keeps the mobile app agnostic and preserves the option to
swap rails or (later) offer self-custody modes without breaking clients.

Open items (deferred, documented): non-custodial mode, multi-asset beyond the stablecoin
allowlist, off-ramp integration, regulatory/KYC tiering per jurisdiction.

---

## 9. Commerce Integration Contract

Commerce consumes Finance exclusively through:

1. `FinanceContract` methods called by Nest's Commerce module (server-side, same process
   allowed in v1 — modules, not microservices): create marketplace intent at checkout,
   capture on acceptance, release on cancel.
2. Events: `commerce.order.placed` (Finance may watch for metrics) and primarily
   Finance→Commerce via `finance.intent.captured` to mark orders paid.

Saga states shared as a type in `@scope/finance`: `reserved → captured → (refunded)` with
timeout-release. Refunds = new opposite-direction ledger entries (never deletions).

---

## 10. Security & Compliance Notes

- All system credentials in k8s Secrets; mounted env only for Nest pods.
- Per-transfer velocity limits stored in DB config (max amount/day) — cheap fraud brake.
- Audit trail: Blnk double-entry + `finance_ledger_refs` gives immutable history; no hard
  deletes of financial records anywhere (soft-delete flags only, mirroring Identity).
- Withdrawal to external address requires re-auth step (session freshness check) — reuse
  Identity's token validation.
- Webhook/callback endpoints from Firefly (if used for deposit events) verified with HMAC
  + replay window, same convention as Authentik webhooks.

---

## 11. Roadmap

- **P0 (vertical slice)**: `@scope/finance` scaffold; BlnkClient + wallet provisioning on
  `identity.user.created`; `GET /finance/wallet`; seeded treasury; internal P2P transfer
  with idempotency; statement endpoint. *(No chain yet — Blnk-only demoable.)*
- **P1**: QR intents (dynamic + static), capture flow, Communications receipt events,
  Commerce checkout saga, deposit watcher via Firefly/Besu devnet.
- **P2**: withdrawals, reconciliation loop + circuit breaker, velocity limits,
  multi-stablecoin allowlist, ops dashboards.

Each phase lands behind feature flags in the BFF so the mobile SDK can ship ahead of
downstream readiness (contract returns `not_provisioned` gracefully).
