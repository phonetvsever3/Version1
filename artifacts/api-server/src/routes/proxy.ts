import { Router } from "express";
import { createHash } from "crypto";
import { logger } from "../lib/logger";

const router = Router();

const CK_BASE = "https://ckygjf6r.com/api/webapi";
const CK_ORIGIN = "https://www.cklottery.club";

const commonHeaders = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Origin": CK_ORIGIN,
  "Referer": `${CK_ORIGIN}/`,
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
  const enriched: Record<string, unknown> = {
    ...body,
    language: body.language ?? 0,
    random: ckRandom(),
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

  return {
    ...enriched,
    signature: sig,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

router.post("/proxy/login", async (req, res) => {
  try {
    const body = ckSign(req.body ?? {});
    const response = await fetch(`${CK_BASE}/Login`, {
      method: "POST",
      headers: { ...commonHeaders },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
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
    const data = await response.json();
    res.status(response.status).json(data);
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
    const data = await response.json();
    res.status(response.status).json(data);
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
  try {
    const body = ckSign(req.body ?? {});
    const response = await fetch(`${CK_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        ...commonHeaders,
        ...(authorization ? { Authorization: authorization } : {}),
        ...(tokenHeader ? { "token-header": tokenHeader } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    logger.error({ err, endpoint }, "Proxy ck error");
    res.status(502).json({ error: "Failed to reach CKLottery server" });
  }
});

export default router;
