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

Default PG Admin runs on port `8080`
- Username: `admin@domain.com`
- Password: `admin_password`

On first setup be sure to connect to the dev db using the information specified in the `docker-compose.yml` file. You can do this by adding the postgres server.
- Default Host: `postgres`
- Default Port: `5432`
- Default User: `dev_user`
- Default Password: `dev_password`

Default Object Storage Admin runs on port `9001`
- Default User: `storage_admin`
- Default Pasword: `storage_secure_password`

Nest application assumes default bucket `hub-assets` exists so be sure to create it in Object Storage Admin interface before uploading assets.
