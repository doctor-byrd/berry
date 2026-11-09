# Notes

## Project Setup

Scaffold project:
```sh
npx create-nx-workspace@latest <project-name> --preset=apps
cd <project-name>
```

Create library for shared types:
```sh
npx nx g @nx/js:library shared-types --directory=libs/shared-types --bundler=none

# Remove library
# npx nx g @nx/workspace:remove library-name
```

Create backend server - NestJS
```sh
# Add NestJS capabilities
npm install --save-dev @nx/nest
# Generate the server app
npx nx g @nx/nest:app server
```

Create web client - React
```sh
# Add React capabilities
npm install --save-dev @nx/react
npx nx g @nx/react:app web --bundler=vite
```

Create mobile client - Expo React Native
```sh
# Add Expo and React Native capabilities
npm install --save-dev @nx/expo
npx nx g @nx/expo:app mobile
```

## Install packages
All packages should be installed at the top level directory

All of the package versions have been aligned to prevent conflicts you can simply run the install command at the top of the project:
```sh
npm install
```

Shared lib packages
```sh
npm install class-validator
```

Web client packages:
```sh
npm install @tanstack/react-store @tanstack/react-query @tanstack/react-router @tanstack/react-form @tanstack/react-table @tanstack/react-virtual socket.io-client @chakra-ui/react @emotion/react axios
npm install -D @tanstack/router-vite-plugin vite-tsconfig-paths vite-plugin-static-copy
```

Server packages:
```sh
npm i --save-dev @types/passport-jwt
npm install bcryptjs typeorm class-transformer dotenv pg redis ioredis socket.io bullmq passport-jwt zod @socket.io/redis-adapter
npm install nestjs-paginate @nestjs/typeorm @nestjs/bullmq @nestjs/config @nestjs/platform-socket.io @nestjs/jwt @nestjs/passport @nestjs/throttler @nestjs/mapped-types @nestjs/event-emitter
```

Mobile packages:
```sh
npm install @expo-google-fonts/poppins @expo/log-box @react-native-async-storage/async-storage @react-native-community/netinfo @react-navigation/elements @react-navigation/native @rn-primitives/slot @shopify/flash-list class-variance-authority clsx expo-build-properties expo-constants expo-dev-client expo-device expo-font expo-haptics expo-linking expo-router expo-splash-screen expo-status-bar expo-symbols expo-system-ui expo-web-browser nativewind react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-screens react-native-uitextview rn-icon-mapper tailwind-merge
npm install -D @babel/core prettier prettier-plugin-tailwindcss tailwindcss
```

## Configurations
Setup tailwind:
```sh
# Install at project root
npm install -D tailwindcss postcss autoprefixer @tailwindcss/vite
```

Configure Vite setup
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Remainder of config
})
```

Import to main css file
```css
/* web/src/styles.css */
@import 'tailwindcss';
```

## Development

Run applications:
```sh
# Run server
npx nx serve server
# Run web client
npx nx serve web
# Run mobile client for web
npx nx start mobile --web
# Run mobile client for ios (Mac only)
npx nx run-ios mobile
# Run mobile client for android (Linux/Windows must have Android Studio installed)
npx nx run-android mobile
# Build everything
npx nx run-many -t build
# View project graph
npx nx graph
```

### NestJS

Generate resource - Module, Controller, Service
```sh
cd server/src
mkdir <resource-name> && cd <resource-name>
npx nx generate @nx/nest:resource <resource-name>
```

### Storybook

```sh
# Add Storybook plugin for Nx
# If needed run: npx nx g @nx/storybook:migrate-9
nx add @nx/storybook

# Generate config for app
nx g @nx/storybook:configuration <project-name>

# Run storybook
# Run pixi storybook: nx storybook web --config-dir=apps/web/.storybook-pixi
nx storybook <project-name>

# Build static Storybook
nx build-storybook <project-name>

# Run Storybook tests
nx test-storybook <project-name>
```

### Infrastructure

See active Nx projects:
```sh
npx nx show projects
```

Spin up containers:
```sh
docker compose -f infra/docker-compose.yml up -d
```

Stop containers:
```sh
docker compose -f infra/docker-compose.yml down
```

Wipe containers:
```sh
docker compose -f infra/docker-compose.yml down -v
```

Check containers:
```sh
docker ps
```

Check logs for container:
```sh
docker logs <container-name>
```

Default PG Admin runs on port `5050`
- Username: `admin@domain.com`
- Password: `admin_password`

On first setup be sure to connect to the dev db using the information specified in the `docker-compose.yml` file. You can do this by adding the postgres server.
- Default Host: `supabase-db`
- Default Port: `5432`
- Default User: `postgres`
- Default Password: `dev_password`

Default Object Storage Admin runs on port `9001`
- Default User: `storage_admin`
- Default Pasword: `storage_secure_password`

Nest application assumes default bucket `hub-assets` exists so be sure to create it in Object Storage Admin interface before uploading assets.

### Identity

The following configurations assume use for internal services

To setup the identity server go to the following:
```
http://localhost:9002/if/flow/initial-setup/
```
- Default Email: `dev@email.com`
- Default Password: `dev_password`

Add the first application
- Name: Server
- Slug: server

Select Providers then choose OAuth2/OpenID Provider
- Name: Default
- Authorization Flow: default-provider-implicit-consent
- Client type: Confidential
- Redirect URIs: http://localhost:3000/auth/callback # You can add the callback or Frontend URL

Example environment variables that must be set:
```
OIDC_ISSUER_URL=http://localhost:9002/application/o/server/
OIDC_CLIENT_ID=C7XHCzioYPtdA0ulyCTxFwpXkw2mZoxBXYpEzRx0
OIDC_CLIENT_SECRET=7xcqz0syuBLyHDsaU2WPd1H4kNkpyKXPEaUUqIm63VvZHt5bfERmR2xwnJczMak7EvDi2hznwEtUjR4xtdrI2vXYYMwiyCcTDnm5QM6rj5LlwO06aMLCXQiWo1Vn1IQa
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:9002/application/o/server/end-session/
OIDC_SCOPES=openid profile email
```

### Commerce

Initialize commerce services, here we are using Vendure

Access dashboard at `http://localhost:8000/dashboard`

- Default Email: `dev@email.com`
- Default Password: `dev_password`

### Finance

In production update the `docker-compose.yml` file
```
BLOCKCHAIN_NETWORK_TYPE=testnet   # Switch to "mainnet" when you deploy live
```

#### Payram

Set up the master account at `http://localhost:8080/signup`
- Default Email: dev@email.com
- Default Password: Dev_P@ssw0rd
Select `Operator` mode if running a payment platform or marketplace. You will need to set the address that will collect fees and connect a wallet.

Access the dashboard at `http://localhost:8080/dashboard`

#### Blnk
Blnk is headless, you can access data from endpoints such as `http://localhost:5001/ledgers` and `http://localhost:5001/balances`

You can also use the cli:
```sh
npm i -g @blnkfinance/blnk-cli

blnk balances list --url http://localhost:5001
```

Example usage of SDK:
```ts
import { BlnkInit } from '@blnkfinance/blnk-typescript';

// Initialize the ledger connector pointed at your container port
const blnk = await BlnkInit({
  baseUrl: 'http://localhost:5001',
});

// Create ledger
let response = await blnk.Ledgers.create({   name: 'Customer Savings Account',   meta_data: {     project_owner: 'YOUR_APP_NAME',   }, });

// Use typing hooks to perform a transaction record
response = await blnk.Transactions.create({
  precise_amount: 10000, // $100.00 represented under Blnk's long-int scaling format
  reference: "dep_stripe_unique_ref_1002",
  currency: "USD",
  precision: 100,
  source: "@StripeClearings",
  destination: "bal_user_virtual_wallet_id",
  description: "User inbound card deposit via Saleor-Stripe bridge",
  skip_queue: true
});
```

### Communications

We are using ejabberd for messaging and LiveKit for rich media

LiveKit headless server `http://localhost:7880`
ejabberd admin endpoint `http://localhost:5280/admin`

Add the superadmin account after the first time starting the server:
```sh
docker exec -it nx_communication_messaging ejabberdctl register admin localhost dev_admin_secure_password
```

- ejabberd admin: admin@localhost
- ejabberd pass: dev_admin_secure_password


### Social

We are using GoToSocial, a headless ActivityPub server based on Mastodon.

API Endpoint `http://localhost:8081`

Example integration:
```ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createRestVersionedClient, MastoClient } from 'masto';

@Injectable()
export class SocialApiService implements OnModuleInit {
  private readonly logger = new Logger(SocialApiService.name);
  private mastoClient: MastoClient;

  // Configuration properties
  private readonly url = 'http://localhost:8081';
  private readonly accessToken = 'YOUR_SAVED_OAUTH_ACCESS_TOKEN';

  onModuleInit() {
    // Initialize the versioned Mastodon REST client wrapper
    this.mastoClient = createRestVersionedClient({
      url: this.url,
      accessToken: this.accessToken,
    });
    this.logger.log('Social API Mastodon client successfully initialized.');
  }

  /**
   * Fetch public timelines with native library methods
   */
  async getPublicTimeline() {
    // Accesses GET /api/v1/timelines/public automatically
    return await this.mastoClient.v1.timelines.public.list({
      limit: 20,
    });
  }

  /**
   * Publish a status update headlessly with full type safety
   */
  async createStatus(statusText: string) {
    // Accesses POST /api/v1/statuses automatically
    return await this.mastoClient.v1.statuses.create({
      status: statusText,
      visibility: 'public',
    });
  }
}
```
