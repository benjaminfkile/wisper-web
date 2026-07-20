# wisper-web

The **consumer + host** web app for **Wisper** — browse hosts and their priced images, buy metered per-minute container leases, drive them (console), manage billing, and (once you onboard as a host) register a wisp host, price images, and view earnings. Roles are additive: one account is a consumer and, optionally, a host.

Next.js (App Router) + MUI + TypeScript. Deployed on Vercel; it talks to the **wisper-api** control-plane.

## Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **MUI v9** (`@mui/material`) with `@mui/material-nextjs` for App-Router SSR styling
- **Vitest** + Testing Library for tests
- API access via a small typed client (`src/lib/wisper`) over a same-origin `/wisper/*` proxy (no CORS)

## Configure

The app calls same-origin `/wisper/*`; Next rewrites that to the Wisper API (see `next.config.mjs`), so there is no browser CORS. Point it at your Wisper host:

```sh
cp .env.example .env.local
# set WISPER_API_URL=https://<your-wisper-host>   (defaults to http://localhost:8080)
```

## Local development against wisper-api

To run the app fully against a **local wisper-api with no Cognito configured**, leave
the `NEXT_PUBLIC_COGNITO_*` variables unset and point the proxy at your local API:

```sh
# .env.local
WISPER_API_URL=http://127.0.0.1:8090
# (no NEXT_PUBLIC_COGNITO_* vars)
```

With Cognito unconfigured, the login page offers **"Sign in with API key"** instead of
email/password. Paste a consumer API key (`wck_live_<64-hex>`) that the operator defined
in wisper-api's `Auth:ApiKeys` configuration (see the wisper-api README, "Local
development against wisper-api"). The key is held in `localStorage`, sent as
`Authorization: Bearer <key>` exactly like a Cognito JWT, and validated by the backend via
`GET /v1/me` — the account's scopes (consumer/host/admin) drive the role-aware UI. A
bad/revoked key is rejected with 401 and cleared. When Cognito **is** configured it always
takes precedence; the API-key path is the fallback for Cognito-less environments only.

## Develop

```sh
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (type-check + lint)
npm test         # Vitest
```

## Layout

```
src/app/            App Router: layout (MUI theme) + landing page
src/components/     UI components (HealthBadge, …)
src/lib/wisper/     typed API client + types (mirrors the wisper-api docs/API.md)
src/theme.ts        MUI dark theme
```
