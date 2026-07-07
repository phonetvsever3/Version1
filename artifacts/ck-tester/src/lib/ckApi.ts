let authToken: string | null = null;

export function setToken(token: string) {
  authToken = token;
  localStorage.setItem("ck_token", token);
}

export function getToken(): string | null {
  if (authToken) return authToken;
  return localStorage.getItem("ck_token");
}

export function clearToken() {
  authToken = null;
  localStorage.removeItem("ck_token");
}

async function proxyPost<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["x-ck-token"] = `Bearer ${token}`;
    headers["x-ck-token-header"] = "Bearer";
  }

  const res = await fetch(`/api/proxy/ck/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data?.error === "cloudflare_blocked") {
    throw new Error("Cloudflare is blocking our server. Try again in a moment.");
  }
  if (data?.error && !data?.code) {
    throw new Error(String(data.message || data.error));
  }

  return data as T;
}

export interface WinGoRecord {
  issueNumber: string;
  number: string;
  colour: string;
  bigSmall: string;
  parity: string;
}

export interface WinGoListResponse {
  code: number;
  msg: string;
  data: {
    list: WinGoRecord[];
    total: number;
    pageNo: number;
    pageSize: number;
  };
}

export interface WinGoCurrentResponse {
  code: number;
  msg: string;
  data: {
    issueNumber: string;
    countDown: number;
    endTime: string;
  };
}

export interface UserInfoResponse {
  code: number;
  msg: string;
  data: {
    money: number;
    userName: string;
    nickName: string;
    avatar?: string;
    integral?: number;
  };
}

export interface BetResponse {
  code: number;
  msg: string;
  data: any;
}

export async function getWinGoList(typeId = 1, pageNo = 1, pageSize = 10): Promise<WinGoListResponse> {
  return proxyPost<WinGoListResponse>("GetEmerdList", { typeId, pageNo, pageSize, language: 0 });
}

export async function getWinGoCurrentIssue(typeId = 1): Promise<WinGoCurrentResponse> {
  const endpoints = ["GetCurrentIssue", "GetGameInfo", "GetGameIssue", "GetCurrentPeriod"];
  let lastErr = "";
  for (const ep of endpoints) {
    try {
      const res = await proxyPost<WinGoCurrentResponse>(ep, { typeId });
      if (res?.data?.issueNumber || res?.data?.countDown !== undefined) {
        return res;
      }
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }
  throw new Error(lastErr || "Could not fetch current issue");
}

export async function getUserInfo(): Promise<UserInfoResponse> {
  return proxyPost<UserInfoResponse>("GetUserInfo", {});
}

export async function placeBet(params: {
  typeId: number;
  issueNumber: string;
  betAmount: number;
  betType: string;
  betKey: string;
  multiple: number;
}): Promise<BetResponse> {
  const betData: Record<string, unknown> = {
    typeId: params.typeId,
    issueNumber: params.issueNumber,
    money: params.betAmount,
    betAmount: params.betAmount,
    multiple: params.multiple,
    betKey: params.betKey,
    betType: params.betType,
  };
  const endpoints = ["BettingWingo", "Betting", "WinGoBetting", "BetWingo"];
  for (const ep of endpoints) {
    try {
      const res = await proxyPost<BetResponse>(ep, betData);
      if (res?.code === 0 || res?.code === 200 || res?.msg) return res;
    } catch {}
  }
  return proxyPost<BetResponse>("BettingWingo", betData);
}

export async function getMyBetHistory(typeId = 1, pageNo = 1, pageSize = 10) {
  const endpoints = ["BetRecords", "GetBettingRecord", "GetUserBettingHistory", "WingoBetRecord", "MyBetList"];
  for (const ep of endpoints) {
    try {
      const res = await proxyPost<any>(ep, { typeId, pageNo, pageSize });
      if (res?.data?.list || res?.data?.records || res?.data?.betRecords) return res;
    } catch {}
  }
  return { code: 0, data: { list: [], total: 0 } };
}
