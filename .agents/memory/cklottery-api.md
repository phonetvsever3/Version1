---
name: CKLottery API field names
description: Exact response field names for WinGo game endpoints, discovered via debug logging and live API testing
---

## Game Type IDs (confirmed via live GetGameIssue testing)
- typeId=1 → 1 Min (intervalM=1, duration=60s)
- typeId=2 → 3 Min (intervalM=3, duration=180s)
- typeId=3 → 5 Min (intervalM=5, duration=300s)
- typeId=4 → 10 Min (intervalM=10, duration=600s)

**Why:** Earlier code had wrong labels (30s/1Min/3Min/5Min). Confirmed by checking endTime-startTime difference for each typeId.

## GetGameIssue (current period + countdown)
Response fields: `issueNumber, startTime, endTime, serviceTime, intervalM`
- `issueNumber` — current period number (format: `YYYYMMDD` + `10001` game-type prefix + round number)
- `endTime`, `serviceTime` — **datetime strings** like `"2026-07-07 20:07:00"` (NOT Unix timestamps)
- Countdown calculation: `Math.round((new Date(endTime.replace(" ","T")) - new Date(serviceTime.replace(" ","T"))) / 1000)`
- There is NO `countDown` field — must compute from endTime - serviceTime

## GetNoaverageEmerdList (per-round game history)
- This is the correct endpoint for per-round history (NOT `GetEmerdList`)
- `GetEmerdList` returns statistics (number_0..number_9 occurrence counts), NOT round results
- Response fields: `issueNumber, number, colour, premium`
- `colour` is a **full English word**: `"red"`, `"green"`, `"red,violet"` (comma-separated for 0 and 5)
- `typeId` param required (1=1Min, 2=3Min, 3=5Min, 4=10Min); also send `pageNo` and `pageSize`

## GetUserInfo (balance)
- Working field: `amount` (not `balance`)
- Other fields present: `userId, userName, nickName, amountofCode, withdrawCount, uRate, trxRate`

## Betting endpoint
- Working endpoint: `GameBetting`
- Failed: `BettingWingo`, `WinGoBetting`, `Betting`, `WinBetting`, `BetWingo`
- Required fields: `SelectType` (bet value: "green"/"red"/"violet"/"big"/"small"/"0"-"9"), `Amount` (number)
- Also send: `typeId`, `Issuenumber` (current period string), `issueNumber`, `multiple`
- Returns code=4 "No operation permission" if Issuenumber is missing/empty

## My History / Bet Records
- **NO working endpoint exists** on ckygjf6r.com webapi for this user
- Confirmed failed: BetRecords, GetBettingRecord, GetUserBettingHistory, MyBetList, WingoBetRecord,
  GetWingoBetRecord, GetMyBetHistory, GetUserRecord, GetNoaverageBetList, GetPersonBetRecord,
  GetBetList, GetMyBetList, GetMyBetRecord, GetBetListRecord, GetBetingRecord, WingoBetList,
  GetWinGoGameRecord, GetGameBetRecord, GetBettingList, GetOrderRecord, GetOrderList, etc.
- Show static "not available" message in My History tab; do not loop through these endpoints

## Base URL
`https://ckygjf6r.com/api/webapi`

**Why:** Took many iterations and debug logging to discover these. Field names differ significantly from expected conventions.
