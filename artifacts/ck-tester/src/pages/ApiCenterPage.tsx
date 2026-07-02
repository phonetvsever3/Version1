import { useState, useEffect, useCallback } from "react";
import type { UserSession } from "../App";
import { decodeJwt } from "../utils/jwt";

interface Props {
  session: UserSession;
  onBack: () => void;
}

function buildAuth(s: UserSession) {
  return `${(s.tokenHeader || "Bearer").trim()} ${s.token}`.trim();
}

async function ckPost(ep: string, body: Record<string, unknown>, session: UserSession): Promise<Record<string, unknown>> {
  const auth = buildAuth(session);
  const res = await fetch(`/api/proxy/ck/${ep}`, {
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
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { error: "non-json" }; }
}

function extractData(d: Record<string, unknown>): Record<string, unknown> {
  return ((d?.data ?? d) as Record<string, unknown>) ?? {};
}

function extractList(d: Record<string, unknown>): Record<string, unknown>[] {
  const src = extractData(d);
  for (const key of ["list", "records", "items", "data", "result", "content", "rechargetypelist", "bankCardList"]) {
    if (Array.isArray(src[key])) return src[key] as Record<string, unknown>[];
  }
  if (Array.isArray(d.data)) return d.data as Record<string, unknown>[];
  return [];
}

type Status = "idle" | "loading" | "ok" | "error";

interface DataBlock {
  status: Status;
  data: unknown;
  error: string;
}

function Spin() {
  return <span className="inline-block animate-spin text-blue-400">⟳</span>;
}

function Tag({ ok }: { ok: boolean }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ml-2 ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-500"}`}>
      {ok ? "✓ OK" : "✗ FAIL"}
    </span>
  );
}

function SectionCard({ title, icon, status, children }: { title: string; icon: string; status: Status; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm mb-3 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="font-bold text-gray-800 text-sm flex-1">{title}</span>
        {status === "loading" && <Spin />}
        {status === "ok" && <Tag ok />}
        {status === "error" && <Tag ok={false} />}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || value === "") return null;
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  return (
    <div className="flex justify-between items-start gap-2 py-1 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <span className="text-xs text-gray-800 font-medium text-right break-all max-w-[55%]">{str}</span>
    </div>
  );
}

function RecordRow({ item }: { item: Record<string, unknown> }) {
  const entries = Object.entries(item).filter(([k]) => !k.startsWith("_")).slice(0, 6);
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2 mb-2">
      {entries.map(([k, v]) => <KV key={k} label={k} value={v} />)}
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return <p className="text-xs text-gray-400 italic text-center py-3">{msg}</p>;
}

export default function ApiCenterPage({ session, onBack }: Props) {
  const claims = decodeJwt(session.token);

  const initBlock = (): DataBlock => ({ status: "idle", data: null, error: "" });

  const [userInfo, setUserInfo] = useState<DataBlock>(initBlock());
  const [vipInfo, setVipInfo] = useState<DataBlock>(initBlock());
  const [vipList, setVipList] = useState<DataBlock>(initBlock());
  const [wallets, setWallets] = useState<DataBlock>(initBlock());
  const [bankCards, setBankCards] = useState<DataBlock>(initBlock());
  const [deposits, setDeposits] = useState<DataBlock>(initBlock());
  const [withdraws, setWithdraws] = useState<DataBlock>(initBlock());
  const [bets, setBets] = useState<DataBlock>(initBlock());
  const [transactions, setTransactions] = useState<DataBlock>(initBlock());
  const [invite, setInvite] = useState<DataBlock>(initBlock());
  const [agent, setAgent] = useState<DataBlock>(initBlock());
  const [safe, setSafe] = useState<DataBlock>(initBlock());
  const [signInfo, setSignInfo] = useState<DataBlock>(initBlock());
  const [notice, setNotice] = useState<DataBlock>(initBlock());
  const [activity, setActivity] = useState<DataBlock>(initBlock());
  const [rebate, setRebate] = useState<DataBlock>(initBlock());
  const [team, setTeam] = useState<DataBlock>(initBlock());
  const [wingoHistory, setWingoHistory] = useState<DataBlock>(initBlock());
  const [withdrawInfo, setWithdrawInfo] = useState<DataBlock>(initBlock());
  const [rechargeTypes, setRechargeTypes] = useState<DataBlock>(initBlock());

  const [totalApis, setTotalApis] = useState(0);
  const [successApis, setSuccessApis] = useState(0);
  const [totalDataPoints, setTotalDataPoints] = useState(0);

  const [rawEp, setRawEp] = useState("");
  const [rawBody, setRawBody] = useState("{}");
  const [rawResult, setRawResult] = useState<DataBlock>(initBlock());
  const [copiedRaw, setCopiedRaw] = useState(false);

  const fetch1 = useCallback(async (
    ep: string,
    body: Record<string, unknown>,
    setter: (b: DataBlock) => void,
    countPoints: (d: unknown) => number = () => 1,
  ) => {
    setter({ status: "loading", data: null, error: "" });
    try {
      const res = await ckPost(ep, body, session);
      const err = res?.error ?? res?.Error;
      const code = res?.code ?? res?.Code;
      const isErr = typeof err === "string" && err !== "" && err !== "undefined";
      const badCode = code !== undefined && code !== 0 && code !== 200 && code !== "0";
      if (isErr || badCode) {
        const msg = String(res?.msg ?? res?.message ?? err ?? `code ${code}`);
        setter({ status: "error", data: res, error: msg });
        setTotalApis(n => n + 1);
      } else {
        const pts = countPoints(res);
        setter({ status: "ok", data: res, error: "" });
        setTotalApis(n => n + 1);
        setSuccessApis(n => n + 1);
        setTotalDataPoints(n => n + pts);
      }
    } catch (e) {
      setter({ status: "error", data: null, error: String(e) });
      setTotalApis(n => n + 1);
    }
  }, [session]);

  const loadAll = useCallback(() => {
    setTotalApis(0); setSuccessApis(0); setTotalDataPoints(0);

    fetch1("GetUserInfo", {}, setUserInfo, (d) => {
      const data = extractData(d as Record<string, unknown>);
      return Object.keys(data).length;
    });
    fetch1("GetVipUserLevelDetail", {}, setVipInfo, () => 5);
    fetch1("GetVipList", {}, setVipList, (d) => extractList(d as Record<string, unknown>).length + 1);
    fetch1("GetAllwallets", {}, setWallets, (d) => Object.keys(extractData(d as Record<string, unknown>)).length);
    fetch1("GetBankCard", {}, setBankCards, (d) => extractList(d as Record<string, unknown>).length + 1);
    fetch1("GetRechargeRecord", { pageIndex: 1, pageSize: 20 }, setDeposits, (d) => extractList(d as Record<string, unknown>).length);
    fetch1("GetWithdrawLog", { pageIndex: 1, pageSize: 20 }, setWithdraws, (d) => extractList(d as Record<string, unknown>).length);
    fetch1("BetRecords", { pageIndex: 1, pageSize: 20 }, setBets, (d) => extractList(d as Record<string, unknown>).length);
    fetch1("RecordList", { pageIndex: 1, pageSize: 20 }, setTransactions, (d) => extractList(d as Record<string, unknown>).length);
    fetch1("GetInviteInfo", {}, setInvite, () => 5);
    fetch1("GetAgentInfo", {}, setAgent, () => 5);
    fetch1("GetSafeInfo", {}, setSafe, () => 3);
    fetch1("GetSignInfo", {}, setSignInfo, () => 3);
    fetch1("GetNotice", { pageIndex: 1, pageSize: 10 }, setNotice, (d) => extractList(d as Record<string, unknown>).length + 1);
    fetch1("GetActivityList", { pageIndex: 1, pageSize: 10 }, setActivity, (d) => extractList(d as Record<string, unknown>).length + 1);
    fetch1("GetRebateInfo", {}, setRebate, () => 4);
    fetch1("GetTeamInfo", {}, setTeam, () => 5);
    fetch1("GetEmerdList", { typeId: 1 }, setWingoHistory, (d) => extractList(d as Record<string, unknown>).length);
    fetch1("GetWithdrawInfo", {}, setWithdrawInfo, () => 4);
    fetch1("GetRechargeTypes", {}, setRechargeTypes, (d) => extractList(d as Record<string, unknown>).length + 1);
  }, [fetch1]);

  useEffect(() => { loadAll(); }, []);

  async function runRaw() {
    if (!rawEp.trim()) return;
    setRawResult({ status: "loading", data: null, error: "" });
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(rawBody); } catch { body = {}; }
    try {
      const res = await ckPost(rawEp.trim(), body, session);
      setRawResult({ status: "ok", data: res, error: "" });
    } catch (e) {
      setRawResult({ status: "error", data: null, error: String(e) });
    }
  }

  function copyRaw() {
    const str = JSON.stringify(rawResult.data, null, 2);
    navigator.clipboard.writeText(str).then(() => { setCopiedRaw(true); setTimeout(() => setCopiedRaw(false), 2000); }).catch(() => {});
  }

  const allLoaded = [userInfo, vipInfo, vipList, wallets, bankCards, deposits, withdraws, bets, transactions, invite, agent, safe, signInfo, notice, activity, rebate, team, wingoHistory, withdrawInfo, rechargeTypes].every(b => b.status !== "loading");

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-500 px-4 pt-12 pb-5 flex items-center gap-3">
        <button onClick={onBack} className="text-white text-3xl leading-none w-8 flex-shrink-0">‹</button>
        <div className="flex-1">
          <h1 className="text-white font-bold text-lg">📡 API Data Center</h1>
          <p className="text-white/70 text-xs mt-0.5">All data collected from CKLottery API</p>
        </div>
        <button
          onClick={loadAll}
          disabled={!allLoaded}
          className="bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-xl disabled:opacity-40"
        >
          ↻ Reload All
        </button>
      </div>

      {/* Summary Bar */}
      <div className="mx-4 mt-3 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl p-4 text-white shadow-lg">
        <div className="text-xs opacity-75 mb-1 font-medium">Live API Connection Summary</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-2xl font-bold">{totalApis}/20</div>
            <div className="text-[10px] opacity-75 mt-0.5">APIs Called</div>
          </div>
          <div className="text-center border-x border-white/20">
            <div className="text-2xl font-bold text-green-300">{successApis}</div>
            <div className="text-[10px] opacity-75 mt-0.5">Connected</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-300">{totalDataPoints}</div>
            <div className="text-[10px] opacity-75 mt-0.5">Data Points</div>
          </div>
        </div>
        {!allLoaded && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-white/20 rounded-full h-1.5">
              <div className="bg-white h-1.5 rounded-full transition-all" style={{ width: `${Math.round((totalApis / 20) * 100)}%` }} />
            </div>
            <span className="text-xs opacity-75">Loading…</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 mt-3">

        {/* ── JWT Token Info ── */}
        <SectionCard title="JWT Token Claims" icon="🔑" status="ok">
          {claims ? (
            <div>
              <KV label="User ID" value={claims.nameid ?? claims.sub ?? claims.userId} />
              <KV label="Username" value={claims.name ?? claims.unique_name} />
              <KV label="Role" value={claims.role ?? claims.Role} />
              <KV label="IP Address" value={(claims as Record<string,unknown>).LoginIPAddress} />
              <KV label="Login Mark" value={(claims as Record<string,unknown>).LoginMark} />
              <KV label="Token Type" value={(claims as Record<string,unknown>).TokenType} />
              <KV label="Expires" value={claims.exp ? new Date(Number(claims.exp) * 1000).toLocaleString() : "—"} />
              <KV label="Issued At" value={claims.iat ? new Date(Number(claims.iat) * 1000).toLocaleString() : "—"} />
            </div>
          ) : <EmptyState msg="No JWT claims decoded" />}
        </SectionCard>

        {/* ── User Info ── */}
        <SectionCard title="User Account Info" icon="👤" status={userInfo.status}>
          {userInfo.status === "loading" && <EmptyState msg="Fetching GetUserInfo…" />}
          {userInfo.status === "error" && <EmptyState msg={userInfo.error} />}
          {userInfo.status === "ok" && (() => {
            const d = extractData(userInfo.data as Record<string,unknown>);
            return (
              <div>
                <KV label="User ID" value={d.userId ?? d.id ?? d.uid} />
                <KV label="Nickname" value={d.nickname ?? d.nickName ?? d.userName} />
                <KV label="Phone" value={d.mobile ?? d.phone ?? d.number} />
                <KV label="Email" value={d.email} />
                <KV label="Balance" value={d.balance ?? d.amount ?? d.money} />
                <KV label="Total Balance" value={d.totalBalance ?? d.totalMoney} />
                <KV label="VIP Level" value={d.vipLevel ?? d.vip ?? d.memberLevel} />
                <KV label="Avatar" value={d.headImage ?? d.avatar ?? d.headImg} />
                <KV label="Register Date" value={d.createTime ?? d.registerTime ?? d.createdAt} />
                <KV label="Status" value={d.status} />
                <KV label="Safe Balance" value={d.safeBalance ?? d.safeAmount} />
                <KV label="Integral/Points" value={d.integral ?? d.points ?? d.score} />
                <KV label="Inviter" value={d.inviteCode ?? d.inviterCode ?? d.parentCode} />
                <KV label="Agent Code" value={d.agentCode ?? d.agentId} />
                <KV label="Currency" value={d.currency ?? d.currencyType} />
                <KV label="Real Name" value={d.realName ?? d.fullName} />
              </div>
            );
          })()}
        </SectionCard>

        {/* ── VIP ── */}
        <SectionCard title="VIP Status" icon="🏆" status={vipInfo.status}>
          {vipInfo.status === "loading" && <EmptyState msg="Fetching VIP data…" />}
          {vipInfo.status === "error" && <EmptyState msg={vipInfo.error} />}
          {vipInfo.status === "ok" && (() => {
            const d = extractData(vipInfo.data as Record<string,unknown>);
            return (
              <div>
                <KV label="VIP Level" value={d.vipLevel ?? d.level ?? d.vip} />
                <KV label="VIP Name" value={d.vipName ?? d.levelName} />
                <KV label="Experience" value={d.experience ?? d.exp ?? d.expValue} />
                <KV label="Next Level Exp" value={d.needExp ?? d.nextLevelExp ?? d.upgradeExp} />
                <KV label="Total Recharge" value={d.totalRecharge ?? d.rechargeMoney ?? d.totalDeposit} />
                <KV label="Withdrawal Limit" value={d.withdrawLimit ?? d.withdrawalLimit ?? d.dayWithdrawLimit} />
                <KV label="Rebate Rate" value={d.rebateRate ?? d.rebate} />
                <KV label="Weekly Bonus" value={d.weeklyBonus ?? d.weekBonus} />
                <KV label="Monthly Bonus" value={d.monthlyBonus ?? d.monthBonus} />
              </div>
            );
          })()}
        </SectionCard>

        {/* ── VIP List ── */}
        <SectionCard title="All VIP Levels" icon="💎" status={vipList.status}>
          {vipList.status === "loading" && <EmptyState msg="Fetching VIP levels…" />}
          {vipList.status === "error" && <EmptyState msg={vipList.error} />}
          {vipList.status === "ok" && (() => {
            const list = extractList(vipList.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No VIP levels returned" />;
            return (
              <div className="space-y-2">
                {list.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold">
                      {String(item.vipLevel ?? item.level ?? i + 1)}
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-gray-800">{String(item.vipName ?? item.levelName ?? `VIP ${i + 1}`)}</div>
                      <div className="text-xs text-gray-400">Deposit: {String(item.rechargeMoney ?? item.depositMoney ?? "—")}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-green-600 font-medium">{String(item.withdrawLimit ?? item.withdrawalLimit ?? "—")}</div>
                      <div className="text-[10px] text-gray-400">Withdraw limit</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Wallets ── */}
        <SectionCard title="All Wallets & Balances" icon="💰" status={wallets.status}>
          {wallets.status === "loading" && <EmptyState msg="Fetching wallets…" />}
          {wallets.status === "error" && <EmptyState msg={wallets.error} />}
          {wallets.status === "ok" && (() => {
            const d = extractData(wallets.data as Record<string,unknown>);
            const walletList = (d.walletList ?? d.wallets ?? d.list) as Record<string,unknown>[] | undefined;
            return (
              <div>
                <KV label="Main Balance" value={d.balance ?? d.mainBalance ?? d.amount} />
                <KV label="E-Wallet" value={d.eWalletBalance ?? d.eWallet} />
                <KV label="Bank Balance" value={d.bankBalance} />
                <KV label="USDT Balance" value={d.usdtBalance ?? d.usdt} />
                <KV label="Safe Balance" value={d.safeBalance ?? d.safe} />
                <KV label="Total Assets" value={d.totalBalance ?? d.totalAmount ?? d.total} />
                <KV label="Integral/Points" value={d.integral ?? d.points} />
                {walletList && walletList.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {walletList.map((w, i) => (
                      <div key={i} className="flex justify-between bg-blue-50 rounded-lg px-3 py-1.5">
                        <span className="text-xs text-gray-600">{String(w.walletName ?? w.name ?? w.type ?? `Wallet ${i + 1}`)}</span>
                        <span className="text-xs font-bold text-blue-700">{String(w.balance ?? w.amount ?? w.money ?? "—")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Bank Cards ── */}
        <SectionCard title="Bank Cards / Withdrawal Accounts" icon="🏦" status={bankCards.status}>
          {bankCards.status === "loading" && <EmptyState msg="Fetching bank cards…" />}
          {bankCards.status === "error" && <EmptyState msg={bankCards.error} />}
          {bankCards.status === "ok" && (() => {
            const list = extractList(bankCards.data as Record<string,unknown>);
            const d = extractData(bankCards.data as Record<string,unknown>);
            if (!list.length) return (
              <div>
                <KV label="Card Number" value={d.cardNumber ?? d.bankAccount ?? d.accountNo} />
                <KV label="Bank Name" value={d.bankName} />
                <KV label="Account Name" value={d.accountName ?? d.holderName} />
                <KV label="IFSC" value={d.ifscCode ?? d.ifsc} />
                <KV label="UPI ID" value={d.upiId ?? d.vpa} />
                {Object.keys(d).length === 0 && <EmptyState msg="No bank cards on file" />}
              </div>
            );
            return (
              <div className="space-y-2">
                {list.map((card, i) => (
                  <div key={i} className="bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl p-3 text-white">
                    <div className="text-xs opacity-70 mb-1">{String(card.bankName ?? card.bank ?? "Bank Card")}</div>
                    <div className="font-mono text-sm font-bold">{String(card.cardNumber ?? card.accountNo ?? card.bankAccount ?? "—")}</div>
                    <div className="text-xs opacity-80 mt-1">{String(card.accountName ?? card.holderName ?? "")}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Deposit History ── */}
        <SectionCard title="Deposit History" icon="📥" status={deposits.status}>
          {deposits.status === "loading" && <EmptyState msg="Fetching deposits…" />}
          {deposits.status === "error" && <EmptyState msg={deposits.error} />}
          {deposits.status === "ok" && (() => {
            const list = extractList(deposits.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No deposit records" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 8).map((item, i) => {
                  const stateVal = item.state ?? item.status;
                  const ok = stateVal === 1 || stateVal === "1" || String(stateVal).toLowerCase() === "success";
                  const pending = stateVal === 0 || stateVal === "0";
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className={`w-2 h-8 rounded-full ${ok ? "bg-green-400" : pending ? "bg-yellow-400" : "bg-red-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-gray-800">K{String(item.rechargeAmount ?? item.money ?? item.amount ?? "—")}</div>
                        <div className="text-[10px] text-gray-400 truncate">{String(item.rechargeNumber ?? item.orderNo ?? item.id ?? "")}</div>
                        <div className="text-[10px] text-gray-400">{String(item.createTime ?? item.createdAt ?? "")}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ok ? "bg-green-100 text-green-700" : pending ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-500"}`}>
                        {ok ? "Success" : pending ? "Pending" : "Failed"}
                      </span>
                    </div>
                  );
                })}
                {list.length > 8 && <div className="text-xs text-center text-gray-400 pt-1">+{list.length - 8} more records</div>}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Withdrawal History ── */}
        <SectionCard title="Withdrawal History" icon="📤" status={withdraws.status}>
          {withdraws.status === "loading" && <EmptyState msg="Fetching withdrawals…" />}
          {withdraws.status === "error" && <EmptyState msg={withdraws.error} />}
          {withdraws.status === "ok" && (() => {
            const list = extractList(withdraws.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No withdrawal records" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 6).map((item, i) => {
                  const stateVal = item.state ?? item.status;
                  const ok = stateVal === 1 || stateVal === "1";
                  const pending = stateVal === 0 || stateVal === "0";
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className={`w-2 h-8 rounded-full ${ok ? "bg-green-400" : pending ? "bg-yellow-400" : "bg-red-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-gray-800">K{String(item.withdrawAmount ?? item.money ?? item.amount ?? "—")}</div>
                        <div className="text-[10px] text-gray-400 truncate">{String(item.withdrawNumber ?? item.orderNo ?? item.id ?? "")}</div>
                        <div className="text-[10px] text-gray-400">{String(item.createTime ?? item.createdAt ?? "")}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ok ? "bg-green-100 text-green-700" : pending ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-500"}`}>
                        {ok ? "Done" : pending ? "Pending" : "Failed"}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Withdraw Info / Limits ── */}
        <SectionCard title="Withdrawal Limits & Info" icon="📊" status={withdrawInfo.status}>
          {withdrawInfo.status === "loading" && <EmptyState msg="Fetching limits…" />}
          {withdrawInfo.status === "error" && <EmptyState msg={withdrawInfo.error} />}
          {withdrawInfo.status === "ok" && (() => {
            const d = extractData(withdrawInfo.data as Record<string,unknown>);
            return (
              <div>
                <KV label="Min Withdraw" value={d.minMoney ?? d.minWithdraw ?? d.minAmount} />
                <KV label="Max Withdraw" value={d.maxMoney ?? d.maxWithdraw ?? d.maxAmount} />
                <KV label="Daily Limit" value={d.dayLimit ?? d.dailyLimit ?? d.dayWithdrawLimit} />
                <KV label="Fee" value={d.fee ?? d.serviceFee ?? d.handlingFee} />
                <KV label="Times Today" value={d.todayTimes ?? d.dayTimes ?? d.usedTimes} />
                <KV label="Remaining Times" value={d.remainTimes ?? d.leftTimes} />
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Recharge Types / Payment Methods ── */}
        <SectionCard title="Payment Methods Available" icon="💳" status={rechargeTypes.status}>
          {rechargeTypes.status === "loading" && <EmptyState msg="Fetching payment methods…" />}
          {rechargeTypes.status === "error" && <EmptyState msg={rechargeTypes.error} />}
          {rechargeTypes.status === "ok" && (() => {
            const list = extractList(rechargeTypes.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No payment methods returned" />;
            return (
              <div className="space-y-1.5">
                {list.slice(0, 10).map((m, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-base">💳</div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-gray-800">{String(m.payName ?? m.typeName ?? m.name ?? m.id ?? `Method ${i + 1}`)}</div>
                      <div className="text-[10px] text-gray-400">Min: {String(m.miniPrice ?? m.minPrice ?? "—")} · Max: {String(m.maxPrice ?? m.maxMoney ?? "—")}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Bet Records ── */}
        <SectionCard title="Game / Bet Records" icon="🎮" status={bets.status}>
          {bets.status === "loading" && <EmptyState msg="Fetching bet records…" />}
          {bets.status === "error" && <EmptyState msg={bets.error} />}
          {bets.status === "ok" && (() => {
            const list = extractList(bets.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No bet records found" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 6).map((item, i) => {
                  const profit = item.profit ?? item.winAmount ?? item.winMoney;
                  const isWin = profit !== undefined && Number(profit) > 0;
                  return (
                    <div key={i} className="bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-gray-800">{String(item.gameName ?? item.game ?? item.gameType ?? `Game ${i + 1}`)}</span>
                        <span className={`text-xs font-bold ${isWin ? "text-green-600" : "text-red-500"}`}>
                          {isWin ? `+K${String(profit)}` : `K${String(item.betAmount ?? item.money ?? "—")}`}
                        </span>
                      </div>
                      <div className="flex gap-3 text-[10px] text-gray-400">
                        <span>Bet: K{String(item.betAmount ?? item.money ?? "—")}</span>
                        <span>Result: {String(item.result ?? item.status ?? "—")}</span>
                        <span>{String(item.createTime ?? item.betTime ?? "").slice(0, 16)}</span>
                      </div>
                    </div>
                  );
                })}
                {list.length > 6 && <div className="text-xs text-center text-gray-400 pt-1">+{list.length - 6} more bets</div>}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Transactions ── */}
        <SectionCard title="Balance Transaction Records" icon="📋" status={transactions.status}>
          {transactions.status === "loading" && <EmptyState msg="Fetching transactions…" />}
          {transactions.status === "error" && <EmptyState msg={transactions.error} />}
          {transactions.status === "ok" && (() => {
            const list = extractList(transactions.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No transaction records" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 8).map((item, i) => {
                  const amount = Number(item.money ?? item.amount ?? 0);
                  const isPositive = amount > 0;
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${isPositive ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"}`}>
                        {isPositive ? "+" : "−"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-800">{String(item.remark ?? item.type ?? item.typeName ?? "Transaction")}</div>
                        <div className="text-[10px] text-gray-400">{String(item.createTime ?? item.createdAt ?? "").slice(0, 16)}</div>
                      </div>
                      <div className={`text-sm font-bold ${isPositive ? "text-green-600" : "text-red-500"}`}>
                        {isPositive ? "+" : ""}K{Math.abs(amount).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── WinGo History ── */}
        <SectionCard title="WinGo Lottery Results" icon="🎱" status={wingoHistory.status}>
          {wingoHistory.status === "loading" && <EmptyState msg="Fetching WinGo results…" />}
          {wingoHistory.status === "error" && <EmptyState msg={wingoHistory.error} />}
          {wingoHistory.status === "ok" && (() => {
            const list = extractList(wingoHistory.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No WinGo results" />;
            return (
              <div className="space-y-1.5">
                {list.slice(0, 8).map((r, i) => {
                  const numRaw = String(r.preStopNumber ?? r.number ?? r.winNumber ?? r.openCode ?? "");
                  const n = isNaN(Number(numRaw.charAt(0))) ? "?" : numRaw.charAt(0);
                  const color = String(r.colour ?? r.color ?? r.winColor ?? "");
                  const period = String(r.issueNumber ?? r.period ?? r.issue ?? `#${i + 1}`);
                  const isGreen = color.toLowerCase().includes("green");
                  const isRed = color.toLowerCase().includes("red");
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                      <span className="text-[10px] text-gray-400 w-24 shrink-0">{period.slice(-8)}</span>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${isGreen ? "bg-green-500" : isRed ? "bg-red-500" : "bg-purple-500"}`}>{n}</div>
                      <span className={`text-xs font-semibold ${isGreen ? "text-green-600" : isRed ? "text-red-500" : "text-purple-600"}`}>{color || "—"}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Invite / Referral ── */}
        <SectionCard title="Invite & Referral Info" icon="👥" status={invite.status}>
          {invite.status === "loading" && <EmptyState msg="Fetching invite info…" />}
          {invite.status === "error" && <EmptyState msg={invite.error} />}
          {invite.status === "ok" && (() => {
            const d = extractData(invite.data as Record<string,unknown>);
            return (
              <div>
                <KV label="Invite Code" value={d.inviteCode ?? d.invitationCode ?? d.code} />
                <KV label="Invite Link" value={d.inviteLink ?? d.inviteUrl ?? d.link} />
                <KV label="Total Invites" value={d.inviteNum ?? d.totalInvite ?? d.count} />
                <KV label="Valid Invites" value={d.validInviteNum ?? d.validCount ?? d.validInvite} />
                <KV label="Commission" value={d.commission ?? d.totalCommission ?? d.rebate} />
                {Object.keys(d).length === 0 && <EmptyState msg="No invite data" />}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Agent Info ── */}
        <SectionCard title="Agent / Downline Info" icon="🤝" status={agent.status}>
          {agent.status === "loading" && <EmptyState msg="Fetching agent data…" />}
          {agent.status === "error" && <EmptyState msg={agent.error} />}
          {agent.status === "ok" && (() => {
            const d = extractData(agent.data as Record<string,unknown>);
            return (
              <div>
                <KV label="Agent Code" value={d.agentCode ?? d.agentId ?? d.code} />
                <KV label="Total Members" value={d.totalMember ?? d.memberCount ?? d.total} />
                <KV label="Active Members" value={d.activeMember ?? d.activeCount} />
                <KV label="Total Commission" value={d.totalCommission ?? d.commission} />
                <KV label="Yesterday Commission" value={d.yesterdayCommission} />
                <KV label="Level" value={d.agentLevel ?? d.level} />
                {Object.keys(d).length === 0 && <EmptyState msg="No agent data (may need agent account)" />}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Team Info ── */}
        <SectionCard title="Team Statistics" icon="📈" status={team.status}>
          {team.status === "loading" && <EmptyState msg="Fetching team data…" />}
          {team.status === "error" && <EmptyState msg={team.error} />}
          {team.status === "ok" && (() => {
            const d = extractData(team.data as Record<string,unknown>);
            return (
              <div>
                <KV label="Team Size" value={d.teamCount ?? d.totalTeam ?? d.total} />
                <KV label="Direct Members" value={d.directCount ?? d.direct ?? d.level1Count} />
                <KV label="Team Deposit" value={d.teamDeposit ?? d.totalDeposit ?? d.rechargeMoney} />
                <KV label="Team Bet" value={d.teamBet ?? d.totalBet ?? d.betAmount} />
                <KV label="Team Commission" value={d.teamCommission ?? d.commission} />
                {Object.keys(d).length === 0 && <EmptyState msg="No team data" />}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Rebate ── */}
        <SectionCard title="Rebate / Cashback Info" icon="💸" status={rebate.status}>
          {rebate.status === "loading" && <EmptyState msg="Fetching rebate data…" />}
          {rebate.status === "error" && <EmptyState msg={rebate.error} />}
          {rebate.status === "ok" && (() => {
            const d = extractData(rebate.data as Record<string,unknown>);
            return (
              <div>
                <KV label="Rebate Rate" value={d.rebateRate ?? d.rate ?? d.rebate} />
                <KV label="Total Rebate" value={d.totalRebate ?? d.totalAmount} />
                <KV label="Today Rebate" value={d.todayRebate ?? d.todayAmount} />
                <KV label="Bet Required" value={d.betAmount ?? d.validBet ?? d.requireBet} />
                {Object.keys(d).length === 0 && <EmptyState msg="No rebate data" />}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Safe ── */}
        <SectionCard title="Safe / Savings Vault" icon="🔒" status={safe.status}>
          {safe.status === "loading" && <EmptyState msg="Fetching safe info…" />}
          {safe.status === "error" && <EmptyState msg={safe.error} />}
          {safe.status === "ok" && (() => {
            const d = extractData(safe.data as Record<string,unknown>);
            return (
              <div>
                <KV label="Safe Balance" value={d.safeBalance ?? d.balance ?? d.amount} />
                <KV label="Interest Rate" value={d.interestRate ?? d.rate} />
                <KV label="Status" value={d.status ?? d.state} />
                <KV label="Daily Interest" value={d.dailyInterest ?? d.interest} />
                {Object.keys(d).length === 0 && <EmptyState msg="No safe/vault data" />}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Sign-in ── */}
        <SectionCard title="Daily Sign-in Status" icon="📅" status={signInfo.status}>
          {signInfo.status === "loading" && <EmptyState msg="Fetching sign-in info…" />}
          {signInfo.status === "error" && <EmptyState msg={signInfo.error} />}
          {signInfo.status === "ok" && (() => {
            const d = extractData(signInfo.data as Record<string,unknown>);
            return (
              <div>
                <KV label="Consecutive Days" value={d.consecutiveDays ?? d.signDays ?? d.days} />
                <KV label="Today Signed" value={d.isSigned ?? d.todaySigned ?? d.status} />
                <KV label="Today Reward" value={d.todayReward ?? d.reward ?? d.bonus} />
                <KV label="Total Sign-ins" value={d.totalSign ?? d.total} />
                {Object.keys(d).length === 0 && <EmptyState msg="No sign-in data" />}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Notices ── */}
        <SectionCard title="System Notices" icon="🔔" status={notice.status}>
          {notice.status === "loading" && <EmptyState msg="Fetching notices…" />}
          {notice.status === "error" && <EmptyState msg={notice.error} />}
          {notice.status === "ok" && (() => {
            const list = extractList(notice.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No notices" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 5).map((item, i) => (
                  <div key={i} className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                    <div className="text-xs font-semibold text-blue-800">{String(item.title ?? item.noticeTitle ?? `Notice ${i + 1}`)}</div>
                    <div className="text-[10px] text-blue-600 mt-0.5 line-clamp-2">{String(item.content ?? item.noticeContent ?? "")}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Activities ── */}
        <SectionCard title="Promotions & Activities" icon="🎁" status={activity.status}>
          {activity.status === "loading" && <EmptyState msg="Fetching activities…" />}
          {activity.status === "error" && <EmptyState msg={activity.error} />}
          {activity.status === "ok" && (() => {
            const list = extractList(activity.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No activities" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 5).map((item, i) => (
                  <div key={i} className="bg-gradient-to-r from-orange-50 to-pink-50 border border-orange-100 rounded-xl px-3 py-2">
                    <div className="text-xs font-semibold text-gray-800">{String(item.title ?? item.activityName ?? item.name ?? `Activity ${i + 1}`)}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{String(item.startTime ?? item.beginTime ?? "")} – {String(item.endTime ?? "")}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* ── Raw API Explorer ── */}
        <div className="bg-white rounded-2xl shadow-sm mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
            <span className="text-lg">🔬</span>
            <span className="font-bold text-gray-800 text-sm">Raw API Explorer</span>
            <span className="text-xs text-gray-400 ml-1">Call any endpoint</span>
          </div>
          <div className="px-4 py-3">
            <div className="mb-2">
              <div className="text-xs text-gray-500 mb-1">Endpoint Name</div>
              <input
                type="text"
                value={rawEp}
                onChange={e => setRawEp(e.target.value)}
                placeholder="e.g. GetUserInfo, GetVipList, GetActivityList…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-indigo-400 font-mono"
              />
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-1">Request Body (JSON)</div>
              <textarea
                value={rawBody}
                onChange={e => setRawBody(e.target.value)}
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 bg-gray-50 focus:outline-none focus:border-indigo-400 font-mono resize-none"
              />
            </div>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={runRaw}
                disabled={rawResult.status === "loading" || !rawEp.trim()}
                className="flex-1 bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-bold py-2.5 rounded-xl active:opacity-80"
              >
                {rawResult.status === "loading" ? "Calling…" : "▶ Call API"}
              </button>
              {rawResult.data && (
                <button
                  type="button"
                  onClick={copyRaw}
                  className="bg-gray-100 text-gray-600 text-sm font-bold px-4 py-2.5 rounded-xl active:bg-gray-200"
                >
                  {copiedRaw ? "✓" : "Copy"}
                </button>
              )}
            </div>

            {rawResult.status === "ok" && rawResult.data && (
              <div className="bg-gray-900 rounded-xl p-3 max-h-72 overflow-y-auto">
                <pre className="text-xs text-green-400 whitespace-pre-wrap break-all">
                  {JSON.stringify(rawResult.data, null, 2)}
                </pre>
              </div>
            )}
            {rawResult.status === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{rawResult.error}</div>
            )}

            {/* Quick endpoint buttons */}
            <div className="mt-3">
              <div className="text-xs text-gray-400 mb-2">Quick endpoints:</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "GetUserInfo", "GetVipList", "GetAllwallets", "GetBankCard",
                  "GetRechargeRecord", "GetWithdrawLog", "BetRecords", "RecordList",
                  "GetInviteInfo", "GetAgentInfo", "GetTeamInfo", "GetSafeInfo",
                  "GetSignInfo", "GetNotice", "GetActivityList", "GetRebateInfo",
                  "GetEmerdList", "GetWithdrawInfo", "GetRechargeTypes", "GetVipUserLevelDetail",
                  "GetGameList", "GetFriendList", "GetMessageList", "GetTaskList",
                  "GetPromotionList", "GetBonusRecord", "GetTurnoverRecord",
                ].map(ep => (
                  <button
                    key={ep}
                    type="button"
                    onClick={() => { setRawEp(ep); setRawBody("{}"); }}
                    className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-1 rounded-lg font-mono active:bg-indigo-100"
                  >
                    {ep}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
