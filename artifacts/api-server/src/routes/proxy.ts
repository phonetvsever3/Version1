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
  // timestamp MUST be included before computing the signature
  const enriched: Record<string, unknown> = {
    ...body,
    language: body.language ?? 0,
    random: ckRandom(),
    timestamp: Math.floor(Date.now() / 1000),
  };

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(enriched).sort();
  for (const k of keys) {
    const v = enriched[k];
    if (v !== null && v !== "" && !EXCLUDE.includes(k)) {
      sorted[k] = v;
    }
  }

  const sig = createHash("md5")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .toUpperCase()
    .slice(0, 32);

  return { ...enriched, signature: sig };
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

export default router;
