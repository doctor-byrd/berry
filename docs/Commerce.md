# Commerce Domain — Architecture & Implementation Plan - DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`

Scope: multi-vendor marketplace — product catalog, seller (vendor) storefronts, carts,
checkout, orders, fulfilment, and refunds. Core technology: **Vendure v3** deployed as
`commerce-api` + `commerce-worker` (+ `commerce-media`) under `infra/`. No third-party
plugins in v1; everything is built from the Vendure core feature set.

Guiding constraint: **v1 pragmatism** — reuse existing infra (Supabase Postgres, Redis
Streams/BullMQ, MinIO). The only Vendure-specific infrastructure addition is one Postgres
database for the Vendure shop itself (already provisioned via `db_init-configmap.yaml`).

---

## 1. Responsibilities & Boundaries

The Commerce domain owns:

1. **Catalog & merchandising** — products, variants, collections, facets, assets, search.
2. **Seller lifecycle** — onboarding vendors, granting them a storefront, moderating
   listings.
3. **Order pipeline** — cart → checkout → order state machine (Vendure OrderModule),
   payments transition, fulfilment, refunds.
4. **Marketplace policy** — commission model, payout schedule, dispute/return rules.

It does NOT own: authentication (Identity), money movement / ledger (Finance), messaging
(Communications), social graph (Social). In particular, **Commerce never touches Blnk or
Firefly directly**; it consumes Finance's saga primitives (reserve/capture/release) via
events and contract calls, exactly as agreed in the Finance doc.

### Nest-first rule (inherited)

All buyer traffic goes through the Nest BFF. Vendure's Shop API is never exposed to the
mobile app. Admin traffic also proxies through Nest (with role checks) except where noted
(Seller Dashboard, §6).

---

## 2. Core decision: Channels = Sellers

Per the Vendure multi-vendor docs, each **Channel is assigned to one Seller**. We adopt
this as the tenancy primitive:

```
internal user (Identity) ──► seller record (Nest) ──► Vendure Channel (1:1)
                                   └── channelToken (public slug, e.g. "acme-co")
```

Consequences and rules:

- A seller's products, orders, customers, and inventory are automatically isolated by
  Vendure's channel scoping — no custom scoping layer needed. This is the strongest
  reason to use Channels rather than facets/tags for vendors.
- **Default channel** (`defaultChannelToken`) is reserved for the platform itself
  (first-party goods, promotions, cross-market aggregations). Never assign a seller to it.
- The **global channel** is used sparingly: only for truly platform-wide content
  (e.g. a curated "marketplace picks" collection owned by the platform).
- One Vendure `Customer` per buyer *per channel* is Vendure's data model. We do NOT fight
  this: our internal user id is the join key (§5 mapping table); Vendure customers are
  treated as channel-local projections, not identities. Identity always wins.

### What we give up (accepted trade-offs)

- **No cross-channel cart/checkout in v1.** A customer checks out within one seller's
  channel = one order per seller. Multi-seller carts are handled client-side as N
  sequential checkouts (see §7 open items for a possible later "parent order" view).
- **No shared stock allocations across channels** — fine, since sellers don't share
  inventory anyway.
- Facet-based vendor search requires aggregation at the BFF level (§4).

---

## 3. Provisioning a seller (event-driven, reuses Identity machinery)

Seller onboarding is a saga on the same Redis Streams + BullMQ + outbox foundation as
Identity provisioning. No new broker, no new job system.

```
commerce.seller.onboard_requested   (BFF emits after KYC-lite checks pass)
        │  BullMQ consumer: SellerProvisioner
        ▼
1. Vendure Admin API (system credentials): createChannel(token=`seller-{uuid}`,
   defaultCurrencyCode=USD, defaultLanguageCode=en)
2. Create seller's root Collection + facet defaults
3. Write seller row + channel mapping in Nest DB (idempotent, keyed by internal userId)
4. Emit commerce.seller.provisioned | .failed(attempts)
```

- **Idempotency**: internal `userId` is the natural idempotency key; retries never create
  duplicate channels.
- **Soft delete / cascade** (consistent with Identity policy): disabling a seller sets
  `channel.token` aside + deactivates all its products via Admin API; hard purge is a
  scheduled BullMQ job after the grace period. Vendure has no native seller-deletion, so
  the BFF owns lifecycle state in its own tables.

### Buyer provisioning

Lazy: on first checkout attempt in any channel, the BFF ensures a Vendure `Customer`
exists for `(userId, channelId)` via Admin API and records it in the mapping table.
Buyers never sign in to Vendure — see §5.

---

## 4. BFF surface (what the mobile app sees)

`@project/domain-commerce` exposes a `CommerceContract`; Nest implements it as REST under
`/api/v1/commerce/**`. The SDK knows nothing about Vendure GraphQL.

Buyer-facing (read path is BFF-cached, short TTL):

| Endpoint | Notes |
|---|---|
| `GET /commerce/sellers?query=&facet=` | channel-directory search (Nest DB, not Vendure) |
| `GET /commerce/sellers/:token` | storefront header, ratings placeholder |
| `GET /commerce/products` | cross-seller browse: fan-out query per relevant channel, merged + paginated in BFF (v1 acceptable at current scale; revisit if fan-out cost grows) |
| `GET /commerce/sellers/:token/products/:slug` | variant pricing, stock status |
| `POST /commerce/cart*` | add/update/remove; BFF maps session→Vendure cart token (§5) |
| `POST /commerce/checkout` | creates DraftOrder-free regular order; triggers payment saga (§6) |
| `GET /commerce/orders` | aggregated across the buyer's channel customers via mapping table |
| `POST /commerce/orders/:id/cancel` `.../return` | request-level actions → events → admin workflow |

Seller-facing (requires `role:seller`, checked against Nest seller table):

| Endpoint | Notes |
|---|---|
| `POST /commerce/seller/products` (+ update/publish) | proxied to Admin API scoped to their channelId |
| `GET /commerce/seller/orders` | channel-scoped |
| `POST /commerce/seller/orders/:id/fulfil` | advance Vendure state machine |
| `GET /commerce/seller/payouts` | read-only projection computed from captured payments minus commission (§7) |

Media: product images upload through Nest → **MinIO** (shared bucket-per-domain pattern),
then registered with Vendure Asset module pointing at `commerce-media`. Keeps storage
strategy consistent with Identity/Finance.

---

## 5. Authn/Authz integration with Vendure (no plugins)

Because we cannot rely on third-party plugins, we wire identity ourselves using core
features:

1. **System credentials**: Nest holds a single Admin API service account (env secret).
   All Admin-API mutations happen server-side only. Same shared-credential pattern as
   Finance/Identity; the authz boundary is the Nest seller-role check, not Vendure ACLs.
2. **Session bridging for carts/customers**: Vendure's Shop API needs a cart session.
   The BFF stores a per-(user,channel) Vendure `authToken`/cart-token in the mapping
   table and attaches it when proxying Shop API operations. The mobile app only ever
   presents its Nest-issued JWT. This keeps Vendure cookies entirely out of the client.
3. **CSRF/public channel tokens**: `channelToken` slugs are public and non-secret; safe to
   embed in deep links (`app://shop/{channelToken}`).

Mapping table (Nest Postgres, Supabase):

```
commerce_identities
  id, internal_user_id, channel_id (vendure), vendure_customer_id,
  vendure_auth_token_enc, cart_token, kind(buyer|seller), created_at, deleted_at
```

---

## 6. Checkout ↔ Finance payment saga (the critical seam)

Strictly follows the reserve→capture→release model from `finance.md`. No direct ledger
calls from Commerce code paths other than through the Finance contract/events.

```
Checkout requested (BFF)
 1. BFF validates cart via Shop API → order total T (minor units, integer)
 2. BFF calls Finance: POST /finance/payment-intents  {kind: commerce_order,
      amount: T, sellerUserId, orderIdRef}   → Finance RESERVES buyer wallet (hold)
 3. BFF places Vendure order + PaymentMethodTransaction (state: authorized)
    ├─ success → emit commerce.order.placed
    │            Finance captures on confirmation event → debits buyer, credits
    │            seller-platform escrow ledger accounts (commission split at capture)
    └─ failure → emit commerce.order.failed → Finance RELEASES hold
 Fulfilment (seller marks shipped) → commerce.order.fulfilled → Finance schedules
 payout (escrow → seller balance) per payout policy
 Refund/return → commerce.refund_requested → Finance executes reverse transfer,
 Vendure partial/full refund via Admin API
```

Failure semantics: every step carries an idempotency key (`orderIdRef` + step). If the
process dies between reserve and order placement, a BullMQ sweeper job reconciles
"authorized-but-stale" intents (same reconciliation discipline as Finance).

Escrow note: v1 models payouts **ledger-only** (Blnk accounts: `platform_commission`,
`seller_escrow:{userId}`), settled internally. On-chain payout sweeps ride the existing
Finance withdrawal rail — Commerce doesn't know or care.

---

## 7. Commission & payouts (policy lives in Nest, not Vendure)

- Commission rate is a per-seller field in the Nest `sellers` table (global default in
  config). Applied by Finance at capture time when constructing the double-entry posting;
  Vendure is never told about money splits (it tracks gross order totals only).
- Payout schedule (e.g. D+1 after `order.fulfilled`, or on delivery confirmation) is a
  BullMQ delayed job emitting `commerce.payout.due` → Finance moves escrow→seller balance.
- Disputes: v1 = admin-initiated refunds through the BFF endpoints + audit log rows. No
  in-app dispute UI yet (open item).

Open items (agreed to defer):
- Multi-seller single-cart ("split orders") UX — needs a parent-order projection table.
- Seller self-service analytics (views, conversion) — needs event ingestion design.
- Search quality: Vendure default search is adequate for v1; Meilisearch-style external
  engines deferred (new infra = budget-sensitive).

---

## 8. Events (Redis Streams; naming consistent with Identity/Finance)

Producer streams (outbox-published):
`commerce.seller.provisioned|failed`, `commerce.order.placed`, `commerce.order.fulfilled`,
`commerce.order.delivered`, `commerce.order.cancelled`, `commerce.refund.requested|executed`,
`commerce.payout.due`.

Consumers: Finance (payment intents, captures, payouts), Notifications (via Social/Comms
later), Analytics projector (future). Consumer groups per service; PEL retry + manual
dead-letter inspection job, same operational model as Identity.

---

## 9. SDK contract sketch (`@project/domain-commerce`)

```ts
export interface CommerceContract {
  browse(input: BrowseInput): Promise<Paged<ProductSummary>>;
  getSeller(token: string): Promise<SellerProfile>;
  getProduct(sellerToken: string, slug: string): Promise<ProductDetail>;

  cart: CartApi;                    // add/update/remove/get (session-scoped)
  checkout(input: CheckoutInput): Promise<CheckoutResult>; // returns orderId + paymentIntentId
  listOrders(q?: OrderQuery): Promise<Paged<Order>>;
  cancelOrder(orderId: string): Promise<void>;
  requestReturn(orderId: string, lineIds: string[], reason: string): Promise<ReturnRequest>;

  seller: SellerApi;                // products CRUD, orders, fulfil, payouts (role-gated)
}
```

Types are framework-free, minor-unit integers for money, ISO timestamps, opaque cursor
pagination — identical conventions to the other domain libs.

---

## 10. Roadmap (v1, resource-constrained)

- **P0 (vertical slice)**: seller provisioning saga + channel mapping table + read-only
  BFF endpoints (browse sellers/products). Validates the Channel=Seller model end-to-end.
- **P1**: cart/session bridging + checkout with Finance reserve/capture saga + order
  listing + fulfilment happy path. QR merchant-payment deep link lands here
  (`app://pay?ctx=commerce&seller={token}&order={id}` reusing Finance QR resolution).
- **P2**: refunds/returns, payout scheduler + escrow reports, seller product management
  endpoints, moderation/lifecycle (soft delete cascade).

Success criteria for v1: two sellers onboarded via events, buyer completes purchase with
stablecoin wallet balance, ledger shows correct commission split, zero Vendure GraphQL
exposed to the client.
