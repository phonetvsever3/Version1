# CKLottery Tester

A toolset for testing and interacting with the CKLottery platform.

## Project Overview

This is a pnpm monorepo with three main components:

- **CK Tester** (`artifacts/ck-tester`) — React + Vite frontend UI for testing CKLottery APIs
- **API Server** (`artifacts/api-server`) — Express backend that proxies/processes CKLottery requests
- **CK Helper Extension** (`artifacts/ck-helper-extension`) — Chrome extension that extracts `cf_clearance` cookies and tokens from the CKLottery site for use in the tester

Shared libraries:
- `lib/api-spec` — OpenAPI spec (source of truth for API contracts)
- `lib/api-zod` — Generated Zod schemas
- `lib/api-client-react` — Generated React Query hooks
- `lib/db` — Drizzle ORM database client (PostgreSQL)

## How to Run

Both services start automatically via their workflows:

| Workflow | Command | Port |
|----------|---------|------|
| **API Server** | `PORT=8080 pnpm --filter @workspace/api-server run dev` | 8080 |
| **CK Tester** | `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/ck-tester run dev` | 5173 |

## Database

The project uses Replit's built-in PostgreSQL. `DATABASE_URL` is injected automatically. Schema is managed with Drizzle ORM (`lib/db`).

## Chrome Extension

The `ck-helper-extension` is a prebuilt Chrome extension (also zipped as `artifacts/ck-helper-extension.zip`). Load it unpacked from `artifacts/ck-helper-extension/` in Chrome developer mode.

## User Preferences

- Keep existing project structure and stack
