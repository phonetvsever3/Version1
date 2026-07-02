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
  const res = await fetch(`/api/proxy/ck/${ep}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildAuth(session),
      "x-ck-token-header": (session.tokenHeader || "Bearer").trim(),
      ...(session.cfClearance ? { "x-ck-cf-clearance": session.cfClearance } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { error: "non-json" }; }
}

const URL_NOT_EXIST_MSGS = [
  "url is not exist", "url not exist", "not exist", "not found",
  "no route", "no such", "invalid url", "no_route", "url_not_exist",
];

function isUrlNotExist(msg: string): boolean {
  const m = msg.toLowerCase();
  return URL_NOT_EXIST_MSGS.some(p => m.includes(p));
}

function isApiOk(res: Record<string, unknown>): boolean {
  const code = res.code ?? res.Code;
  const msg = String(res.msg ?? res.message ?? res.error ?? "");
  if (isUrlNotExist(msg)) return false;
  if (typeof res.error === "string" && res.error !== "" && res.error !== "non-json") return false;
  if (code === undefined) return true;
  return code === 0 || code === 200 || code === "0";
}

async function tryEndpoints(
  candidates: Array<{ ep: string; body?: Record<string, unknown> }>,
  session: UserSession,
): Promise<{ res: Record<string, unknown>; ep: string } | null> {
  for (const { ep, body = {} } of candidates) {
    try {
      const res = await ckPost(ep, body, session);
      if (isApiOk(res)) return { res, ep };
    } catch { /* continue */ }
  }
  return null;
}

function extractData(d: Record<string, unknown>): Record<string, unknown> {
  const src = (d?.data ?? d) as Record<string, unknown>;
  return src ?? {};
}

function extractList(d: Record<string, unknown>): Record<string, unknown>[] {
  const src = extractData(d);
  for (const key of ["list", "records", "items", "data", "result", "content",
    "rechargetypelist", "bankCardList", "noticeList", "activityList",
    "rows", "pageData", "dataList", "vipList", "memberList"]) {
    if (Array.isArray(src[key])) return src[key] as Record<string, unknown>[];
  }
  if (Array.isArray(d.data)) return d.data as Record<string, unknown>[];
  if (Array.isArray(src)) return src as Record<string, unknown>[];
  return [];
}

function pick(...vals: unknown[]): unknown {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}

type Status = "idle" | "loading" | "ok" | "error";
interface DataBlock { status: Status; data: unknown; error: string; ep?: string; }

function Spin() { return <span className="inline-block animate-spin text-blue-400">⟳</span>; }
function Tag({ ok }: { ok: boolean }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ml-2 ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-500"}`}>
      {ok ? "✓ OK" : "✗ FAIL"}
    </span>
  );
}
function SectionCard({ title, icon, status, epName, children }: {
  title: string; icon: string; status: Status; epName?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm mb-3 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-gray-800 text-sm">{title}</span>
          {epName && <span className="ml-2 text-[10px] text-gray-400 font-mono">{epName}</span>}
        </div>
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
      <span className="text-xs text-gray-800 font-medium text-right break-all max-w-[58%]">{str}</span>
    </div>
  );
}
function EmptyState({ msg }: { msg: string }) {
  return <p className="text-xs text-gray-400 italic text-center py-3">{msg}</p>;
}

export default function ApiCenterPage({ session, onBack }: Props) {
  const claims = decodeJwt(session.token);
  const init = (): DataBlock => ({ status: "idle", data: null, error: "" });

  const [userInfo,       setUserInfo]       = useState<DataBlock>(init());
  const [vipInfo,        setVipInfo]        = useState<DataBlock>(init());
  const [vipList,        setVipList]        = useState<DataBlock>(init());
  const [wallets,        setWallets]        = useState<DataBlock>(init());
  const [bankCards,      setBankCards]      = useState<DataBlock>(init());
  const [deposits,       setDeposits]       = useState<DataBlock>(init());
  const [withdraws,      setWithdraws]      = useState<DataBlock>(init());
  const [withdrawInfo,   setWithdrawInfo]   = useState<DataBlock>(init());
  const [payMethods,     setPayMethods]     = useState<DataBlock>(init());
  const [bets,           setBets]           = useState<DataBlock>(init());
  const [transactions,   setTransactions]   = useState<DataBlock>(init());
  const [wingo,          setWingo]          = useState<DataBlock>(init());
  const [invite,         setInvite]         = useState<DataBlock>(init());
  const [agent,          setAgent]          = useState<DataBlock>(init());
  const [team,           setTeam]           = useState<DataBlock>(init());
  const [rebate,         setRebate]         = useState<DataBlock>(init());
  const [safe,           setSafe]           = useState<DataBlock>(init());
  const [signInfo,       setSignInfo]       = useState<DataBlock>(init());
  const [notices,        setNotices]        = useState<DataBlock>(init());
  const [activities,     setActivities]     = useState<DataBlock>(init());

  const [totalApis,      setTotalApis]      = useState(0);
  const [successApis,    setSuccessApis]    = useState(0);
  const [totalPoints,    setTotalPoints]    = useState(0);

  const [rawEp,    setRawEp]    = useState("");
  const [rawBody,  setRawBody]  = useState("{}");
  const [rawBlock, setRawBlock] = useState<DataBlock>(init());
  const [copied,   setCopied]   = useState(false);

  const settle = useCallback((
    setter: (b: DataBlock) => void,
    result: { res: Record<string, unknown>; ep: string } | null,
    pts: (d: Record<string, unknown>) => number,
  ) => {
    setTotalApis(n => n + 1);
    if (result) {
      setter({ status: "ok", data: result.res, error: "", ep: result.ep });
      setSuccessApis(n => n + 1);
      setTotalPoints(n => n + pts(result.res));
    } else {
      setter({ status: "error", data: null, error: "Url is not exist" });
    }
  }, []);

  const loadAll = useCallback(() => {
    setTotalApis(0); setSuccessApis(0); setTotalPoints(0);
    const ALL = 20;
    [setUserInfo, setVipInfo, setVipList, setWallets, setBankCards, setDeposits,
      setWithdraws, setWithdrawInfo, setPayMethods, setBets, setTransactions,
      setWingo, setInvite, setAgent, setTeam, setRebate, setSafe, setSignInfo,
      setNotices, setActivities].forEach(s => s({ status: "loading", data: null, error: "" }));

    const run = async (
      candidates: Array<{ ep: string; body?: Record<string, unknown> }>,
      setter: (b: DataBlock) => void,
      pts: (d: Record<string, unknown>) => number = () => 1,
    ) => settle(setter, await tryEndpoints(candidates, session), pts);

    // 1 User Info
    run([{ ep: "GetUserInfo" }], setUserInfo,
      d => Object.keys(extractData(d)).length);

    // 2 VIP Status
    run([{ ep: "GetVipUserLevelDetail" }, { ep: "GetVipDetail" }, { ep: "GetUserVipInfo" }, { ep: "GetVipUserDetail" }], setVipInfo, () => 5);

    // 3 All VIP Levels
    run([
      { ep: "GetVipList" }, { ep: "VipList" }, { ep: "GetVipGradeList" },
      { ep: "GetVipLevelList" }, { ep: "GetVipGrade" }, { ep: "GetVipLevel" },
      { ep: "GetAllVipList" }, { ep: "GetVipLevelConfig" },
    ], setVipList, d => extractList(d).length + 1);

    // 4 Wallets
    run([{ ep: "GetAllwallets" }, { ep: "GetWallet" }, { ep: "GetUserWallet" }, { ep: "GetWalletInfo" }], setWallets,
      d => Object.keys(extractData(d)).length);

    // 5 Bank Cards
    run([
      { ep: "GetBankCard" }, { ep: "GetBankCardList" }, { ep: "BankCardList" },
      { ep: "GetUserBankCard" }, { ep: "GetMemberBankCard" }, { ep: "GetUserCardInfo" },
      { ep: "GetCardInfo" }, { ep: "GetBankInfo" },
    ], setBankCards, d => extractList(d).length + 1);

    // 6 Deposits
    run([
      { ep: "GetRechargeRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "RechargeRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetRechargeLogs", body: { pageIndex: 1, pageSize: 20 } },
    ], setDeposits, d => extractList(d).length);

    // 7 Withdrawals
    run([
      { ep: "GetWithdrawLog", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetWithdrawRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "WithdrawLog", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetWithdrawHistory", body: { pageIndex: 1, pageSize: 20 } },
    ], setWithdraws, d => extractList(d).length);

    // 8 Withdrawal Limits
    run([
      { ep: "GetWithdrawInfo" }, { ep: "GetWithdrawConfig" }, { ep: "GetWithdrawLimit" },
      { ep: "WithdrawConfig" }, { ep: "GetWithdrawSetting" }, { ep: "GetWithdrawType" },
      { ep: "GetWithdrawRule" }, { ep: "GetWithdrawData" },
    ], setWithdrawInfo, () => 4);

    // 9 Payment Methods
    run([
      { ep: "GetRechargeTypes", body: { payid: 1 } },
      { ep: "GetRechargeTypes", body: { payid: 0 } },
      { ep: "GetPayTypes" }, { ep: "GetPayMethod" }, { ep: "GetRechargeMethods" },
      { ep: "GetRechargeMethod" }, { ep: "GetPayChannel" }, { ep: "GetPaymentMethod" },
      { ep: "GetRechargeChannelList" }, { ep: "GetRechargeType" },
    ], setPayMethods, d => extractList(d).length + 1);

    // 10 Bet / Game Records
    run([
      { ep: "BetRecords", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "BettingRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetBettingRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetBetRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetGameRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "WinGoRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetWingoRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetLotteryRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetOrderRecord", body: { pageIndex: 1, pageSize: 20, gameType: 1 } },
    ], setBets, d => extractList(d).length);

    // 11 Balance Transactions
    run([
      { ep: "RecordList", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "AllRecords", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetRecordList", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetTransferRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetAllRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetChangeRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "ChangeRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetBalanceRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetFundRecord", body: { pageIndex: 1, pageSize: 20 } },
      { ep: "GetFinanceRecord", body: { pageIndex: 1, pageSize: 20 } },
    ], setTransactions, d => extractList(d).length);

    // 12 WinGo results
    run([
      { ep: "GetEmerdList", body: { typeId: 1 } },
      { ep: "GetWinGoList", body: { typeId: 1 } },
      { ep: "GetColorList", body: { typeId: 1 } },
      { ep: "GetLotteryList", body: { typeId: 1 } },
    ], setWingo, d => extractList(d).length);

    // 13 Invite / Referral
    run([
      { ep: "GetInviteInfo" }, { ep: "GetInvite" }, { ep: "InviteInfo" },
      { ep: "GetUserInvite" }, { ep: "GetInviteCode" }, { ep: "GetInviteList" },
      { ep: "GetReferralInfo" }, { ep: "GetShareInfo" }, { ep: "GetPromoteInfo" },
    ], setInvite, () => 5);

    // 14 Agent
    run([
      { ep: "GetAgentInfo" }, { ep: "GetAgent" }, { ep: "AgentInfo" },
      { ep: "GetUserAgent" }, { ep: "GetAgentData" }, { ep: "GetAgentDetail" },
    ], setAgent, () => 5);

    // 15 Team
    run([
      { ep: "GetTeamInfo" }, { ep: "GetTeam" }, { ep: "TeamInfo" },
      { ep: "GetUserTeam" }, { ep: "GetTeamMember" }, { ep: "GetTeamData" },
      { ep: "GetSubordinateInfo" }, { ep: "GetMemberList", body: { pageIndex: 1, pageSize: 10 } },
    ], setTeam, () => 5);

    // 16 Rebate
    run([
      { ep: "GetRebateInfo" }, { ep: "GetRebate" }, { ep: "RebateInfo" },
      { ep: "GetUserRebate" }, { ep: "GetRebateData" }, { ep: "GetCashbackInfo" },
      { ep: "GetCommissionInfo" }, { ep: "GetCommission" },
    ], setRebate, () => 4);

    // 17 Safe
    run([
      { ep: "GetSafeInfo" }, { ep: "GetSafe" }, { ep: "SafeInfo" },
      { ep: "GetUserSafe" }, { ep: "GetSafeData" }, { ep: "GetVault" },
    ], setSafe, () => 3);

    // 18 Sign-in
    run([
      { ep: "GetSignInfo" }, { ep: "GetSign" }, { ep: "SignInfo" },
      { ep: "GetDailySign" }, { ep: "GetSignRecord" }, { ep: "CheckSign" },
      { ep: "GetAttendance" }, { ep: "GetCheckIn" }, { ep: "GetSignInInfo" },
      { ep: "GetSignStatus" },
    ], setSignInfo, () => 3);

    // 19 Notices
    run([
      { ep: "GetNotice", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetNoticeList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "NoticeList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetAnnouncementList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetBroadcast", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetAnnouncement", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetMessage", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetMessageList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetSysNotice", body: { pageIndex: 1, pageSize: 10 } },
    ], setNotices, d => extractList(d).length + 1);

    // 20 Activities
    run([
      { ep: "GetActivityList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetActivity", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "ActivityList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetPromotion", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetPromotionList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetActiveList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetEventList", body: { pageIndex: 1, pageSize: 10 } },
      { ep: "GetBonusList", body: { pageIndex: 1, pageSize: 10 } },
    ], setActivities, d => extractList(d).length + 1);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    void ALL;
  }, [session, settle]);

  useEffect(() => { loadAll(); }, []);

  async function runRaw() {
    if (!rawEp.trim()) return;
    setRawBlock({ status: "loading", data: null, error: "" });
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(rawBody); } catch { body = {}; }
    try {
      const res = await ckPost(rawEp.trim(), body, session);
      setRawBlock({ status: "ok", data: res, error: "" });
    } catch (e) {
      setRawBlock({ status: "error", data: null, error: String(e) });
    }
  }

  function copyRaw() {
    navigator.clipboard.writeText(JSON.stringify(rawBlock.data, null, 2))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  const allDone = [userInfo, vipInfo, vipList, wallets, bankCards, deposits,
    withdraws, withdrawInfo, payMethods, bets, transactions, wingo,
    invite, agent, team, rebate, safe, signInfo, notices, activities
  ].every(b => b.status !== "loading");

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-500 px-4 pt-12 pb-5 flex items-center gap-3">
        <button onClick={onBack} className="text-white text-3xl leading-none w-8 shrink-0">‹</button>
        <div className="flex-1">
          <h1 className="text-white font-bold text-lg">📡 API Data Center</h1>
          <p className="text-white/70 text-xs mt-0.5">All CKLottery API data — live</p>
        </div>
        <button onClick={loadAll} disabled={!allDone}
          className="bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-xl disabled:opacity-40">
          ↻ Reload
        </button>
      </div>

      {/* Summary */}
      <div className="mx-4 mt-3 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl p-4 text-white shadow-lg">
        <div className="text-xs opacity-75 mb-2 font-medium">Live API Summary</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-2xl font-bold">{totalApis}/20</div>
            <div className="text-[10px] opacity-75 mt-0.5">APIs Called</div>
          </div>
          <div className="text-center border-x border-white/20">
            <div className="text-2xl font-bold text-green-300">{successApis}</div>
            <div className="text-[10px] opacity-75 mt-0.5">Connected ✓</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-300">{totalPoints}</div>
            <div className="text-[10px] opacity-75 mt-0.5">Data Points</div>
          </div>
        </div>
        {!allDone && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-white/20 rounded-full h-1.5">
              <div className="bg-white h-1.5 rounded-full transition-all"
                style={{ width: `${Math.round((totalApis / 20) * 100)}%` }} />
            </div>
            <span className="text-xs opacity-75">{totalApis}/20</span>
          </div>
        )}
      </div>

      <div className="px-4 mt-3">

        {/* JWT Token */}
        <SectionCard title="JWT Token Claims" icon="🔑" status="ok">
          {claims ? (
            <>
              <KV label="User ID"   value={pick(claims.nameid, claims.sub, (claims as Record<string,unknown>).UserId, claims.userId)} />
              <KV label="Username"  value={pick(claims.name, claims.unique_name, (claims as Record<string,unknown>).NickName)} />
              <KV label="Role"      value={pick(claims.role, (claims as Record<string,unknown>).Role)} />
              <KV label="IP"        value={(claims as Record<string,unknown>).LoginIPAddress} />
              <KV label="Token Type" value={(claims as Record<string,unknown>).TokenType} />
              <KV label="Expires"   value={claims.exp ? new Date(Number(claims.exp) * 1000).toLocaleString() : undefined} />
              <KV label="Issued At" value={claims.iat ? new Date(Number(claims.iat) * 1000).toLocaleString() : undefined} />
            </>
          ) : <EmptyState msg="No JWT decoded" />}
        </SectionCard>

        {/* User Info */}
        <SectionCard title="User Account Info" icon="👤" status={userInfo.status} epName={userInfo.ep}>
          {userInfo.status === "loading" && <EmptyState msg="Loading…" />}
          {userInfo.status === "error" && <EmptyState msg={userInfo.error} />}
          {userInfo.status === "ok" && (() => {
            const d = extractData(userInfo.data as Record<string,unknown>);
            return <>
              <KV label="User ID"      value={pick(d.userId, d.id, d.uid, d.memberId)} />
              <KV label="Nickname"     value={pick(d.nickname, d.nickName, d.userName, d.name)} />
              <KV label="Phone"        value={pick(d.mobile, d.phone, d.number, d.phoneNumber)} />
              <KV label="Email"        value={d.email} />
              <KV label="Balance"      value={pick(d.balance, d.amount, d.money, d.mainBalance)} />
              <KV label="Total Balance" value={pick(d.totalBalance, d.totalMoney, d.totalAmount)} />
              <KV label="VIP Level"    value={pick(d.vipLevel, d.vip, d.memberLevel, d.level)} />
              <KV label="Safe Balance" value={pick(d.safeBalance, d.safeAmount)} />
              <KV label="Points"       value={pick(d.integral, d.points, d.score)} />
              <KV label="Invite Code"  value={pick(d.inviteCode, d.invitationCode, d.parentCode)} />
              <KV label="Real Name"    value={pick(d.realName, d.fullName)} />
              <KV label="Status"       value={d.status} />
              <KV label="Register"     value={pick(d.createTime, d.registerTime, d.createdAt)} />
            </>;
          })()}
        </SectionCard>

        {/* VIP Status */}
        <SectionCard title="VIP Status" icon="🏆" status={vipInfo.status} epName={vipInfo.ep}>
          {vipInfo.status === "loading" && <EmptyState msg="Loading…" />}
          {vipInfo.status === "error" && <EmptyState msg={vipInfo.error} />}
          {vipInfo.status === "ok" && (() => {
            const d = extractData(vipInfo.data as Record<string,unknown>);
            return <>
              <KV label="VIP Level"   value={pick(d.vipLevel, d.level, d.vip)} />
              <KV label="VIP Name"    value={pick(d.vipName, d.levelName, d.name)} />
              <KV label="Experience"  value={pick(d.experience, d.exp, d.expValue, d.currentExp)} />
              <KV label="Need Exp"    value={pick(d.needExp, d.nextLevelExp, d.upgradeExp)} />
              <KV label="Total Deposit" value={pick(d.totalRecharge, d.rechargeMoney, d.totalDeposit)} />
              <KV label="Withdraw Limit" value={pick(d.withdrawLimit, d.withdrawalLimit, d.dayWithdrawLimit)} />
              <KV label="Rebate Rate" value={pick(d.rebateRate, d.rebate)} />
              <KV label="Weekly Bonus"  value={pick(d.weeklyBonus, d.weekBonus)} />
              <KV label="Monthly Bonus" value={pick(d.monthlyBonus, d.monthBonus)} />
            </>;
          })()}
        </SectionCard>

        {/* All VIP Levels */}
        <SectionCard title="All VIP Levels" icon="💎" status={vipList.status} epName={vipList.ep}>
          {vipList.status === "loading" && <EmptyState msg="Loading…" />}
          {vipList.status === "error" && <EmptyState msg="Endpoint not available on this server" />}
          {vipList.status === "ok" && (() => {
            const list = extractList(vipList.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No VIP levels returned" />;
            return (
              <div className="space-y-2">
                {list.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {String(pick(item.vipLevel, item.level, i + 1))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-800">{String(pick(item.vipName, item.levelName, item.name, `VIP ${i + 1}`))}</div>
                      <div className="text-[10px] text-gray-400">Deposit: {String(pick(item.rechargeMoney, item.depositMoney, item.minDeposit, "—"))}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-green-600 font-medium">{String(pick(item.withdrawLimit, item.withdrawalLimit, item.dayLimit, "—"))}</div>
                      <div className="text-[10px] text-gray-400">limit</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* Wallets */}
        <SectionCard title="All Wallets & Balances" icon="💰" status={wallets.status} epName={wallets.ep}>
          {wallets.status === "loading" && <EmptyState msg="Loading…" />}
          {wallets.status === "error" && <EmptyState msg={wallets.error} />}
          {wallets.status === "ok" && (() => {
            const d = extractData(wallets.data as Record<string,unknown>);
            const wList = (pick(d.walletList, d.wallets, d.list) ?? []) as Record<string,unknown>[];
            return <>
              <KV label="Main Balance"  value={pick(d.balance, d.mainBalance, d.amount)} />
              <KV label="E-Wallet"      value={pick(d.eWalletBalance, d.eWallet, d.eWalletAmount)} />
              <KV label="USDT"          value={pick(d.usdtBalance, d.usdt, d.usdtAmount)} />
              <KV label="Safe Balance"  value={pick(d.safeBalance, d.safe, d.safeAmount)} />
              <KV label="Total Assets"  value={pick(d.totalBalance, d.totalAmount, d.total)} />
              <KV label="Points"        value={pick(d.integral, d.points, d.score)} />
              {wList.length > 0 && (
                <div className="mt-2 space-y-1">
                  {wList.map((w, i) => (
                    <div key={i} className="flex justify-between bg-blue-50 rounded-lg px-3 py-1.5">
                      <span className="text-xs text-gray-600">{String(pick(w.walletName, w.name, w.type, `Wallet ${i + 1}`))}</span>
                      <span className="text-xs font-bold text-blue-700">{String(pick(w.balance, w.amount, w.money, "—"))}</span>
                    </div>
                  ))}
                </div>
              )}
            </>;
          })()}
        </SectionCard>

        {/* Bank Cards */}
        <SectionCard title="Bank Cards / Payout Accounts" icon="🏦" status={bankCards.status} epName={bankCards.ep}>
          {bankCards.status === "loading" && <EmptyState msg="Loading…" />}
          {bankCards.status === "error" && <EmptyState msg="Endpoint not available" />}
          {bankCards.status === "ok" && (() => {
            const list = extractList(bankCards.data as Record<string,unknown>);
            const d = extractData(bankCards.data as Record<string,unknown>);
            if (list.length === 0) return (
              <>
                <KV label="Card Number"  value={pick(d.cardNumber, d.bankAccount, d.accountNo, d.cardNo)} />
                <KV label="Bank Name"    value={pick(d.bankName, d.bank)} />
                <KV label="Account Name" value={pick(d.accountName, d.holderName, d.realName)} />
                <KV label="IFSC"         value={pick(d.ifscCode, d.ifsc, d.bankCode)} />
                <KV label="UPI ID"       value={pick(d.upiId, d.vpa, d.upiAccount)} />
                {Object.keys(d).length === 0 && <EmptyState msg="No bank cards on file" />}
              </>
            );
            return (
              <div className="space-y-2">
                {list.map((card, i) => (
                  <div key={i} className="bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl p-3 text-white">
                    <div className="text-xs opacity-70 mb-1">{String(pick(card.bankName, card.bank, "Bank Card"))}</div>
                    <div className="font-mono text-sm font-bold">{String(pick(card.cardNumber, card.accountNo, card.bankAccount, card.cardNo, "—"))}</div>
                    <div className="text-xs opacity-80 mt-1">{String(pick(card.accountName, card.holderName, card.realName, ""))}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* Deposits */}
        <SectionCard title="Deposit History" icon="📥" status={deposits.status} epName={deposits.ep}>
          {deposits.status === "loading" && <EmptyState msg="Loading…" />}
          {deposits.status === "error" && <EmptyState msg={deposits.error} />}
          {deposits.status === "ok" && (() => {
            const list = extractList(deposits.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No deposit records" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 8).map((item, i) => {
                  const st = item.state ?? item.status;
                  const ok = st === 1 || st === "1" || String(st).toLowerCase() === "success";
                  const pending = st === 0 || st === "0";
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className={`w-2 h-8 rounded-full shrink-0 ${ok ? "bg-green-400" : pending ? "bg-yellow-400" : "bg-red-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-gray-800">K{String(pick(item.rechargeAmount, item.money, item.amount, "—"))}</div>
                        <div className="text-[10px] text-gray-400 truncate">{String(pick(item.rechargeNumber, item.rechargeSNum, item.orderNo, item.id, ""))}</div>
                        <div className="text-[10px] text-gray-400">{String(pick(item.createTime, item.createdAt, "")).slice(0, 19)}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${ok ? "bg-green-100 text-green-700" : pending ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-500"}`}>
                        {ok ? "Success" : pending ? "Pending" : "Failed"}
                      </span>
                    </div>
                  );
                })}
                {list.length > 8 && <div className="text-xs text-center text-gray-400 pt-1">+{list.length - 8} more</div>}
              </div>
            );
          })()}
        </SectionCard>

        {/* Withdrawals */}
        <SectionCard title="Withdrawal History" icon="📤" status={withdraws.status} epName={withdraws.ep}>
          {withdraws.status === "loading" && <EmptyState msg="Loading…" />}
          {withdraws.status === "error" && <EmptyState msg={withdraws.error} />}
          {withdraws.status === "ok" && (() => {
            const list = extractList(withdraws.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No withdrawal records" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 6).map((item, i) => {
                  const st = item.state ?? item.status;
                  const ok = st === 1 || st === "1";
                  const pending = st === 0 || st === "0";
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className={`w-2 h-8 rounded-full shrink-0 ${ok ? "bg-green-400" : pending ? "bg-yellow-400" : "bg-red-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-gray-800">K{String(pick(item.withdrawAmount, item.money, item.amount, "—"))}</div>
                        <div className="text-[10px] text-gray-400 truncate">{String(pick(item.withdrawNumber, item.orderNo, item.id, ""))}</div>
                        <div className="text-[10px] text-gray-400">{String(pick(item.createTime, item.createdAt, "")).slice(0, 19)}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${ok ? "bg-green-100 text-green-700" : pending ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-500"}`}>
                        {ok ? "Done" : pending ? "Pending" : "Failed"}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </SectionCard>

        {/* Withdrawal Limits */}
        <SectionCard title="Withdrawal Limits & Rules" icon="📊" status={withdrawInfo.status} epName={withdrawInfo.ep}>
          {withdrawInfo.status === "loading" && <EmptyState msg="Loading…" />}
          {withdrawInfo.status === "error" && <EmptyState msg="Endpoint not available" />}
          {withdrawInfo.status === "ok" && (() => {
            const d = extractData(withdrawInfo.data as Record<string,unknown>);
            return <>
              <KV label="Min Withdraw"  value={pick(d.minMoney, d.minWithdraw, d.minAmount, d.min)} />
              <KV label="Max Withdraw"  value={pick(d.maxMoney, d.maxWithdraw, d.maxAmount, d.max)} />
              <KV label="Daily Limit"   value={pick(d.dayLimit, d.dailyLimit, d.dayWithdrawLimit)} />
              <KV label="Fee"           value={pick(d.fee, d.serviceFee, d.handlingFee, d.withdrawFee)} />
              <KV label="Times Today"   value={pick(d.todayTimes, d.dayTimes, d.usedTimes)} />
              <KV label="Remain Times"  value={pick(d.remainTimes, d.leftTimes)} />
            </>;
          })()}
        </SectionCard>

        {/* Payment Methods */}
        <SectionCard title="Payment / Deposit Methods" icon="💳" status={payMethods.status} epName={payMethods.ep}>
          {payMethods.status === "loading" && <EmptyState msg="Loading…" />}
          {payMethods.status === "error" && <EmptyState msg="Endpoint not available" />}
          {payMethods.status === "ok" && (() => {
            const list = extractList(payMethods.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No payment methods returned" />;
            return (
              <div className="space-y-1.5">
                {list.slice(0, 12).map((m, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-base shrink-0">💳</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-800">{String(pick(m.payName, m.typeName, m.name, m.channelName, m.id, `Method ${i + 1}`))}</div>
                      <div className="text-[10px] text-gray-400">
                        Min: {String(pick(m.miniPrice, m.minPrice, m.minMoney, m.min, "—"))}
                        {" · "}Max: {String(pick(m.maxPrice, m.maxMoney, m.max, "—"))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* Bet Records */}
        <SectionCard title="Game / Bet Records" icon="🎮" status={bets.status} epName={bets.ep}>
          {bets.status === "loading" && <EmptyState msg="Loading…" />}
          {bets.status === "error" && <EmptyState msg="Endpoint not available" />}
          {bets.status === "ok" && (() => {
            const list = extractList(bets.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No bet records" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 6).map((item, i) => {
                  const profit = pick(item.profit, item.winAmount, item.winMoney, item.award);
                  const isWin = profit !== undefined && Number(profit) > 0;
                  return (
                    <div key={i} className="bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-bold text-gray-800">{String(pick(item.gameName, item.game, item.gameType, item.typeName, `Record ${i + 1}`))}</span>
                        <span className={`text-xs font-bold ${isWin ? "text-green-600" : "text-red-500"}`}>
                          {isWin ? `+K${String(profit)}` : `-K${String(pick(item.betAmount, item.money, item.amount, "?"))}`}
                        </span>
                      </div>
                      <div className="flex gap-3 text-[10px] text-gray-400">
                        <span>Bet: K{String(pick(item.betAmount, item.money, item.amount, "—"))}</span>
                        <span>· {String(pick(item.createTime, item.betTime, item.orderTime, "")).slice(0, 16)}</span>
                      </div>
                    </div>
                  );
                })}
                {list.length > 6 && <div className="text-xs text-center text-gray-400 pt-1">+{list.length - 6} more bets</div>}
              </div>
            );
          })()}
        </SectionCard>

        {/* Transactions */}
        <SectionCard title="Balance Transaction Records" icon="📋" status={transactions.status} epName={transactions.ep}>
          {transactions.status === "loading" && <EmptyState msg="Loading…" />}
          {transactions.status === "error" && <EmptyState msg="Endpoint not available" />}
          {transactions.status === "ok" && (() => {
            const list = extractList(transactions.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No transaction records" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 8).map((item, i) => {
                  const amount = Number(pick(item.money, item.amount, item.changeAmount, 0));
                  const pos = amount > 0;
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${pos ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"}`}>
                        {pos ? "+" : "−"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-800">{String(pick(item.remark, item.type, item.typeName, item.note, "Transaction"))}</div>
                        <div className="text-[10px] text-gray-400">{String(pick(item.createTime, item.createdAt, "")).slice(0, 16)}</div>
                      </div>
                      <div className={`text-sm font-bold shrink-0 ${pos ? "text-green-600" : "text-red-500"}`}>
                        {pos ? "+" : ""}K{Math.abs(amount).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </SectionCard>

        {/* WinGo */}
        <SectionCard title="WinGo Lottery Results" icon="🎱" status={wingo.status} epName={wingo.ep}>
          {wingo.status === "loading" && <EmptyState msg="Loading…" />}
          {wingo.status === "error" && <EmptyState msg={wingo.error} />}
          {wingo.status === "ok" && (() => {
            const list = extractList(wingo.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No WinGo results" />;
            return (
              <div className="space-y-1.5">
                {list.slice(0, 10).map((r, i) => {
                  const numRaw = String(pick(r.preStopNumber, r.number, r.winNumber, r.openCode, r.result, r.nums, r.lotteryResult, ""));
                  const n = numRaw.charAt(0);
                  const num = isNaN(Number(n)) ? "?" : Number(n);
                  const colorRaw = String(pick(r.colour, r.color, r.winColour, r.winColor, r.winColorName, r.colorName, r.colorInfo, "")).toLowerCase();
                  const isGreen = colorRaw.includes("green") || (typeof num === "number" && num !== 0 && num !== 5 && num % 2 === 1);
                  const isRed = colorRaw.includes("red") || (typeof num === "number" && num !== 0 && num !== 5 && num % 2 === 0);
                  const isViolet = colorRaw.includes("violet") || colorRaw.includes("purple") || num === 0 || num === 5;
                  const bgClass = isViolet ? "bg-violet-500" : isGreen ? "bg-green-500" : isRed ? "bg-red-500" : "bg-gray-400";
                  const period = String(pick(r.issueNumber, r.period, r.issue, r.no, r.periodNum, r.roundId, `#${i + 1}`));
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                      <span className="text-[10px] text-gray-400 w-28 shrink-0 truncate">{period.slice(-10)}</span>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${bgClass}`}>
                        {typeof num === "number" ? num : "?"}
                      </div>
                      <span className={`text-xs font-semibold ${isViolet ? "text-violet-600" : isGreen ? "text-green-600" : "text-red-500"}`}>
                        {isViolet ? "Violet" : isGreen ? "Green" : isRed ? "Red" : colorRaw || "—"}
                      </span>
                      <span className={`text-[10px] ml-auto px-1.5 py-0.5 rounded-full font-medium ${typeof num === "number" && num >= 5 ? "bg-orange-100 text-orange-600" : "bg-blue-50 text-blue-500"}`}>
                        {typeof num === "number" ? (num >= 5 ? "Big" : "Small") : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </SectionCard>

        {/* Invite */}
        <SectionCard title="Invite & Referral" icon="👥" status={invite.status} epName={invite.ep}>
          {invite.status === "loading" && <EmptyState msg="Loading…" />}
          {invite.status === "error" && <EmptyState msg="Endpoint not available" />}
          {invite.status === "ok" && (() => {
            const d = extractData(invite.data as Record<string,unknown>);
            return <>
              <KV label="Invite Code"     value={pick(d.inviteCode, d.invitationCode, d.code, d.shareCode)} />
              <KV label="Invite Link"     value={pick(d.inviteLink, d.inviteUrl, d.link, d.shareLink)} />
              <KV label="Total Invites"   value={pick(d.inviteNum, d.totalInvite, d.count, d.total)} />
              <KV label="Valid Invites"   value={pick(d.validInviteNum, d.validCount, d.validInvite)} />
              <KV label="Commission"      value={pick(d.commission, d.totalCommission, d.rebate)} />
              {Object.keys(d).length === 0 && <EmptyState msg="No invite data" />}
            </>;
          })()}
        </SectionCard>

        {/* Agent */}
        <SectionCard title="Agent / Downline Info" icon="🤝" status={agent.status} epName={agent.ep}>
          {agent.status === "loading" && <EmptyState msg="Loading…" />}
          {agent.status === "error" && <EmptyState msg="Endpoint not available" />}
          {agent.status === "ok" && (() => {
            const d = extractData(agent.data as Record<string,unknown>);
            return <>
              <KV label="Agent Code"      value={pick(d.agentCode, d.agentId, d.code)} />
              <KV label="Total Members"   value={pick(d.totalMember, d.memberCount, d.total, d.count)} />
              <KV label="Active Members"  value={pick(d.activeMember, d.activeCount, d.active)} />
              <KV label="Total Commission" value={pick(d.totalCommission, d.commission)} />
              <KV label="Yesterday"       value={pick(d.yesterdayCommission, d.yesterday)} />
              {Object.keys(d).length === 0 && <EmptyState msg="No agent data" />}
            </>;
          })()}
        </SectionCard>

        {/* Team */}
        <SectionCard title="Team Statistics" icon="📈" status={team.status} epName={team.ep}>
          {team.status === "loading" && <EmptyState msg="Loading…" />}
          {team.status === "error" && <EmptyState msg="Endpoint not available" />}
          {team.status === "ok" && (() => {
            const d = extractData(team.data as Record<string,unknown>);
            return <>
              <KV label="Team Size"       value={pick(d.teamCount, d.totalTeam, d.total, d.count)} />
              <KV label="Direct Members"  value={pick(d.directCount, d.direct, d.level1Count, d.firstCount)} />
              <KV label="Team Deposit"    value={pick(d.teamDeposit, d.totalDeposit, d.rechargeMoney)} />
              <KV label="Team Bet"        value={pick(d.teamBet, d.totalBet, d.betAmount)} />
              <KV label="Commission"      value={pick(d.teamCommission, d.commission)} />
              {Object.keys(d).length === 0 && <EmptyState msg="No team data" />}
            </>;
          })()}
        </SectionCard>

        {/* Rebate */}
        <SectionCard title="Rebate / Cashback" icon="💸" status={rebate.status} epName={rebate.ep}>
          {rebate.status === "loading" && <EmptyState msg="Loading…" />}
          {rebate.status === "error" && <EmptyState msg="Endpoint not available" />}
          {rebate.status === "ok" && (() => {
            const d = extractData(rebate.data as Record<string,unknown>);
            return <>
              <KV label="Rebate Rate"  value={pick(d.rebateRate, d.rate, d.rebate)} />
              <KV label="Total Rebate" value={pick(d.totalRebate, d.totalAmount, d.total)} />
              <KV label="Today"        value={pick(d.todayRebate, d.todayAmount, d.today)} />
              <KV label="Bet Required" value={pick(d.betAmount, d.validBet, d.requireBet)} />
              {Object.keys(d).length === 0 && <EmptyState msg="No rebate data" />}
            </>;
          })()}
        </SectionCard>

        {/* Safe */}
        <SectionCard title="Safe / Savings Vault" icon="🔒" status={safe.status} epName={safe.ep}>
          {safe.status === "loading" && <EmptyState msg="Loading…" />}
          {safe.status === "error" && <EmptyState msg="Endpoint not available" />}
          {safe.status === "ok" && (() => {
            const d = extractData(safe.data as Record<string,unknown>);
            return <>
              <KV label="Safe Balance"  value={pick(d.safeBalance, d.balance, d.amount)} />
              <KV label="Interest Rate" value={pick(d.interestRate, d.rate)} />
              <KV label="Status"        value={pick(d.status, d.state)} />
              <KV label="Daily Interest" value={pick(d.dailyInterest, d.interest)} />
              {Object.keys(d).length === 0 && <EmptyState msg="No safe data" />}
            </>;
          })()}
        </SectionCard>

        {/* Sign-in */}
        <SectionCard title="Daily Sign-in Status" icon="📅" status={signInfo.status} epName={signInfo.ep}>
          {signInfo.status === "loading" && <EmptyState msg="Loading…" />}
          {signInfo.status === "error" && <EmptyState msg="Endpoint not available" />}
          {signInfo.status === "ok" && (() => {
            const d = extractData(signInfo.data as Record<string,unknown>);
            return <>
              <KV label="Consecutive Days" value={pick(d.consecutiveDays, d.signDays, d.days, d.continuousDays)} />
              <KV label="Today Signed"     value={pick(d.isSigned, d.todaySigned, d.isSignIn, d.signStatus, d.status)} />
              <KV label="Today Reward"     value={pick(d.todayReward, d.reward, d.bonus, d.signReward)} />
              <KV label="Total Sign-ins"   value={pick(d.totalSign, d.total, d.totalDays)} />
              {Object.keys(d).length === 0 && <EmptyState msg="No sign-in data" />}
            </>;
          })()}
        </SectionCard>

        {/* Notices */}
        <SectionCard title="System Notices" icon="🔔" status={notices.status} epName={notices.ep}>
          {notices.status === "loading" && <EmptyState msg="Loading…" />}
          {notices.status === "error" && <EmptyState msg="Endpoint not available" />}
          {notices.status === "ok" && (() => {
            const list = extractList(notices.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No notices" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 5).map((item, i) => (
                  <div key={i} className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                    <div className="text-xs font-semibold text-blue-800">{String(pick(item.title, item.noticeTitle, item.subject, `Notice ${i + 1}`))}</div>
                    <div className="text-[10px] text-blue-600 mt-0.5 line-clamp-2">{String(pick(item.content, item.noticeContent, item.body, item.text, ""))}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* Activities */}
        <SectionCard title="Promotions & Activities" icon="🎁" status={activities.status} epName={activities.ep}>
          {activities.status === "loading" && <EmptyState msg="Loading…" />}
          {activities.status === "error" && <EmptyState msg="Endpoint not available" />}
          {activities.status === "ok" && (() => {
            const list = extractList(activities.data as Record<string,unknown>);
            if (!list.length) return <EmptyState msg="No activities" />;
            return (
              <div className="space-y-2">
                {list.slice(0, 6).map((item, i) => (
                  <div key={i} className="bg-gradient-to-r from-orange-50 to-pink-50 border border-orange-100 rounded-xl px-3 py-2">
                    <div className="text-xs font-semibold text-gray-800">{String(pick(item.title, item.activityName, item.name, item.promotionName, item.subject, `Activity ${i + 1}`))}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{String(pick(item.content, item.description, item.desc, item.remark, ""))}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {String(pick(item.startTime, item.beginTime, item.createTime, ""))} – {String(pick(item.endTime, item.expireTime, ""))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionCard>

        {/* Raw API Explorer */}
        <div className="bg-white rounded-2xl shadow-sm mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
            <span className="text-lg">🔬</span>
            <div className="flex-1">
              <span className="font-bold text-gray-800 text-sm">Raw API Explorer</span>
              <span className="text-xs text-gray-400 ml-2">Call any endpoint manually</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="mb-2">
              <div className="text-xs text-gray-500 mb-1">Endpoint Name</div>
              <input value={rawEp} onChange={e => setRawEp(e.target.value)}
                placeholder="e.g. GetUserInfo, GetTeamInfo…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-indigo-400 font-mono" />
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-1">Body (JSON)</div>
              <textarea value={rawBody} onChange={e => setRawBody(e.target.value)} rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs bg-gray-50 focus:outline-none focus:border-indigo-400 font-mono resize-none" />
            </div>
            <div className="flex gap-2 mb-3">
              <button onClick={runRaw} disabled={rawBlock.status === "loading" || !rawEp.trim()}
                className="flex-1 bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-bold py-2.5 rounded-xl">
                {rawBlock.status === "loading" ? "Calling…" : "▶ Call API"}
              </button>
              {rawBlock.data && (
                <button onClick={copyRaw}
                  className="bg-gray-100 text-gray-600 text-sm font-bold px-4 py-2.5 rounded-xl">
                  {copied ? "✓" : "Copy"}
                </button>
              )}
            </div>
            {rawBlock.status === "ok" && rawBlock.data && (
              <div className="bg-gray-900 rounded-xl p-3 max-h-72 overflow-y-auto">
                <pre className="text-xs text-green-400 whitespace-pre-wrap break-all">
                  {JSON.stringify(rawBlock.data, null, 2)}
                </pre>
              </div>
            )}
            {rawBlock.status === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{rawBlock.error}</div>
            )}
            <div className="mt-3">
              <div className="text-xs text-gray-400 mb-2">Quick endpoints:</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "GetUserInfo","GetVipUserLevelDetail","GetAllwallets","GetBankCard",
                  "GetRechargeRecord","GetWithdrawLog","BetRecords","RecordList",
                  "GetInviteInfo","GetAgentInfo","GetTeamInfo","GetSafeInfo",
                  "GetSignInfo","GetNotice","GetActivityList","GetRebateInfo",
                  "GetEmerdList","GetWithdrawInfo","GetRechargeTypes","GetVipList",
                  "GetGameList","GetFriendList","GetMessageList","GetTaskList",
                  "GetSubordinateInfo","GetBonusRecord","GetCommission","GetShareInfo",
                ].map(ep => (
                  <button key={ep} onClick={() => { setRawEp(ep); setRawBody("{}"); }}
                    className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-1 rounded-lg font-mono active:bg-indigo-100">
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
