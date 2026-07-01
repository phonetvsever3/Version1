import { useState, useEffect, useCallback } from "react";
import type { UserSession } from "../App";
import { decodeJwt } from "../utils/jwt";

interface ProfilePageProps {
  session: UserSession;
  initialUserInfo: Record<string, unknown> | null;
  onLogout: () => void;
}

type Page = "home" | "main" | "vip" | "wallet" | "deposit" | "withdraw" | "game" | "transaction";

function buildAuth(s: UserSession) {
  return `${(s.tokenHeader || "Bearer").trim()} ${s.token}`.trim();
}

async function apiPost(path: string, body: unknown, session: UserSession): Promise<Record<string, unknown>> {
  const auth = buildAuth(session);
  const res = await fetch(`/api/proxy/ck/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: auth,
      "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const json = JSON.parse(text) as Record<string, unknown>;
  if (json.code !== 0 && json.code !== 200 && json.code !== undefined) {
    throw new Error(String(json.msg || json.message || `Code ${json.code}`));
  }
  return json;
}

function extractList(d: Record<string, unknown>): Record<string, unknown>[] {
  const inner = d?.data ?? d;
  if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  const data = inner as Record<string, unknown>;
  const list = data?.list ?? data?.records ?? data?.items ?? data?.data;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
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

// ─── Empty/Error state ────────────────────────────────────────────────────────
function ListState({ loading, error, empty }: { loading: boolean; error: string; empty: boolean }) {
  if (loading) return (
    <div className="flex flex-col items-center py-16 text-gray-400">
      <div className="text-4xl mb-3 animate-spin">⟳</div>
      <p className="text-sm">Loading...</p>
    </div>
  );
  if (error) return (
    <div className="flex flex-col items-center py-12 text-center px-4">
      <div className="text-4xl mb-3">{error.toLowerCase().includes("expir") || error.toLowerCase().includes("token") || error.toLowerCase().includes("login") ? "⚠️" : "🔒"}</div>
      <p className="text-sm font-semibold text-orange-500 mb-1">
        {error.toLowerCase().includes("expir") || error.toLowerCase().includes("token") ? "Token Expired" : "API Error"}
      </p>
      <p className="text-xs text-gray-400">{error}</p>
    </div>
  );
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

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function ProfilePage({ session, initialUserInfo, onLogout }: ProfilePageProps) {
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

  if (page === "deposit") return (
    <SubPage title="📥 Deposit History" onBack={() => setPage("main")}>
      <ListState loading={depositsLoading} error={depositsError} empty={!depositsLoading && !depositsError && deposits.length === 0} />
      {!depositsLoading && !depositsError && deposits.length > 0 && (
        <div className="space-y-3">
          {deposits.map((item, i) => {
            const amt = pick(item, ["rechargeAmount", "money", "amount", "rechargeMoney", "actualAmount", "orderAmount"]);
            const dt = pick(item, ["createTime", "addTime", "tradeTime", "time", "date", "orderTime"]);
            const statusStr = pick(item, ["statusText", "statusTip", "statusName", "statusStr"]);
            const skipKeys = ["status", "rechargeAmount", "money", "amount", "rechargeMoney", "actualAmount", "orderAmount",
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

  if (page === "withdraw") return (
    <SubPage title="📤 Withdraw History" onBack={() => setPage("main")}>
      <ListState loading={withdrawsLoading} error={withdrawsError} empty={!withdrawsLoading && !withdrawsError && withdraws.length === 0} />
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
      <ListState loading={gamesLoading} error={gamesError} empty={!gamesLoading && !gamesError && games.length === 0} />
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
      <ListState loading={transactionsLoading} error={transactionsError} empty={!transactionsLoading && !transactionsError && transactions.length === 0} />
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

  return <MainPage claims={claims} userInfo={userInfo} balance={balance} tokenExpired={tokenExpired} onNav={navTo} onLogout={onLogout} />;
}
