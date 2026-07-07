import { useState, useEffect, useRef, useCallback } from "react";
import { setToken, getToken, clearToken, getWinGoList, getWinGoCurrentIssue, placeBet, getUserInfo, type WinGoRecord } from "@/lib/ckApi";

// Confirmed from live API: GetGameIssue intervalM values match these durations exactly
const GAME_TYPES = [
  { id: 1, label: "Win Go\n1Min",  seconds: 60 },
  { id: 2, label: "Win Go\n3Min",  seconds: 180 },
  { id: 3, label: "Win Go\n5Min",  seconds: 300 },
  { id: 4, label: "Win Go\n10Min", seconds: 600 },
];

const MULTIPLIERS = ["X1", "X5", "X10", "X20", "X50", "X100"];

function NumberBall({ n, selected, onClick }: { n: number; selected: boolean; onClick: () => void }) {
  const cls = `number-ball ball-${n} ${selected ? "selected-bet" : ""}`;
  return (
    <div className={cls} onClick={onClick} title={`Bet on ${n}`}>
      <span>{n}</span>
    </div>
  );
}

function ColorDot({ color }: { color: string }) {
  const colors: Record<string, string> = {
    r: "#f44336", g: "#4caf50", v: "#9c27b0",
    red: "#f44336", green: "#4caf50", violet: "#9c27b0",
  };
  const bg = colors[color.toLowerCase()] || "#9e9e9e";
  return (
    <span
      style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", background: bg, marginRight: 2, verticalAlign: "middle" }}
    />
  );
}

function parseColors(colour: string): string[] {
  if (!colour) return [];
  return colour.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
}

function getNumberColor(n: string): string {
  const num = parseInt(n);
  if (isNaN(num)) return "";
  if (num === 0 || num === 5) return "r,v";
  return [1, 3, 7, 9].includes(num) ? "g" : "r";
}

type TabType = "history" | "chart" | "myhistory";
type BetType = "green" | "violet" | "red" | "big" | "small" | number | null;

export default function WinGoGame() {
  const [token, setTokenState] = useState<string>(getToken() || "");
  const [tokenInput, setTokenInput] = useState<string>("");
  const [loggedIn, setLoggedIn] = useState<boolean>(!!getToken());
  const [balance, setBalance] = useState<number | null>(null);
  const [userName, setUserName] = useState<string>("");

  const [selectedType, setSelectedType] = useState<number>(1);
  const [countdown, setCountdown] = useState<number>(0);
  const [currentIssue, setCurrentIssue] = useState<string>("");
  const [history, setHistory] = useState<WinGoRecord[]>([]);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [myHistory, setMyHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("history");

  const [selectedBet, setSelectedBet] = useState<BetType>(null);
  const [selectedMultiplier, setSelectedMultiplier] = useState<string>("X1");
  const [betAmount, setBetAmount] = useState<number>(10);
  const [betMsg, setBetMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string>("");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCurrentIssue = useCallback(async () => {
    try {
      const res = await getWinGoCurrentIssue(selectedType);
      if (res?.data) {
        setCurrentIssue(res.data.issueNumber || "");
        setCountdown(res.data.countDown ?? 0);
        setApiError("");
      }
    } catch (e: any) {
      setApiError(e?.message || "API error");
    }
  }, [selectedType]);

  const fetchHistory = useCallback(async (page = 1) => {
    try {
      const res = await getWinGoList(selectedType, page, 10);
      if (res?.data?.list) {
        setHistory(res.data.list);
        setHistoryTotal(res.data.total || 0);
        setHistoryPage(page);
        setApiError("");
      }
    } catch (e: any) {
      setApiError(e?.message || "API error");
    }
  }, [selectedType]);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await getUserInfo();
      if (res?.data) {
        setBalance(res.data.money ?? null);
        setUserName(res.data.nickName || res.data.userName || "");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    fetchCurrentIssue();
    fetchHistory(1);
    fetchBalance();

    pollRef.current = setInterval(() => {
      fetchCurrentIssue();
      fetchHistory(1);
      fetchBalance();
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loggedIn, selectedType, fetchCurrentIssue, fetchHistory, fetchBalance]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown(c => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [countdown]);

  const handleLogin = () => {
    const t = tokenInput.trim();
    if (!t) return;
    setToken(t);
    setTokenState(t);
    setLoggedIn(true);
  };

  const handleLogout = () => {
    clearToken();
    setTokenState("");
    setLoggedIn(false);
    setBalance(null);
    setHistory([]);
    setCurrentIssue("");
  };

  const handleBet = async () => {
    if (!selectedBet) { setBetMsg("Please select a bet option!"); return; }
    if (!currentIssue) { setBetMsg("No current issue available."); return; }
    setLoading(true);
    setBetMsg("");
    try {
      let betKey = "";
      let betType = "";
      if (selectedBet === "green") { betKey = "green"; betType = "COLOR"; }
      else if (selectedBet === "red") { betKey = "red"; betType = "COLOR"; }
      else if (selectedBet === "violet") { betKey = "violet"; betType = "COLOR"; }
      else if (selectedBet === "big") { betKey = "b"; betType = "SIZE"; }
      else if (selectedBet === "small") { betKey = "s"; betType = "SIZE"; }
      else { betKey = String(selectedBet); betType = "NUMBER"; }

      const mult = parseInt(selectedMultiplier.replace("X", "")) || 1;
      const res = await placeBet({
        typeId: selectedType,
        issueNumber: currentIssue,
        betAmount,
        betType,
        betKey,
        multiple: mult,
      });
      if (res?.code === 0 || res?.code === 200 || res?.msg?.toLowerCase().includes("success")) {
        setBetMsg(`✅ Bet placed successfully! Issue: ${currentIssue}`);
        fetchBalance();
      } else {
        setBetMsg(`❌ ${res?.msg || "Bet failed"}`);
      }
    } catch (e: any) {
      setBetMsg(`❌ Error: ${e?.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const cdStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  if (!loggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1565c0, #0d47a1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 360, boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 32 }}>🎰</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1565c0", margin: "8px 0 4px" }}>Win Go Tester</h2>
            <p style={{ color: "#888", fontSize: 13 }}>CKLottery Real Game Interface</p>
          </div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 6 }}>JWT Access Token</label>
          <textarea
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            placeholder="Paste your Bearer token here..."
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #ddd", borderRadius: 8, fontSize: 12, resize: "vertical", minHeight: 80, fontFamily: "monospace", boxSizing: "border-box" }}
          />
          <button
            onClick={handleLogin}
            style={{ width: "100%", marginTop: 12, padding: "12px", background: "linear-gradient(135deg, #1565c0, #0d47a1)", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: "pointer" }}
          >
            Login & Start Game
          </button>
          <p style={{ marginTop: 12, fontSize: 12, color: "#aaa", textAlign: "center" }}>Token from CK Helper extension → Extract → Token</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#f0f4f8", minHeight: "100vh", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1565c0, #1976d2)", color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🎰</span>
          <span style={{ fontWeight: 700, fontSize: 17 }}>CKLOTTERY</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {balance !== null && (
            <span style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "4px 12px", fontSize: 14, fontWeight: 600 }}>
              K{balance.toFixed(2)}
            </span>
          )}
          <button onClick={handleLogout} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 8, color: "#fff", padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
            Logout
          </button>
        </div>
      </div>

      {/* Balance Card */}
      <div style={{ background: "#fff", margin: "12px 12px 0", borderRadius: 12, padding: "14px 16px", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1a1a2e" }}>K{balance !== null ? balance.toFixed(2) : "---"}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <span>💳</span> Wallet balance {userName && `· ${userName}`}
          </div>
        </div>
        <button onClick={fetchBalance} style={{ background: "#f0f4f8", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: "#1565c0", fontWeight: 600 }}>
          🔄 Refresh
        </button>
      </div>

      {/* Game Type Tabs */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", background: "#fff", marginTop: 8, overflowX: "auto" }}>
        {GAME_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => { setSelectedType(t.id); setHistory([]); setCurrentIssue(""); }}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderRadius: 10,
              border: "1.5px solid",
              borderColor: selectedType === t.id ? "#1565c0" : "#e0e0e0",
              background: selectedType === t.id ? "#1565c0" : "#f8f9fa",
              color: selectedType === t.id ? "#fff" : "#555",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "pre-line",
              lineHeight: "1.3",
              textAlign: "center",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* API Error */}
      {apiError && (
        <div style={{ background: "#fff3e0", border: "1px solid #ffcc02", borderRadius: 8, margin: "8px 12px", padding: "10px 14px", fontSize: 13, color: "#e65100" }}>
          ⚠️ {apiError}
        </div>
      )}

      {/* Timer & Period Card */}
      <div style={{ background: "linear-gradient(135deg, #1565c0, #1976d2)", margin: "8px 12px 0", borderRadius: 12, padding: "14px 16px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Win Go {GAME_TYPES.find(t => t.id === selectedType)?.label.replace("Win Go\n", "") || ""}</div>
            {history.slice(0, 5).map((r, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", fontWeight: 700, fontSize: 13, marginRight: 4, background: parseInt(r.number) % 2 === 0 ? "linear-gradient(145deg, #f44336, #c62828)" : "linear-gradient(145deg, #43a047, #2e7d32)" }}>
                {r.number}
              </span>
            ))}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>Time remaining</div>
            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
              <span className="timer-digit">{String(Math.floor(countdown / 3600)).padStart(2, "0")}</span>
              <span style={{ fontWeight: 700, fontSize: 20 }}>:</span>
              <span className="timer-digit">{String(mins).padStart(2, "0")}</span>
              <span style={{ fontWeight: 700, fontSize: 20 }}>:</span>
              <span className="timer-digit timer-pulse">{String(secs).padStart(2, "0")}</span>
            </div>
            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>{currentIssue || "Loading..."}</div>
          </div>
        </div>
      </div>

      {/* Bet Options */}
      <div style={{ background: "#fff", margin: "8px 12px 0", borderRadius: 12, padding: "14px 16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        {/* Color Bets */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          {(["green", "violet", "red"] as const).map(c => (
            <button
              key={c}
              className={`bet-btn-${c} ${selectedBet === c ? "selected-bet" : ""}`}
              onClick={() => setSelectedBet(selectedBet === c ? null : c)}
            >
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>

        {/* Number Balls */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <NumberBall
              key={n}
              n={n}
              selected={selectedBet === n}
              onClick={() => setSelectedBet(selectedBet === n ? null : n)}
            />
          ))}
        </div>

        {/* Multiplier */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#888", alignSelf: "center", marginRight: 4 }}>Multiplier:</span>
          {MULTIPLIERS.map(m => (
            <button
              key={m}
              onClick={() => setSelectedMultiplier(m)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1.5px solid",
                borderColor: selectedMultiplier === m ? "#1565c0" : "#e0e0e0",
                background: selectedMultiplier === m ? "#1565c0" : "#f8f9fa",
                color: selectedMultiplier === m ? "#fff" : "#555",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Amount */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#888" }}>Amount (K):</span>
          {[1, 10, 100, 1000].map(a => (
            <button key={a} onClick={() => setBetAmount(a)} style={{ padding: "4px 10px", borderRadius: 6, border: "1.5px solid", borderColor: betAmount === a ? "#1565c0" : "#e0e0e0", background: betAmount === a ? "#e3f0ff" : "#f8f9fa", color: betAmount === a ? "#1565c0" : "#555", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              {a}
            </button>
          ))}
          <input
            type="number"
            value={betAmount}
            onChange={e => setBetAmount(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: 70, padding: "4px 8px", border: "1.5px solid #ddd", borderRadius: 6, fontSize: 13, textAlign: "center" }}
          />
        </div>

        {/* Big/Small Bets */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`bet-btn-big ${selectedBet === "big" ? "selected-bet" : ""}`} onClick={() => setSelectedBet(selectedBet === "big" ? null : "big")}>Big</button>
          <button className={`bet-btn-small ${selectedBet === "small" ? "selected-bet" : ""}`} onClick={() => setSelectedBet(selectedBet === "small" ? null : "small")}>Small</button>
        </div>

        {/* Place Bet */}
        <div style={{ textAlign: "center" }}>
          {selectedBet !== null && (
            <div style={{ fontSize: 13, color: "#1565c0", marginBottom: 8, fontWeight: 600 }}>
              Bet: <b>{String(selectedBet).toUpperCase()}</b> · K{betAmount} · {selectedMultiplier}
            </div>
          )}
          <button
            onClick={handleBet}
            disabled={loading || !currentIssue || countdown <= 3}
            style={{
              width: "100%",
              padding: "14px",
              background: countdown <= 3 ? "#ccc" : "linear-gradient(135deg, #1565c0, #0d47a1)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 16,
              fontWeight: 700,
              cursor: loading || countdown <= 3 ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Placing Bet..." : countdown <= 3 ? "⏳ Waiting for next round..." : "🎯 Place Bet"}
          </button>
          {betMsg && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: betMsg.startsWith("✅") ? "#e8f5e9" : "#ffebee", borderRadius: 8, fontSize: 13, color: betMsg.startsWith("✅") ? "#2e7d32" : "#c62828", fontWeight: 600 }}>
              {betMsg}
            </div>
          )}
        </div>
      </div>

      {/* History Tabs */}
      <div style={{ background: "#fff", margin: "8px 12px", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #f0f0f0" }}>
          {(["history", "chart", "myhistory"] as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: "12px", border: "none",
                background: activeTab === tab ? "#fff" : "#f8f9fa",
                color: activeTab === tab ? "#1565c0" : "#888",
                fontWeight: activeTab === tab ? 700 : 500,
                fontSize: 14, cursor: "pointer",
                borderBottom: activeTab === tab ? "2px solid #1565c0" : "2px solid transparent",
              }}
            >
              {tab === "history" ? "Game history" : tab === "chart" ? "Chart" : "My history"}
            </button>
          ))}
        </div>

        {activeTab === "history" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "10px 14px", background: "#1565c0", color: "#fff", fontSize: 13, fontWeight: 600 }}>
              <span>Period</span><span style={{ textAlign: "center" }}>Number</span><span style={{ textAlign: "center" }}>Big Small</span><span style={{ textAlign: "center" }}>Color</span>
            </div>
            {history.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa", fontSize: 14 }}>Loading history...</div>
            ) : (
              history.map((r, i) => {
                const colors = parseColors(r.colour || getNumberColor(r.number));
                const num = parseInt(r.number);
                const numColor = [0, 2, 4, 6, 8].includes(num) ? "#f44336" : "#43a047";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "10px 14px", borderBottom: "1px solid #f5f5f5", fontSize: 13, alignItems: "center", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <span style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>{r.issueNumber}</span>
                    <span style={{ textAlign: "center", fontWeight: 700, fontSize: 18, color: numColor }}>{r.number}</span>
                    <span style={{ textAlign: "center", color: "#555" }}>{r.bigSmall || (num >= 5 ? "Big" : "Small")}</span>
                    <span style={{ textAlign: "center", display: "flex", justifyContent: "center", gap: 3 }}>
                      {colors.map((c, j) => <ColorDot key={j} color={c} />)}
                    </span>
                  </div>
                );
              })
            )}
            {/* Pagination */}
            {historyTotal > 10 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px" }}>
                <button onClick={() => fetchHistory(Math.max(1, historyPage - 1))} disabled={historyPage <= 1} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f8f9fa", cursor: historyPage <= 1 ? "not-allowed" : "pointer" }}>‹</button>
                <span style={{ fontSize: 13, color: "#555" }}>{historyPage} / {Math.ceil(historyTotal / 10)}</span>
                <button onClick={() => fetchHistory(historyPage + 1)} disabled={historyPage >= Math.ceil(historyTotal / 10)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1565c0", background: "#1565c0", color: "#fff", cursor: "pointer" }}>›</button>
              </div>
            )}
          </div>
        )}

        {activeTab === "chart" && (
          <div style={{ padding: "16px" }}>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 12, textAlign: "center" }}>Recent 50 results — Number distribution</div>
            <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
              {history.map((r, i) => {
                const num = parseInt(r.number);
                const bg = [0, 5].includes(num) ? "#9c27b0" : [1, 3, 7, 9].includes(num) ? "#4caf50" : "#f44336";
                return (
                  <div key={i} style={{ width: 32, height: 32, borderRadius: "50%", background: bg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, boxShadow: "0 2px 4px rgba(0,0,0,0.2)" }}>
                    {r.number}
                  </div>
                );
              })}
            </div>
            {history.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 8 }}>Color frequency</div>
                {["red", "green", "violet"].map(color => {
                  const count = history.filter(r => {
                    const num = parseInt(r.number);
                    if (color === "violet") return [0, 5].includes(num);
                    if (color === "green") return [1, 3, 7, 9].includes(num);
                    return [2, 4, 6, 8].includes(num);
                  }).length;
                  const pct = Math.round((count / history.length) * 100);
                  const bg = color === "red" ? "#f44336" : color === "green" ? "#4caf50" : "#9c27b0";
                  return (
                    <div key={color} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: bg }}>{color.charAt(0).toUpperCase() + color.slice(1)}</span>
                        <span style={{ fontSize: 12, color: "#888" }}>{count} / {history.length} ({pct}%)</span>
                      </div>
                      <div style={{ background: "#eee", borderRadius: 4, height: 8 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: bg, borderRadius: 4, transition: "width 0.5s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "myhistory" && (
          <div style={{ padding: "16px", textAlign: "center", color: "#aaa", fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            My betting history will appear here after placing bets.
          </div>
        )}
      </div>

      <div style={{ height: 20 }} />
    </div>
  );
}
