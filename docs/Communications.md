# Communications Domain — Architecture & Implementation Plan - DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`, `Identity.md`

Scope: real-time messaging (1:1 and group chat), voice/video calls, and media sharing. 
Core technologies: **ejabberd** (XMPP messaging, MAM for history) and **LiveKit** (WebRTC media/real-time sessions). 

Guiding constraint: **v1 pragmatism** — reuse existing infra (Supabase Postgres, NATS/BullMQ, MinIO). The data plane (actual messages/media) flows directly between the mobile client and ejabberd/LiveKit, but the control plane (provisioning, token minting, metadata, moderation) is strictly governed by the Nest BFF.

---

## 1. Responsibilities & Boundaries

The Communications domain owns:

1. **Control plane & metadata** — managing chat room membership, message read receipts, and indexing metadata in Postgres.
2. **Token minting** — generating short-lived, scoped credentials for clients to connect directly to ejabberd (XMPP) and LiveKit (WebRTC).
3. **Event-to-message bridging** — translating platform events (e.g., `finance.transfer.completed`, `commerce.order.placed`) into automated system messages or notifications.
4. **Media egress orchestration** — triggering LiveKit to export recorded sessions or snapshots to the shared MinIO bucket.

It does NOT own: user identities (Identity), message payload encryption at rest (delegated to ejabberd/LiveKit configs), or the actual WebSocket/WebRTC data transport (handled by native mobile SDKs).

### Nest-first rule (Control Plane)

Clients **never** hold long-lived credentials for ejabberd or LiveKit. 
1. Client requests a short-lived token from the Nest BFF (`GET /communications/messaging/token` or `GET /communications/media/token?roomId=xyz`).
2. Nest validates the user's session, checks authorization (e.g., is the user a member of this room?), and mints a token using system credentials.
3. Client uses this token to connect directly to the downstream service. 
4. Token TTL is short (e.g., 5–15 minutes); refresh requires a new BFF call, ensuring immediate revocation capability.

---

## 2. Data Model (Postgres, shared Supabase instance)

Communications-owned tables (schema prefix `comm_`):

| Table | Purpose |
|---|---|
| `comm_user_mappings` | 1:1 mapping of `internal_user_id` to `ejabberd_jid` (e.g., `user123@chat.project.local`) and `livekit_identity`. Created during Identity provisioning. |
| `comm_rooms` | Metadata for group chats/calls: `id`, `name`, `type` (group, support, commerce_order), `created_by`, `livekit_room_name`, `status`. |
| `comm_room_memberships` | Join table: `room_id`, `user_id`, `role` (admin, member), `joined_at`, `left_at`. Enforces who can request a token for a given room. |
| `comm_message_metadata` | Lightweight index for search/unread counts: `room_id`, `last_message_id`, `last_read_message_id` per user. (Actual message bodies live in ejabberd MAM). |

**Idempotency rule:** Token minting and room creation endpoints accept idempotency keys to prevent duplicate room creation or token generation on network retries.

---

## 3. Event Surface (NATS)

Stream: `events:communications`. Uses the same Outbox pattern as Identity and Finance.

**Events consumed:**
- `identity.user.created` → trigger Communications provisioning (create ejabberd account, generate JID, write to `comm_user_mappings`).
- `identity.user.deleted` → disable ejabberd account, remove from active LiveKit rooms (via Server API), mark `comm_user_mappings` as deleted.
- `finance.transfer.completed` → trigger automated "payment receipt" message to the relevant 1:1 or group chat.
- `commerce.order.placed` / `.fulfilled` → trigger automated order status messages to the buyer-seller chat room.

**Events emitted:**
- `communications.room.created` / `.updated`
- `communications.user.joined` / `.left` (for audit/moderation purposes, not every single message, to avoid stream spam).

---

## 4. Messaging Architecture (ejabberd)

- **Protocol**: XMPP over BOSH or WebSocket (preferred for mobile).
- **Account Management**: Nest uses the ejabberd HTTP API (with system admin credentials) to create, suspend, or delete accounts. 
- **History**: Relies on XEP-0313 (Message Archive Management - MAM). The mobile client fetches history directly from ejabberd using its short-lived token. Nest does not proxy message history to save bandwidth and complexity.
- **Security**: ejabberd is configured to require SASL or JWT authentication. Nest generates these tokens scoped strictly to the user's JID.

---

## 5. Media & Real-time Architecture (LiveKit)

- **Room Management**: Nest uses the LiveKit Server API (system credentials) to create rooms, set max participants, and configure egress (e.g., "record this call to MinIO bucket `comm-recordings`").
- **Access Control**: Nest mints LiveKit Access Tokens. The token payload includes:
  - `identity`: The user's internal UUID or JID.
  - `name`: Display name.
  - `room`: The specific `livekit_room_name`.
  - `permissions`: `canPublish`, `canSubscribe`, `canPublishData` (scoped based on `comm_room_memberships.role`).
- **Egress**: For compliance or premium features, Nest can trigger a LiveKit Egress API call to save a room recording to MinIO, storing the object path in a `comm_recordings` table (future v1.5/v2).

---

## 6. Provisioning & Deletion Saga Participation

**On `identity.user.created`:**
1. Generate unique, collision-resistant JID (e.g., `u-{uuid}@chat.project.local`).
2. Call ejabberd HTTP API to register the account (idempotent).
3. Write to `comm_user_mappings`.
4. Emit `communications.user.provisioned` to signal completion to the Identity saga coordinator.

**On `identity.user.deleted`:**
1. Update `comm_user_mappings` status to `deleted`.
2. Call ejabberd API to disable/delete the account.
3. (LiveKit requires no pre-provisioning; short-lived tokens simply cease to be minted, and existing tokens expire within minutes).

---

## 7. Nest Module Structure

```
server/src/communications/
  communications.module.ts
  messaging/
    ├── ejabberd.client.ts        # Typed HTTP wrapper for ejabberd Admin API
    └── messaging.controller.ts   # /v1/communications/messaging/token, /metadata
  media/
    ├── livekit.client.ts         # Typed wrapper for LiveKit Server API (create room, mint token)
    └── media.controller.ts       # /v1/communications/media/token, /v1/communications/media/egress
  rooms/
    ├── rooms.controller.ts       # CRUD for group rooms, membership management
    └── rooms.service.ts
  events/
    ├── communications.publisher.ts
    └── event.listeners.ts        # Consumes identity/finance/commerce events for auto-messaging
  dto/                            # zod schemas re-exported from @project/domain-communications
```

---

## 8. SDK Contract (`@project/domain-communications`)

*Note: The HTTP client in the SDK handles **control plane** operations (metadata, token minting). The actual data plane (sending messages, joining WebRTC) is handled by the mobile app's native XMPP/LiveKit SDKs using the tokens provided by this contract.*

```ts
export interface CommunicationsContract {
  // Control Plane: Messaging
  getMessagingToken(): Promise<{ token: string; jid: string; websocketUrl: string }>;
  getChatHistory(roomId: string, before?: string): Promise<MessagePage>; // Optional: if BFF needs to proxy/sanitize MAM
  markAsRead(roomId: string, messageId: string): Promise<void>;

  // Control Plane: Media / Rooms
  createRoom(input: CreateRoomInput): Promise<RoomDetail>;
  getMediaToken(roomId: string): Promise<{ token: string; wsUrl: string }>;
  getRoomMembers(roomId: string): Promise<RoomMember[]>;
  
  // Admin / Moderation (role-gated)
  kickUser(roomId: string, userId: string): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
}
```

Deliberately absent: Raw XMPP stanzas or WebRTC SDP handling. The SDK provides the *keys to the door*; the native mobile libraries handle the *room*.

---

## 9. Cross-Domain Integration

- **Finance**: When a P2P transfer completes, Finance emits `finance.transfer.completed`. Communications listens and injects a structured message into the 1:1 chat between payer and payee (e.g., "You sent $50.00 USDC").
- **Commerce**: When a buyer initiates a checkout with a seller, Commerce ensures a `comm_room` exists for `(buyer_id, seller_id)`. Order status events are injected into this room as system messages, providing a unified "chat + commerce" experience.

---

## 10. Roadmap

- **P0 (vertical slice)**: `comm_user_mappings` table, ejabberd provisioning on `identity.user.created`, `getMessagingToken` endpoint, basic 1:1 chat working in mobile app via native XMPP SDK.
- **P1**: Group room creation, `getMediaToken` for LiveKit 1:1 voice/video calls, Commerce/Finance event-to-message bridging (automated receipts/updates).
- **P2**: Message search indexing (syncing MAM metadata to Postgres/Meilisearch if needed), LiveKit egress to MinIO for call recordings, advanced moderation tools (message deletion, user muting).

---

### Open Decisions
1. **Message History**: Relying purely on ejabberd MAM is efficient, but does the business require a Postgres-backed search index for compliance/eDiscovery in v1, or is client-side MAM fetching sufficient?
2. **Push Notifications**: Should the Communications domain own the Firebase Cloud Messaging (FCM) / APNs integration for offline message alerts, or does that belong in a dedicated "Notifications" service/domain?
3. **End-to-End Encryption (E2EE)**: v1 assumes transport-level encryption (TLS) and server-side trust (standard XMPP/LiveKit). If E2EE (e.g., Signal Protocol) is a v1 requirement, the mobile app must handle encryption *before* sending to ejabberd, which changes the MAM and search dynamics significantly.
