export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function jwtToUserInfo(claims: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: claims["UserId"],
    userName: claims["UserName"],
    nickName: claims["NickName"],
    userPhoto: claims["UserPhoto"],
    amount: claims["Amount"],
    integral: claims["Integral"],
    loginTime: claims["LoginTime"],
    loginIp: claims["LoginIPAddress"],
    loginMark: claims["LoginMark"],
    keyCode: claims["KeyCode"],
    tokenType: claims["TokenType"],
    phoneType: claims["PhoneType"],
    userType: claims["UserType"],
    dbNumber: claims["DbNumber"],
    isvalidator: claims["Isvalidator"],
    expiration: claims["http://schemas.microsoft.com/ws/2008/06/identity/claims/expiration"],
    _source: "jwt",
  };
}
