import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import { decodeJwt, jwtToUserInfo } from "./utils/jwt";

export interface UserSession {
  token: string;
  tokenHeader: string;
  refreshToken: string;
  cfClearance?: string;
}

export default function App() {
  const [session, setSession] = useState<UserSession | null>(() => {
    const stored = sessionStorage.getItem("ck_session");
    return stored ? JSON.parse(stored) : null;
  });
  const [userInfo, setUserInfo] = useState<Record<string, unknown> | null>(() => {
    const stored = sessionStorage.getItem("ck_userinfo");
    return stored ? JSON.parse(stored) : null;
  });

  function handleLogin(s: UserSession, apiInfo: Record<string, unknown>) {
    const claims = decodeJwt(s.token);
    const jwtInfo = claims ? jwtToUserInfo(claims) : {};
    const merged = Object.keys(apiInfo).length > 0
      ? { ...jwtInfo, ...apiInfo, _jwtClaims: claims }
      : { ...jwtInfo, _jwtClaims: claims };

    sessionStorage.setItem("ck_session", JSON.stringify(s));
    sessionStorage.setItem("ck_userinfo", JSON.stringify(merged));
    setSession(s);
    setUserInfo(merged);
  }

  function handleUpdateSession(updates: Partial<UserSession>) {
    if (!session) return;
    const updated = { ...session, ...updates };
    sessionStorage.setItem("ck_session", JSON.stringify(updated));
    setSession(updated);
  }

  function handleLogout() {
    sessionStorage.removeItem("ck_session");
    sessionStorage.removeItem("ck_userinfo");
    setSession(null);
    setUserInfo(null);
  }

  if (session) {
    return (
      <ProfilePage
        session={session}
        initialUserInfo={userInfo}
        onLogout={handleLogout}
        onUpdateSession={handleUpdateSession}
      />
    );
  }

  return <LoginPage onLogin={handleLogin} />;
}
