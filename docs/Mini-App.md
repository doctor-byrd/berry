# Mini App Domain — Architecture & Implementation Plan - DRAFT v 1.0 (SUBJECT TO CHANGE NOT FINAL)

Depends on: `Sdk-Architecture.md`, `Identity.md`

Scope: third-party web applications (Mini Apps) running inside the super app via Ionic Portals, with scoped access to platform services (Identity, Finance, Commerce, Social, Communications) based on user-granted permissions.

Core technologies: **Ionic Portals** (native container), **Ionic Capacitor** (web-to-native bridge), **WebView sandboxing** (k8s-served bundles).

Guiding constraint: **v1 pragmatism** — Mini Apps run as isolated web views with no direct access to native APIs or platform databases. All platform service access flows through a permissioned bridge to the Nest BFF.

---

## 1. Responsibilities & Boundaries

The Mini App domain owns:

1. **App lifecycle management** — registration, validation, approval, versioning, and distribution of third-party Mini Apps.
2. **Bundle serving** — hosting validated web app bundles (HTML/JS/CSS/assets) and serving them to mobile clients on demand.
3. **Permission & scope enforcement** — managing which platform services each Mini App can access, and ensuring user consent is obtained before granting access.
4. **Native-web bridge** — providing a secure communication channel between the Ionic Portal (native) and the Mini App (web view), exposing a scoped SDK.
5. **Sandboxing & security** — ensuring Mini Apps cannot access unauthorized data, make unauthorized network calls, or escape the WebView container.

It does NOT own: the actual business logic of platform services (Identity, Finance, etc.). Mini Apps consume these services through the same BFF endpoints as the native mobile app, but with additional permission checks.

### Execution Model (Core Decision)

Mini Apps are **web applications** (React, Vue, vanilla JS, etc.) built with Ionic Capacitor, bundled into a deployable package (ZIP/tarball), and run inside an **Ionic Portal** (a managed WebView container in the native mobile app).

```
Third-party developer
  ↓ builds with Ionic Capacitor
  ↓ bundles web app (HTML/JS/CSS)
  ↓ submits to platform
Platform validates & approves
  ↓ stores bundle in MinIO
Mobile client requests Mini App
  ↓ downloads bundle from MinIO (or CDN)
  ↓ loads into Ionic Portal (WebView)
  ↓ Mini App uses @superapp/miniapp-sdk
  ↓ SDK calls bridge to native
  ↓ Native proxies to Nest BFF (with permission checks)
  ↓ BFF calls domain services
```

**Why Ionic Portals?**
- **Managed WebView lifecycle**: Portals handle WebView creation, memory management, and cleanup automatically.
- **Secure bridge**: Capacitor's plugin system provides a typed, promise-based bridge between web and native.
- **Native feel**: Portals can render web content with native-like performance and integrate with native UI components if needed.
- **Isolation**: Each Portal is a separate WebView context, preventing cross-Mini-App data leakage.

---

## 2. Mini App Lifecycle

### Registration & Submission

1. Developer registers a Mini App in the platform admin console (or via API):
   - `name`, `description`, `icon`, `category`
   - `requested_permissions`: list of scopes (e.g., `identity:profile:read`, `finance:wallet:read`, `commerce:orders:write`)
   - `privacy_policy_url`, `terms_of_service_url`
2. Developer builds the web app using Ionic Capacitor, ensuring it uses the `@superapp/miniapp-sdk` for platform service access.
3. Developer bundles the web app (e.g., `npm run build` → `dist/` folder) and uploads to the platform:
   - Bundle format: ZIP containing `index.html`, `assets/`, `js/`, `css/`, and a `manifest.json` (metadata, version, permissions requested).
   - Platform validates:
     - Bundle structure (required files present)
     - Manifest matches registration metadata
     - No forbidden patterns (e.g., direct `fetch` calls to external domains, `eval()`, `localStorage` abuse)
     - Static analysis for security issues (XSS, insecure APIs)
4. Platform approves (manual review for v1; automated for v2).
5. Approved bundle is stored in MinIO (`miniapp-bundles/{appId}/{version}/bundle.zip`).

### Distribution & Loading

1. Mobile client requests a Mini App.
2. Native app checks if bundle is cached locally (by `appId` + `version`).
3. If not cached, native app downloads bundle from MinIO (or CDN) → extracts to local storage.
4. Native app creates an Ionic Portal, loads `index.html` from the extracted bundle.
5. Portal injects the `@superapp/miniapp-sdk` bridge script (provided by the native app, not the bundle).
6. Mini App initializes, calls `MiniApp.init()`, and begins using the SDK.

### Updates & Versioning

- Mini Apps are versioned (`1.0.0`, `1.0.1`, etc.).
- Platform can force-update or deprecate versions.
- Mobile client checks for updates periodically (or on app launch) and downloads new bundles.
- Old versions remain available until explicitly deprecated (to avoid breaking user bookmarks).

---

## 3. Permission & Scope Model

Mini Apps request **OAuth2-style scopes** for platform services. Users grant consent during the first launch (or via a settings screen).

### Scope Definitions

Scopes are defined per domain, following a `domain:resource:action` pattern:

| Scope | Description |
|---|---|
| `identity:profile:read` | Read user's basic profile (name, avatar, email) |
| `identity:profile:write` | Update user's profile |
| `finance:wallet:read` | Read wallet balances and transaction history |
| `finance:transfer:write` | Initiate P2P transfers (requires user confirmation) |
| `commerce:orders:read` | Read user's order history |
| `commerce:orders:write` | Create orders, add to cart |
| `commerce:products:read` | Browse products and sellers |
| `social:posts:read` | Read user's social feed |
| `social:posts:write` | Create posts, like, boost |
| `communications:messages:read` | Read chat messages |
| `communications:messages:write` | Send messages |

### Consent Flow

1. Mini App calls `MiniApp.requestPermissions(['finance:wallet:read', 'commerce:orders:read'])`.
2. Native app shows a consent dialog: "Acme Store wants to access your wallet balance and order history. [Allow] [Deny]".
3. User grants consent → native app stores granted scopes in local storage (keyed by `appId`).
4. Native app mints a **scoped JWT** for the Mini App session, embedding the granted scopes in the token claims.
5. Mini App uses this scoped JWT for all subsequent SDK calls.
6. BFF validates the JWT, checks that the requested action matches the granted scopes, and either allows or denies.

### Scope Enforcement (BFF Side)

- Each BFF endpoint declares required scopes (e.g., `GET /finance/wallet` requires `finance:wallet:read`).
- Auth guard checks the Mini App's JWT for the required scope.
- If scope is missing, BFF returns `403 Forbidden` with a specific error code (`SCOPE_REQUIRED`).
- Mini App SDK catches this error and can prompt the user to grant additional permissions.

---

## 4. Mini App SDK (`@superapp/miniapp-sdk`)

The SDK is a **web-only library** injected into the Mini App's WebView by the native app. It provides a bridge to the native layer, which proxies requests to the Nest BFF.

### Architecture

```
Mini App (web)
  ↓ calls MiniApp.finance.getWallet()
  ↓ SDK serializes call → posts message to native bridge
Native Portal (Ionic Capacitor)
  ↓ receives message
  ↓ validates scope (from scoped JWT)
  ↓ proxies to Nest BFF (with scoped JWT in Authorization header)
Nest BFF
  ↓ validates JWT, checks scopes
  ↓ calls domain service
  ↓ returns response
Native Portal
  ↓ receives response
  ↓ posts message back to web
Mini App
  ↓ SDK deserializes response → resolves Promise
```

### SDK API

```ts
// Initialization
MiniApp.init({ appId: 'acme-store', version: '1.0.0' });

// Permissions
const granted = await MiniApp.requestPermissions(['finance:wallet:read']);
const hasPermission = await MiniApp.hasPermission('finance:wallet:read');

// Identity
const profile = await MiniApp.identity.getProfile();

// Finance
const wallet = await MiniApp.finance.getWallet();
const transactions = await MiniApp.finance.listTransactions({ limit: 10 });

// Commerce
const products = await MiniApp.commerce.browse({ query: 'shoes' });
const order = await MiniApp.commerce.createOrder({ items: [...] });

// Social
const feed = await MiniApp.social.listTimelines('home');
await MiniApp.social.createPost({ content: 'Hello from Mini App!' });

// Communications
const messages = await MiniApp.communications.getChatHistory(roomId);
await MiniApp.communications.sendMessage(roomId, 'Hi!');

// Events (real-time)
MiniApp.on('finance.transfer.completed', (event) => {
  console.log('Transfer completed:', event);
});
```

### SDK Implementation (Web Side)

The SDK is a thin wrapper around `window.Capitor.postMessage()` (or a custom bridge if not using Capacitor directly). It:
- Serializes method calls into JSON messages.
- Sends messages to the native layer via the bridge.
- Listens for responses and resolves/rejects Promises.
- Handles errors (e.g., `SCOPE_REQUIRED`, `NETWORK_ERROR`).
- Provides TypeScript types for all methods and responses (reusing `@superapp/domain-*` types).

### Native Bridge Implementation (Ionic Capacitor Plugin)

The native app implements a Capacitor plugin (e.g., `SuperAppBridge`) that:
- Listens for messages from the web view.
- Validates the requested action against the Mini App's granted scopes.
- Proxies the request to the Nest BFF using the scoped JWT.
- Returns the response to the web view.

```ts
// Pseudo-code for Capacitor plugin
@PluginMethod()
async proxyRequest(options: { method: string; path: string; body?: any }) {
  const appId = this.getCurrentAppId();
  const scopes = this.getGrantedScopes(appId);
  
  // Check if the requested path requires a scope the app doesn't have
  const requiredScope = this.getRequiredScope(options.path);
  if (!scopes.includes(requiredScope)) {
    throw new Error('SCOPE_REQUIRED');
  }
  
  // Proxy to BFF
  const response = await fetch(`${BFF_URL}${options.path}`, {
    method: options.method,
    headers: {
      'Authorization': `Bearer ${this.getScopedJwt(appId)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body),
  });
  
  return response.json();
}
```

---

## 5. Data Model (Postgres, shared Supabase instance)

Mini App-owned tables (schema prefix `miniapp_`):

| Table | Purpose |
|---|---|
| `miniapp_registry` | Registered Mini Apps: `id`, `name`, `description`, `icon_url`, `category`, `developer_id`, `status` (pending/approved/rejected/deprecated), `created_at`. |
| `miniapp_versions` | Versioned bundles: `id`, `app_id`, `version`, `bundle_url` (MinIO path), `manifest` (JSON), `status`, `released_at`. |
| `miniapp_permissions` | Requested scopes per app: `app_id`, `scope`, `description`. |
| `miniapp_user_consents` | User-granted permissions: `user_id`, `app_id`, `scopes` (JSON array), `granted_at`, `revoked_at`. |
| `miniapp_sessions` | Active Mini App sessions: `id`, `user_id`, `app_id`, `scoped_jwt`, `expires_at`. |

---

## 6. Security & Sandboxing

### WebView Isolation

- Each Mini App runs in a **separate Ionic Portal** (separate WebView instance).
- Portals are destroyed when the Mini App is closed, clearing all in-memory state.
- No shared `localStorage` or `sessionStorage` between Mini Apps (each Portal has its own storage context).

### Network Restrictions

- Mini Apps **cannot make direct network calls** to external domains (enforced via Content Security Policy in the WebView).
- All platform service access must go through the SDK bridge → Nest BFF.
- BFF validates the Mini App's scoped JWT and enforces permissions.

### Code Validation

- Platform performs static analysis on submitted bundles:
  - No `eval()`, `Function()`, or dynamic code execution.
  - No direct `fetch` or `XMLHttpRequest` to external domains.
  - No access to forbidden APIs (e.g., `navigator.geolocation` without permission).
- Bundles are scanned for known vulnerabilities (e.g., outdated libraries with CVEs).

### Scoped JWT

- Mini Apps receive a **scoped JWT** (short-lived, e.g., 1 hour) that embeds the granted permissions.
- JWT claims include: `sub` (user ID), `app_id`, `scopes` (array), `exp` (expiration).
- BFF validates the JWT on every request and checks that the requested action matches the granted scopes.
- Scoped JWTs are revocable (stored in Redis denylist if user revokes consent).

---

## 7. Nest Module Structure

```
server/src/miniapp/
  miniapp.module.ts
  registry/
    ├── registry.controller.ts    # CRUD for Mini App registration
    └── registry.service.ts
  bundles/
    ├── bundles.controller.ts     # Upload, validate, store bundles
    ├── bundles.service.ts
    └── validation.service.ts     # Static analysis, manifest validation
  permissions/
    ├── permissions.controller.ts # Manage scopes, user consents
    └── permissions.service.ts
  sessions/
    ├── sessions.service.ts       # Mint scoped JWTs, manage sessions
    └── jwt.service.ts
  events/
    ├── miniapp.publisher.ts
    └── event.listeners.ts
  dto/                            # zod schemas
```

---

## 8. SDK Contract (`@superapp/miniapp-sdk`)

The SDK is a **web-only package** (not shared with the native mobile app). It reuses types from `@superapp/domain-*` but provides a bridge-based implementation.

```ts
export interface MiniAppSDK {
  init(config: { appId: string; version: string }): Promise<void>;
  
  // Permissions
  requestPermissions(scopes: string[]): Promise<string[]>;
  hasPermission(scope: string): Promise<boolean>;
  
  // Identity
  identity: {
    getProfile(): Promise<UserProfile>;
  };
  
  // Finance
  finance: {
    getWallet(): Promise<WalletSummary>;
    listTransactions(q?: StatementQuery): Promise<Page<Transaction>>;
    transferP2P(input: P2PInput): Promise<Transfer>;
  };
  
  // Commerce
  commerce: {
    browse(input: BrowseInput): Promise<Paged<ProductSummary>>;
    createOrder(input: CreateOrderInput): Promise<Order>;
  };
  
  // Social
  social: {
    listTimelines(kind: 'home' | 'local'): Promise<Paged<Post>>;
    createPost(input: CreatePostInput): Promise<Post>;
  };
  
  // Communications
  communications: {
    getChatHistory(roomId: string): Promise<MessagePage>;
    sendMessage(roomId: string, content: string): Promise<void>;
  };
  
  // Events
  on(event: string, handler: (data: any) => void): void;
  off(event: string, handler: (data: any) => void): void;
}
```

---

## 9. Developer Experience

### Building a Mini App

1. Developer creates a new Ionic Capacitor project: `ionic start my-mini-app --type=react`.
2. Installs the SDK: `npm install @superapp/miniapp-sdk`.
3. Builds the app using standard web technologies (React, Vue, etc.).
4. Uses the SDK to access platform services:
   ```ts
   import { MiniApp } from '@superapp/miniapp-sdk';
   
   await MiniApp.init({ appId: 'my-mini-app', version: '1.0.0' });
   await MiniApp.requestPermissions(['finance:wallet:read']);
   
   const wallet = await MiniApp.finance.getWallet();
   console.log('Balance:', wallet.balance);
   ```
5. Builds the bundle: `npm run build` → `dist/` folder.
6. Submits the bundle to the platform via the admin console or API.

### Testing

- Platform provides a **local development server** that simulates the Ionic Portal environment.
- Developers can test their Mini Apps locally before submitting.
- Platform provides a **staging environment** where developers can test with real platform services (sandbox mode).

### Documentation

- Platform provides comprehensive documentation:
  - SDK API reference
  - Permission scopes and their meanings
  - Best practices for building Mini Apps
  - Security guidelines
  - Example projects

---

## 10. Roadmap

- **P0 (vertical slice)**: Mini App registry + bundle storage (MinIO) + basic Ionic Portal integration + `@superapp/miniapp-sdk` with `identity.getProfile()` only. One example Mini App (e.g., a simple profile viewer) running end-to-end.
- **P1**: Permission model + scoped JWT + consent flow + Finance and Commerce SDK methods. Developer documentation + local testing server.
- **P2**: Real-time events (via WebSocket bridge) + Social and Communications SDK methods + advanced security (CSP enforcement, code signing) + Mini App marketplace UI in the mobile app.

---

### Open Decisions

1. **Bundle Storage**: Should bundles be stored in MinIO (consistent with other domains) or a dedicated CDN for faster global distribution?
2. **Code Signing**: Should the platform require Mini Apps to be code-signed (to prevent tampering after approval)?
3. **Revenue Model**: Will the platform take a commission from Mini App transactions (e.g., in-app purchases)? If so, how is this integrated with the Finance domain?
4. **Analytics**: Should the platform provide analytics to Mini App developers (e.g., user engagement, error rates)? If so, how is this data collected and stored?
5. **Offline Support**: Should Mini Apps support offline mode (caching data locally)? If so, how is this synchronized when the user comes back online?

