# CKLottery Win Go Tester

Real-money Win Go lottery game interface that connects to the live CKLottery API.
Paste your JWT token → play in real-time with live countdown, real game history, wallet balance, and real bets.

---

## How to Run Everything

### Start both servers (required for full functionality)

**Terminal 1 — API Server (proxy, port 8080):**
```bash
pnpm --filter @workspace/api-server run dev
```

**Terminal 2 — Frontend (port 22340):**
```bash
pnpm --filter @workspace/ck-tester run dev
```

Or start both at once:
```bash
pnpm --filter @workspace/api-server run dev & pnpm --filter @workspace/ck-tester run dev
```

> Both workflows are also configured in Replit — click the ▶ Run button or use the Workflows panel.

### Workflow names (Replit panel)
- `artifacts/ck-tester: web` — the game frontend
- `API Server` — the proxy server

---

## Getting Your Token (required every ~30 min)

1. Open **https://www.cklottery.club** in your phone browser
2. Log in with your CKLottery account
3. Open **CK Helper** extension → tap **Extract** → copy the **Token** value
4. Paste it into the app's login screen (without the word "Bearer")
5. Tap **Login & Start Game**

Tokens expire after ~30 minutes. Get a fresh one from CK Helper when the game stops showing data.

---

## Architecture

```
Browser (React) ──→ /api/proxy/sign  (request signing)  ──→ tries direct call to ckygjf6r.com
                ──→ /api/proxy/ck/<endpoint>  (fallback)  ──→ server-side proxy to ckygjf6r.com
```

- **Direct call path**: Browser signs the request via `/api/proxy/sign`, then POSTs directly to `https://ckygjf6r.com/api/webapi/<endpoint>`. This works when Cloudflare allows mobile browsers through.
- **Proxy fallback**: If CORS blocks the direct call, requests go through our Express server which forwards them. The server avoids browser CORS restrictions.
- **Base API URL**: `https://ckygjf6r.com/api/webapi`

---

## Key Files

| File | Purpose |
|---|---|
| `artifacts/ck-tester/src/pages/WinGoGame.tsx` | Main game UI (timer, bets, history) |
| `artifacts/ck-tester/src/lib/ckApi.ts` | Token storage helpers |
| `artifacts/api-server/src/routes/proxy.ts` | Server-side proxy + request signing |
| `artifacts/ck-tester/src/pages/ProfilePage.tsx` | Full account dashboard (reference impl) |
| `artifacts/ck-tester/src/App.tsx` | Root — renders WinGoGame directly |

---

## API Endpoints Used

All go to `https://ckygjf6r.com/api/webapi/<endpoint>` (POST):

| Endpoint | Purpose |
|---|---|
| `GetCurrentIssue` / `GetGameIssue` / `GetGameInfo` | Current period number + countdown |
| `GetEmerdList` | Game history (last N rounds) |
| `GetUserInfo` | User balance |
| `BettingWingo` | Place a bet |
| `BetRecords` / `GetBettingRecord` | My bet history |

The app tries multiple endpoint variants because CKLottery uses different names across versions.

---

## Bet Payload Format

```json
{
  "typeId": 1,
  "number": "green",
  "betAmount": 10,
  "multiple": 1
}
```

`typeId`: 1=30s, 2=1Min, 3=3Min, 4=5Min

`number` values:
- Colors: `"green"`, `"violet"`, `"red"`
- Numbers: `"0"` through `"9"`
- Size: `"big"`, `"small"`

---

## Request Signing

Every API call requires a server-side HMAC signature on the request body. The signing endpoint `/api/proxy/sign` adds the required `sign` and `timestamp` fields that CKLottery validates. Without signing, all requests return "sign error".

---

## Debugging

The game shows a live **API Log** panel at the bottom — each API call reports success/failure with field values so you can see exactly what's coming back from the server.

Common issues:
- **00:00:00 timer** → API returning countdown=0; app falls back to local wall-clock estimate
- **Loading history...** → `GetEmerdList` failing; check API Log for the error
- **Sign error** → API server (`artifacts/api-server`) is not running — start it first
- **Cloudflare blocked** → token may be expired; get a fresh one from CK Helper

---

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- Frontend: React 19 + Vite 7 + inline styles (mobile-first, no Tailwind dependency for game)
- API Server: Express 5, port 8080
- Proxy: `artifacts/api-server/src/routes/proxy.ts`

---

## User Preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
