---
name: CKLottery API field names
description: Exact response field names for WinGo game endpoints, discovered via debug logging sessions
---

## GetGameIssue (current period + countdown)
Response fields: `issueNumber, startTime, endTime, serviceTime, intervalM`
- `issueNumber` — current period number
- `endTime`, `serviceTime` — **datetime strings** like `"2026-07-07 19:27:00"` (NOT Unix timestamps)
- Countdown calculation: `Math.round((new Date(endTime.replace(" ","T")) - new Date(serviceTime.replace(" ","T"))) / 1000)`
- There is NO `countDown` field — must compute from endTime - serviceTime

## GetNoaverageEmerdList (per-round game history)
- This is the correct endpoint for per-round history (NOT `GetEmerdList`)
- `GetEmerdList` returns statistics (number_0..number_9 occurrence counts), NOT round results
- Response fields: `issueNumber, number, colour, premium`
- `typeId` param required (1=30s, 2=1Min, 3=3Min, 4=5Min)

## GetUserInfo (balance)
Response fields include: `balance`, `amount`, `money`, `totalBalance`, `walletBalance`

## Betting endpoint
- Working endpoint: `GameBetting`
- Failed: `BettingWingo`, `WinGoBetting`, `Betting`, `WinBetting`, `BetWingo`
- Required fields: `SelectType` (bet value: "green"/"red"/"violet"/"big"/"small"/"0"-"9"), `Amount` (bet amount number)
- Also send: `typeId`, `issueNumber` (current period), `multiple`

## Base URL
`https://ckygjf6r.com/api/webapi`

**Why:** Took many iterations and debug logging to discover these. Field names differ significantly from expected conventions.
