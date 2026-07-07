import { useState, useEffect, useRef, useCallback } from "react";
import { setToken, getToken, clearToken } from "@/lib/ckApi";

const CK_API_BASE = "https://ckygjf6r.com/api/webapi";

const GAME_TYPES = [
  { id: 1, label: "30s",  short: "30s",  duration: 30 },
  { id: 2, label: "1Min", short: "1Min", duration: 60 },
  { id: 3, label: "3Min", short: "3Min", duration: 180 },
  { id: 4, label: "5Min", short: "5Min", duration: 300 },
];

// ─── API helpers ────────────────────────────────────────────────────────────

async function apiPostProxy(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = getToken();
  const res = await fetch(`/api/proxy/ck/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? {
        Authorization: `Bearer ${token}`,
        "x-ck-token": `Bearer ${token}`,
        "x-ck-token-header": "Bearer",
      } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { _raw: text }; }
}

async function apiPostDirect(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = getToken();
  if (!token) throw new Error("No token");

  // Get a server-signed body first
  const signRes = await fetch("/api/proxy/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!signRes.ok) throw new Error("Sign failed");
  const signed = await signRes.json() as Record<string, unknown>;

  const res = await fetch(`${CK_API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "token-header": "Bearer",
    },
    body: JSON.stringify(signed),
  });
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { _raw: text }; }
}

async function apiPost(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    return await apiPostDirect(endpoint, body);
  } catch (e) {
    const msg = String(e);
    const isCorsOrNetwork = msg.includes("Failed to fetch") || msg.includes("NetworkError") ||
      msg.includes("Load failed") || msg.includes("CORS") || msg.includes("fetch") ||
      msg.includes("Sign failed");
    if (!isCorsOrNetwork) throw e;
  }
  return await apiPostProxy(endpoint, body);
}

// ─── Data parsers ────────────────────────────────────────────────────────────

function extractList(d: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [d, d?.data, (d?.data as Record<string, unknown>)];
  for (const obj of candidates) {
    if (Array.isArray(obj)) return obj as Record<string, unknown>[];
    if (obj && typeof obj === "object") {
      const o = obj as Record<string, unknown>;
      for (const key of ["list", "records", "items", "data", "result", "content", "betRecords"]) {
        if (Array.isArray(o[key]) && (o[key] as unknown[]).length > 0)
          return o[key] as Record<string, unknown>[];
      }
    }
  }
  return [];
}

function parseWinGoRecord(r: Record<string, unknown>) {
  const rawNum = String(
    r.preStopNumber ?? r.number ?? r.winNumber ?? r.openCode ?? r.result ??
    r.nums ?? r.lotteryResult ?? r.openResult ?? r.resultNum ?? ""
  );
  const n = isNaN(Number(rawNum.charAt(0))) ? null : Number(rawNum.charAt(0));

  const period = String(
    r.issueNumber ?? r.issueNum ?? r.period ?? r.issue ?? r.no ??
    r.periodNum ?? r.roundId ?? r.periodNumber ?? ""
  ) || "—";

  const colorRaw = String(
    r.colour ?? r.color ?? r.winColour ?? r.winColor ?? r.winColorName ?? r.colorName ?? ""
  );

  const bigSmall = String(r.bigSmall ?? r.size ?? r.bs ?? "");

  return { n, period, colorRaw, bigSmall };
}

function numColor(n: number): string {
  if (n === 0 || n === 5) return "rv";
  return [1, 3, 7, 9].includes(n) ? "g" : "r";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ColorDot({ c }: { c: string }) {
  const map: Record<string, string> = { r: "#f44336", g: "#4caf50", v: "#9c27b0" };
  const bg = map[c] ?? "#9e9e9e";
  return <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: bg, marginRight: 2, verticalAlign: "middle" }} />;
}

function NumberBall({ n, selected, onClick }: { n: number; selected: boolean; onClick: () => void }) {
  const c = numColor(n);
  const bg = c === "rv" ? "linear-gradient(135deg,#f44336 50%,#9c27b0 50%)"
    : c === "g" ? "#4caf50" : "#f44336";
  return (
    <div
      onClick={onClick}
      style={{
        width: 42, height: 42, borderRadius: "50%",
        background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer",
        border: selected ? "3px solid #ff0" : "2px solid rgba(0,0,0,.15)",
        boxShadow: selected ? "0 0 8px rgba(255,220,0,.8)" : "0 2px 4px rgba(0,0,0,.2)",
        transform: selected ? "scale(1.1)" : "scale(1)",
        transition: "all .15s",
      }}
    >
      {n}
    </div>
  );
}

// ─── Login screen ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    const t = val.replace(/^Bearer\s*/i, "").trim();
    if (!t) { setErr("Paste your token first"); return; }
    setToken(t);
    onLogin();
  };
  return (
    <div style={{ minHeight: "100vh", background: "#1565c0", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 400, boxShadow: "0 8px 32px rgba(0,0,0,.25)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 40 }}>🎰</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1565c0", margin: "8px 0 4px" }}>Win Go Tester</h1>
          <p style={{ color: "#666", fontSize: 13, margin: 0 }}>CKLottery Real Game Interface</p>
        </div>
        <label style={{ fontWeight: 600, fontSize: 13, color: "#333" }}>JWT Access Token</label>
        <textarea
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder="Paste your Bearer token here..."
          style={{ width: "100%", marginTop: 6, padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 12, fontFamily: "monospace", height: 100, boxSizing: "border-box", resize: "vertical" }}
        />
        {err && <p style={{ color: "#f44336", fontSize: 12, marginTop: 4 }}>{err}</p>}
        <button
          onClick={submit}
          style={{ width: "100%", marginTop: 12, padding: "14px 0", background: "#1565c0", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
        >
          Login & Start Game
        </button>
        <p style={{ textAlign: "center", color: "#999", fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Token from CK Helper extension → Extract → Token
        </p>
      </div>
    </div>
  );
}

// ─── Main game ───────────────────────────────────────────────────────────────

type BetSel = { type: string; value: string; label: string; color: string } | null;
type Tab = "history" | "chart" | "myhistory";

export default function WinGoGame() {
  const [loggedIn, setLoggedIn] = useState(() => !!getToken());
  const [typeIndex, setTypeIndex] = useState(0);
  const activeType = GAME_TYPES[typeIndex];

  const [period, setPeriod] = useState("—");
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  const [myBets, setMyBets] = useState<Record<string, unknown>[]>([]);
  const [myBetsLoading, setMyBetsLoading] = useState(false);

  const [selectedBet, setSelectedBet] = useState<BetSel>(null);
  const [betAmt, setBetAmt] = useState("10");
  const [multiplier, setMultiplier] = useState(1);
  const [betLoading, setBetLoading] = useState(false);
  const [betMsg, setBetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [balance, setBalance] = useState("—");
  const [tab, setTab] = useState<Tab>("history");
  const [apiLog, setApiLog] = useState<string[]>([]);
  const log = (msg: string) => setApiLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 20));

  const localCountdown = useCallback(
    () => activeType.duration - (Math.floor(Date.now() / 1000) % activeType.duration),
    [activeType.duration]
  );

  // ── Balance ──
  const fetchBalance = useCallback(() => {
    apiPost("GetUserInfo", {})
      .then(d => {
        const data = (d?.data ?? d) as Record<string, unknown>;
        const bal = data?.balance ?? data?.amount ?? data?.money ?? data?.totalBalance ?? data?.walletBalance;
        if (bal !== undefined) setBalance(String(Number(bal).toFixed(2)));
        log(`GetUserInfo OK — balance: ${bal}`);
      })
      .catch(e => log(`GetUserInfo ERR: ${e}`));
  }, []);

  // ── History ──
  const fetchResultsRef = useRef<() => void>(() => {});
  const fetchResults = useCallback(() => {
    setHistLoading(true);
    apiPost("GetEmerdList", { typeId: activeType.id, pageNo: 1, pageSize: 20, language: 0 })
      .then(d => {
        const list = extractList(d);
        if (list.length > 0) {
          setResults(list);
          const first = parseWinGoRecord(list[0]);
          if (first.period !== "—") setPeriod(first.period);
          log(`GetEmerdList OK — ${list.length} records`);
        } else {
          log(`GetEmerdList empty — raw: ${JSON.stringify(d).slice(0, 120)}`);
        }
      })
      .catch(e => log(`GetEmerdList ERR: ${e}`))
      .finally(() => setHistLoading(false));
  }, [activeType.id]);

  // ── Current period / countdown ──
  const fetchPeriodRef = useRef<() => Promise<void>>(async () => {});
  const fetchPeriod = useCallback(async () => {
    const eps = ["GetCurrentIssue", "GetGameInfo", "GetGameIssue", "GetCurrentPeriod"];
    for (const ep of eps) {
      try {
        const d = await apiPost(ep, { typeId: activeType.id });
        const data = (d?.data ?? d) as Record<string, unknown>;
        if (!data) continue;
        const p = String(
          data.issueNum ?? data.issueNumber ?? data.period ?? data.issue ?? data.no ?? ""
        );
        if (p) setPeriod(p);
        const ct = Number(
          data.countDown ?? data.countdown ?? data.remainTime ?? data.remainSeconds ??
          data.leftTime ?? data.second ?? data.time ?? 0
        );
        log(`${ep} OK — period: ${p}, countdown: ${ct}`);
        if (ct > 0) { setTimeLeft(ct); return; }
        if (p) { setTimeLeft(localCountdown()); return; }
      } catch (e) {
        log(`${ep} ERR: ${String(e).slice(0, 60)}`);
      }
    }
    // All failed — use wall-clock estimate
    setTimeLeft(localCountdown());
  }, [activeType.id, localCountdown]);

  // ── My bets ──
  const fetchMyBets = useCallback(() => {
    setMyBetsLoading(true);
    const eps = ["BetRecords", "GetBettingRecord", "GetUserBettingHistory", "MyBetList", "WingoBetRecord"];
    const tryNext = (i: number) => {
      if (i >= eps.length) { setMyBetsLoading(false); return; }
      apiPost(eps[i], { typeId: activeType.id, pageNo: 1, pageSize: 20 })
        .then(d => { setMyBets(extractList(d)); setMyBetsLoading(false); log(`${eps[i]} OK`); })
        .catch(() => tryNext(i + 1));
    };
    tryNext(0);
  }, [activeType.id]);

  // ── Timer ──
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0) return 0;
        const next = prev - 1;
        if (next <= 0) {
          // Refetch results and period on round end
          setTimeout(() => { fetchResultsRef.current(); fetchPeriodRef.current(); }, 1000);
        }
        return next;
      });
    }, 1000);
  }, []);

  // Keep refs fresh
  useEffect(() => { fetchResultsRef.current = fetchResults; }, [fetchResults]);
  useEffect(() => { fetchPeriodRef.current = fetchPeriod; }, [fetchPeriod]);

  // ── Bootstrap ──
  useEffect(() => {
    if (!loggedIn) return;
    setBetMsg(null);
    setResults([]);
    setHistLoading(true);
    setTimeLeft(localCountdown());

    fetchResults();
    fetchPeriod();
    fetchBalance();

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { fetchPeriodRef.current(); }, 6000);

    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loggedIn, typeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Place bet ──
  const placeBet = async () => {
    if (!selectedBet) return;
    setBetLoading(true);
    setBetMsg(null);
    try {
      const res = await apiPost("BettingWingo", {
        typeId: activeType.id,
        number: selectedBet.value,
        betAmount: Number(betAmt) || 10,
        multiple: multiplier,
      });
      const ok = res?.code === 0 || res?.code === 200 || String(res?.msg ?? "").toLowerCase().includes("success");
      setBetMsg({ ok, text: String(res?.msg ?? (ok ? "Bet placed!" : "Bet may have failed")) });
      setSelectedBet(null);
      if (ok) setTimeout(() => { fetchBalance(); fetchMyBets(); }, 1200);
      log(`BettingWingo: code=${res?.code} msg=${res?.msg}`);
    } catch (e) {
      setBetMsg({ ok: false, text: String(e) });
      log(`BettingWingo ERR: ${e}`);
    } finally {
      setBetLoading(false);
    }
  };

  if (!loggedIn) return <LoginScreen onLogin={() => setLoggedIn(true)} />;

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const ss = String(timeLeft % 60).padStart(2, "0");
  const bettingLocked = timeLeft > 0 && timeLeft <= 5;
  const totalBet = (Number(betAmt) || 0) * multiplier;

  const AMOUNTS = [1, 10, 100, 1000];
  const MULTIPLIERS = [1, 5, 10, 20, 50, 100];
  const BETS: BetSel[] = [
    { type: "color", value: "green",  label: "Green",  color: "#4caf50" },
    { type: "color", value: "violet", label: "Violet", color: "#9c27b0" },
    { type: "color", value: "red",    label: "Red",    color: "#f44336" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", maxWidth: 480, margin: "0 auto", fontFamily: "system-ui,sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1565c0,#1976d2)", padding: "12px 16px 0", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 8 }}>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>Win Go</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ background: "rgba(255,255,255,.2)", borderRadius: 20, padding: "3px 12px", color: "#fff", fontWeight: 700, fontSize: 13 }}>
              K{balance}
            </span>
            <button
              onClick={() => { clearToken(); setLoggedIn(false); }}
              style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}
            >
              Logout
            </button>
          </div>
        </div>
        {/* Type tabs */}
        <div style={{ display: "flex" }}>
          {GAME_TYPES.map((t, i) => (
            <button
              key={t.id}
              onClick={() => { setTypeIndex(i); setTab("history"); }}
              style={{
                flex: 1, border: "none", background: "transparent", cursor: "pointer",
                paddingBottom: 8, paddingTop: 4,
                borderBottom: i === typeIndex ? "3px solid #fff" : "3px solid transparent",
                color: i === typeIndex ? "#fff" : "rgba(255,255,255,.6)",
                fontWeight: 700, fontSize: 13,
              }}
            >
              Win Go<br />{t.short}
            </button>
          ))}
        </div>
      </div>

      {/* Timer card */}
      <div style={{ margin: "12px 12px 0", background: "#1565c0", borderRadius: 14, padding: "14px 16px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13, opacity: .8 }}>Win Go {activeType.short}</div>
            <div style={{ fontSize: 11, opacity: .6, marginTop: 4, wordBreak: "break-all" }}>{period}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, opacity: .7, marginBottom: 4 }}>Time remaining</div>
            <div style={{
              display: "flex", gap: 4, alignItems: "center",
              background: "rgba(0,0,0,.3)", borderRadius: 8, padding: "6px 10px",
            }}>
              {[mm[0], mm[1], ":", ss[0], ss[1]].map((ch, i) => (
                <span key={i} style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: ch === ":" ? "#ccc" : "#fff" }}>{ch}</span>
              ))}
            </div>
          </div>
        </div>
        {/* Last 5 mini balls */}
        {results.slice(0, 5).map((r, i) => {
          const { n, colorRaw } = parseWinGoRecord(r);
          const colors = colorRaw.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
          return (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2, marginRight: 6, marginTop: 8 }}>
              {n !== null && <span style={{
                width: 24, height: 24, borderRadius: "50%", fontWeight: 700, fontSize: 11,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: colors.includes("g") ? "#4caf50" : colors.includes("v") ? "#9c27b0" : "#f44336",
                color: "#fff",
              }}>{n}</span>}
            </span>
          );
        })}
      </div>

      {/* Betting area */}
      {bettingLocked ? (
        <div style={{ margin: "12px 12px 0", background: "#fff3cd", borderRadius: 12, padding: 14, textAlign: "center", color: "#856404", fontWeight: 600 }}>
          ⏳ Betting closed — waiting for result...
        </div>
      ) : (
        <div style={{ margin: "12px 12px 0", background: "#fff", borderRadius: 14, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
          {/* Color bets */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {BETS.map(b => (
              <button
                key={b.value}
                onClick={() => setSelectedBet(sel => sel?.value === b.value ? null : b)}
                style={{
                  flex: 1, padding: "12px 0", border: "none", borderRadius: 10,
                  background: selectedBet?.value === b.value ? b.color : `${b.color}22`,
                  color: selectedBet?.value === b.value ? "#fff" : b.color,
                  fontWeight: 700, fontSize: 15, cursor: "pointer",
                  border: `2px solid ${selectedBet?.value === b.value ? b.color : "transparent"}`,
                  transition: "all .15s",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Number balls */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 12 }}>
            {[0,1,2,3,4,5,6,7,8,9].map(n => (
              <NumberBall
                key={n} n={n}
                selected={selectedBet?.value === String(n)}
                onClick={() => setSelectedBet(sel => sel?.value === String(n) ? null : { type: "number", value: String(n), label: String(n), color: "" })}
              />
            ))}
          </div>

          {/* Multiplier */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Multiplier:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MULTIPLIERS.map(m => (
                <button
                  key={m}
                  onClick={() => setMultiplier(m)}
                  style={{
                    padding: "5px 10px", border: "1px solid #ddd", borderRadius: 6,
                    background: multiplier === m ? "#1565c0" : "#f5f5f5",
                    color: multiplier === m ? "#fff" : "#333",
                    fontWeight: 600, fontSize: 12, cursor: "pointer",
                  }}
                >
                  X{m}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Amount (K):</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {AMOUNTS.map(a => (
                <button
                  key={a}
                  onClick={() => setBetAmt(String(a))}
                  style={{
                    padding: "5px 10px", border: "1px solid #ddd", borderRadius: 6,
                    background: betAmt === String(a) ? "#1565c0" : "#f5f5f5",
                    color: betAmt === String(a) ? "#fff" : "#333",
                    fontWeight: 600, fontSize: 12, cursor: "pointer",
                  }}
                >
                  {a}
                </button>
              ))}
              <input
                type="number"
                value={betAmt}
                onChange={e => setBetAmt(e.target.value)}
                style={{ width: 60, border: "1px solid #ddd", borderRadius: 6, padding: "5px 8px", fontSize: 12, textAlign: "center" }}
              />
            </div>
          </div>

          {/* Big / Small */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {[{ value: "big", label: "Big", color: "#ff9800" }, { value: "small", label: "Small", color: "#2196f3" }].map(b => (
              <button
                key={b.value}
                onClick={() => setSelectedBet(sel => sel?.value === b.value ? null : { type: "size", value: b.value, label: b.label, color: b.color })}
                style={{
                  flex: 1, padding: "12px 0", border: `2px solid ${selectedBet?.value === b.value ? b.color : "transparent"}`,
                  borderRadius: 10, background: selectedBet?.value === b.value ? b.color : `${b.color}22`,
                  color: selectedBet?.value === b.value ? "#fff" : b.color,
                  fontWeight: 700, fontSize: 16, cursor: "pointer",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Bet button */}
          {selectedBet ? (
            <button
              onClick={placeBet}
              disabled={betLoading}
              style={{
                width: "100%", padding: "14px 0", border: "none", borderRadius: 12,
                background: betLoading ? "#ccc" : "linear-gradient(135deg,#43a047,#2e7d32)",
                color: "#fff", fontWeight: 700, fontSize: 16, cursor: betLoading ? "not-allowed" : "pointer",
              }}
            >
              {betLoading ? "Placing..." : `Bet ${selectedBet.label} — K${totalBet.toFixed(2)}`}
            </button>
          ) : (
            <div style={{ textAlign: "center", padding: "10px 0", color: "#999", fontSize: 13 }}>
              ⬆ Select a bet above
            </div>
          )}

          {betMsg && (
            <div style={{
              marginTop: 10, padding: "10px 14px", borderRadius: 8,
              background: betMsg.ok ? "#e8f5e9" : "#ffebee",
              color: betMsg.ok ? "#2e7d32" : "#c62828", fontSize: 13,
            }}>
              {betMsg.ok ? "✅ " : "❌ "}{betMsg.text}
            </div>
          )}
        </div>
      )}

      {/* History tabs */}
      <div style={{ margin: "12px 12px 0", background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #eee" }}>
          {(["history", "chart", "myhistory"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); if (t === "myhistory") fetchMyBets(); }}
              style={{
                flex: 1, padding: "11px 0", border: "none", background: "transparent", cursor: "pointer",
                borderBottom: tab === t ? "2px solid #1565c0" : "2px solid transparent",
                color: tab === t ? "#1565c0" : "#666", fontWeight: 600, fontSize: 13,
              }}
            >
              {t === "history" ? "Game history" : t === "chart" ? "Chart" : "My history"}
            </button>
          ))}
        </div>

        {tab === "history" && (
          <div>
            <div style={{ display: "flex", background: "#f5f5f5", padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#555" }}>
              <span style={{ flex: 2 }}>Period</span>
              <span style={{ flex: 1, textAlign: "center" }}>Number</span>
              <span style={{ flex: 1, textAlign: "center" }}>Big/Small</span>
              <span style={{ flex: 1, textAlign: "center" }}>Color</span>
            </div>
            {histLoading ? (
              <div style={{ padding: 20, textAlign: "center", color: "#999" }}>Loading history...</div>
            ) : results.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#999" }}>No history yet</div>
            ) : results.slice(0, 20).map((r, i) => {
              const { n, period: p, colorRaw, bigSmall } = parseWinGoRecord(r);
              const colors = colorRaw.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
              return (
                <div key={i} style={{ display: "flex", padding: "7px 12px", borderBottom: "1px solid #f5f5f5", alignItems: "center", fontSize: 12 }}>
                  <span style={{ flex: 2, color: "#555", fontSize: 11 }}>{p.slice(-8)}</span>
                  <span style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>{n ?? "—"}</span>
                  <span style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#888" }}>{bigSmall || "—"}</span>
                  <span style={{ flex: 1, textAlign: "center" }}>
                    {colors.map((c, ci) => <ColorDot key={ci} c={c[0]} />)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {tab === "chart" && (
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {results.slice(0, 50).map((r, i) => {
                const { n } = parseWinGoRecord(r);
                if (n === null) return null;
                const c = numColor(n);
                return (
                  <div key={i} style={{
                    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: c === "g" ? "#4caf50" : c === "rv" ? "#9c27b0" : "#f44336",
                    color: "#fff", fontSize: 11, fontWeight: 700,
                  }}>{n}</div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "myhistory" && (
          <div>
            {myBetsLoading ? (
              <div style={{ padding: 20, textAlign: "center", color: "#999" }}>Loading...</div>
            ) : myBets.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#999" }}>No bet history</div>
            ) : myBets.slice(0, 20).map((b, i) => {
              const issueNum = String(b.issueNumber ?? b.issue ?? b.period ?? b.no ?? "—");
              const betVal = String(b.number ?? b.betKey ?? b.betContent ?? b.betVal ?? b.content ?? "—");
              const amount = b.money ?? b.betAmount ?? b.amount ?? "—";
              const status = String(b.status ?? b.resultStatus ?? "—");
              const winAmount = b.winAmount ?? b.profit ?? b.winMoney ?? null;
              return (
                <div key={i} style={{ padding: "10px 12px", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "#555", fontSize: 11 }}>{issueNum.slice(-10)}</span>
                    <span style={{ fontWeight: 700, color: winAmount ? "#2e7d32" : "#333" }}>
                      {winAmount ? `+K${winAmount}` : `K${amount}`}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#888" }}>Bet: {betVal}</span>
                    <span style={{ color: status.toLowerCase().includes("win") ? "#2e7d32" : "#999" }}>{status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* API Debug Log */}
      <div style={{ margin: "12px 12px 16px", background: "#fff", borderRadius: 14, padding: 12, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: "#555" }}>API Log</span>
          <button onClick={() => setApiLog([])} style={{ border: "none", background: "none", color: "#999", fontSize: 11, cursor: "pointer" }}>Clear</button>
        </div>
        {apiLog.length === 0 ? (
          <div style={{ fontSize: 11, color: "#ccc" }}>No activity yet</div>
        ) : apiLog.map((l, i) => (
          <div key={i} style={{ fontSize: 10, fontFamily: "monospace", color: l.includes("ERR") ? "#c62828" : l.includes("OK") ? "#2e7d32" : "#555", marginBottom: 2, wordBreak: "break-all" }}>{l}</div>
        ))}
      </div>

    </div>
  );
}
