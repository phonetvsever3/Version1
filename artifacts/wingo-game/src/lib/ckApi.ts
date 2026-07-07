const BASE_URL = "https://www.cklottery.club";

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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
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
  };
}

export interface BetResponse {
  code: number;
  msg: string;
  data: any;
}

export async function getWinGoList(typeId = 1, pageNo = 1, pageSize = 10): Promise<WinGoListResponse> {
  return request<WinGoListResponse>("/api/WinGo/GetEmerdList", {
    method: "POST",
    body: JSON.stringify({ typeId, language: 0, pagNo: pageNo, pageSize }),
  });
}

export async function getWinGoCurrentIssue(typeId = 1): Promise<WinGoCurrentResponse> {
  return request<WinGoCurrentResponse>("/api/WinGo/GetCurrentIssue", {
    method: "POST",
    body: JSON.stringify({ typeId }),
  });
}

export async function getUserInfo(): Promise<UserInfoResponse> {
  return request<UserInfoResponse>("/api/Member/GetMemberInfo", {
    method: "GET",
  });
}

export async function placeBet(params: {
  typeId: number;
  issueNumber: string;
  betAmount: number;
  betType: string;
  betKey: string;
  multiple: number;
}): Promise<BetResponse> {
  return request<BetResponse>("/api/WinGo/Betting", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getMyBetHistory(typeId = 1, pageNo = 1, pageSize = 10) {
  return request("/api/WinGo/GetBetRecord", {
    method: "POST",
    body: JSON.stringify({ typeId, pagNo: pageNo, pageSize }),
  });
}
