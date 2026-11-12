# Social Domain — Architecture & Implementation Plan - DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`

Core technology: GoToSocial (ActivityPub server)
Composed by: Top-level SDK (@superapp/sdk) → SocialContract
Depends on: Identity (provisioning saga, identity mapping), Communications (media reuse), Infra (NATS, Postgres, MinIO)

---

## 1. Purpose & Scope

Social brings ActivityPub-powered social features (profiles, posts, timelines, follows, notifications) into the super app. Critical constraint: we will not federate with other services. GoToSocial is used purely as a robust, well-supported open-source social engine — its data model (actors, notes, follows, outbox/inbox) and API surface — running as a private node within our k8s cluster.
In scope for v1:

    Private social graph per user (post, like, boost, reply, follow, block, notify)
    Timelines: home, local (all in-network posts), hashtag
    Media attachments via existing MinIO storage path
    Merchant/creator profiles surfaced from Commerce sellers (seller storefronts get a social presence)

Out of scope for v1 (explicitly deferred):

    Federation to external instances (disabled; see §2)
    Full-text search across posts (use GTS built-in only if sufficient; otherwise P2)

---

## 2. Federation Policy (Non-Negotiable for v1)

GoToSocial speaks ActivityPub natively; "not federating" is a configuration + network posture, not a code change:

- Config: GTS_FEDERATION_ALLOWED_DOMAINS left empty; instance configured as private; sign-up closed (accounts created only via Nest provisioning).
- Network: egress from the GTS pod restricted at the k8s NetworkPolicy level so it cannot deliver to external domains; inbound federation endpoints blocked at the ingress (only /api/v2/* internal paths exposed to Nest).
- Rationale: this preserves the option to enable federation later (flip config + policy) without schema changes, while guaranteeing zero leakage today. Documented as an operational invariant, tested by CI check against deployed config.

---

## 3. Identity Bridging

Reuses the established pattern:

- Provisioning saga step (from Identity domain): create GTS account per user via admin API, store mapping in `social_identities(internal_user_id, gts_actor_id, gts_username, status)`
- Username derivation: `{handle}@internal` where handle comes from Identity profile (collision handling: append numeric suffix, stored once, never regenerated).
- Soft-delete cascade: Identity's deletion saga calls Social's `deactivate(user)` → GTS account disabled via admin API, content tombstoned locally; purge after grace period mirrors Finance/Commerce.

Nest holds the GTS admin token (single system credential, per shared decision). Clients authenticate only to Nest with their session; Nest proxies with the admin token and enforces per-user authorization by checking that actions target the caller's mapped actor.

---

## 4. Event Model

Streams (NATS, consumer groups, outbox-published):

Buyer-facing (read path is BFF-cached, short TTL):

| Event | Emitted when | Consumers |
| :--- | :--- | :--- |
| `social.account.provisioned` | saga step completes | Identity coordinator |
| `social.post.created` | post published | Analytics hook (P2), Commerce seller-feed projector |
| `social.follow.changed` | follow/unfollow | Notification router |
| `social.user.deactivated` | deletion saga | Coordinator ack |

No webhooks exist from GTS to us; Nest learns state changes only through its own proxied commands (command-driven projection). This is acceptable because all writes flow through Nest anyway.

---

## 5. BFF Surface (Nest modules)

- SocialModule — proxy endpoints (REST, validated DTOs) over GTS REST API v2:
    - `GET /social/profile/:handle`
    - `POST /social/posts`
    - `GET /social/timelines/home|local|hashtag/:tag`
    - `POST /social/posts/:id/like|boost|reply`
    - `POST/DELETE /social/follows/:handle` 
    - `GET /social/notifications`
    - `POST /social/media (multipart → MinIO → attach)`
- SocialProvisioningModule — saga steps, reusing ProvisionerService machinery
- Mapping table + SocialIdentityService
- Rate limiting per user on write endpoints (GTS has internal limits; ours protect the shared admin token quota and give consistent 429 semantics to clients)

---

## 6. Data Ownership

- Post content lives in GTS's DB (source of truth); Nest stores no copies except projections needed for cross-domain features (e.g., seller-post ↔ product link table `commerce_social_links`).
- Follow graph: GTS is source of truth. Home timeline fan-out strategy: pull-based reads in v1 (query GTS directly, cache hot timelines in Redis with short TTL) rather than building our own fan-out store — resource-constrained choice, revisit if timeline latency becomes an issue.

---

## 7. SDK Contract (@superapp/social)

```ts
interface SocialContract {
  getProfile(handle: string): Promise<Profile>
  listTimelines(kind: 'home' | 'local', opts?: PageOpts): Promise<Paged<Post>>
  searchHashtag(tag: string, opts?: PageOpts): Promise<Paged<Post>>
  createPost(input: CreatePostInput): Promise<Post>
  like(postId: string): Promise<void>
  boost(postId: string): Promise<void>
  follow(handle: string): Promise<void>
  unfollow(handle: string): Promise<void>
  notifications(opts?: PageOpts): Promise<Paged<SocialNotification>>
  uploadMedia(blob: Blob): Promise<MediaRef>
}
```

Types are rail-agnostic (no ActivityPub JSON in client types); pagination normalized to our shared cursor convention.

---

## 8. Security & Privacy

- Private-by-default: users' posts visible only within the network (which is everyone in-app); blocks enforced at GTS level.
- Admin-token proxy means Nest must verify actor ownership on every mutating call — implemented as a guard that resolves caller→actor mapping and rejects mismatches (403).
- Media: served through MinIO signed URLs (existing pattern), no public bucket.

---

## 9. Open Items / Risks

- GTS version pinning: upgrade cadence tied to contract tests against staging instance (CI job spins up GTS, runs SocialContract suite).
- If product later wants any read-heavy feature (trending, search analytics), we add event-driven projections into Postgres rather than querying GTS ad hoc.

---

## 10. Roadmap

- P0: provisioning saga step + mapping table; profile read/write vertical slice (getProfile, createPost, home timeline) behind SDK contract.
- P1: follows, notifications, media uploads, hashtag/local timelines; rate limiting; CI contract test against staging GTS.
- P2: seller↔social integration (Commerce deep links in posts), timeline caching layer, projection tables for trending/analytics; revisit federation posture only if product direction changes.
