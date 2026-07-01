# CKLottery Tester

A mobile-style web app that lets you view your CKLottery (cklottery.club) account — balance, VIP status, deposit/withdrawal history, and game records.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/ck-tester run dev` — run the frontend (port 22340)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS (mobile-first)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ck-tester/src/App.tsx` — root app, session state management
- `artifacts/ck-tester/src/pages/LoginPage.tsx` — login via phone/email or pasted token
- `artifacts/ck-tester/src/pages/ProfilePage.tsx` — full account dashboard (home, VIP, wallet, deposits, withdrawals, games, transactions)
- `artifacts/ck-tester/src/utils/jwt.ts` — JWT decode helper
- `artifacts/api-server/src/routes/proxy.ts` — server-side proxy to CKLottery API (bypasses CORS)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (healthz only; CKLottery calls go via proxy)

## Architecture decisions

- Direct CKLottery API calls from the browser are often blocked by Cloudflare. The app supports two login methods: (1) credentials (phone/email + password) and (2) pasting a token from localStorage.
- Session is stored in `sessionStorage` (not localStorage) — clears on tab close.
- The API server proxy (`/api/proxy/*`) forwards authenticated requests to `cklottery.club` with proper headers, bypassing CORS.
- All CKLottery data is fetched directly from the frontend — no DB schema needed.

## Product

- Login page: phone/email login or token-paste fallback
- Home: game categories, WinGo lottery results
- Account: profile, balance, quick-nav to all sections
- VIP page: level, experience, benefits
- Wallet: multi-wallet balance breakdown
- Deposit/Withdraw: paginated history with status badges
- Game history and transaction records

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- CKLottery's API may block direct browser requests (CORS/Cloudflare). The "Paste Token" mode is the reliable fallback.
- Token expiry is detected from JWT `exp` claim; expired tokens show a banner and disable data fetching.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
