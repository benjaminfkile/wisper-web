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
