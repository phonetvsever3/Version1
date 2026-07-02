import { useState } from "react";
import type { UserSession } from "../App";

const CONSOLE_CMDS = [
  { label: "token", cmd: `localStorage.getItem('token')` },
  { label: "tokenHeader", cmd: `localStorage.getItem('tokenHeader')` },
];

function HowToGuide() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  }

  return (
    <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm">
          <span>📖</span> How to get your Token (step by step)
        </div>
        <span className="text-blue-400 text-lg">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm">
          {/* Step 1 */}
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0">1</div>
            <div>
              <div className="font-semibold text-gray-800">Open cklottery.club and log in</div>
              <div className="text-gray-500 text-xs mt-0.5">Use your normal phone/email and password to log in on the website.</div>
              <a href="https://cklottery.club" target="_blank" rel="noreferrer"
                className="inline-block mt-1 text-xs text-blue-600 underline">
                → Open cklottery.club
              </a>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
            <div>
              <div className="font-semibold text-gray-800">Open the browser console</div>
              <div className="text-gray-500 text-xs mt-1 leading-relaxed">
                <strong>Android Chrome/Brave:</strong> tap the address bar, type <code className="bg-white px-1 rounded border border-gray-200">chrome://inspect</code> — or shake to open DevTools if enabled.<br />
                <strong>Desktop:</strong> press <code className="bg-white px-1 rounded border border-gray-200">F12</code> → Console tab.
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0">3</div>
            <div className="flex-1">
              <div className="font-semibold text-gray-800">Run these commands one by one</div>
              <div className="text-gray-500 text-xs mt-0.5 mb-2">Tap Copy, paste into console, press Enter, copy the result.</div>
              {CONSOLE_CMDS.map((c) => (
                <div key={c.label} className="mb-2 bg-white border border-gray-200 rounded-xl p-2.5">
                  <div className="text-xs text-gray-400 mb-1">For <strong>{c.label}</strong>:</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[11px] text-gray-800 break-all">{c.cmd}</code>
                    <button type="button" onClick={() => copy(c.cmd, c.label)}
                      className="shrink-0 bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-lg font-medium active:opacity-70">
                      {copied === c.label ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0">4</div>
            <div>
              <div className="font-semibold text-gray-800">Paste the results above ↑</div>
              <div className="text-gray-500 text-xs mt-0.5">
                Paste the <strong>token</strong> value in the big box and <strong>tokenHeader</strong> in the small box, then tap <em>View Profile Stats</em>.
              </div>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-xs text-yellow-800">
            ⚠️ The token expires after a few hours. If you see "Token Expired", repeat steps 1–4 to get a fresh one.
          </div>
        </div>
      )}
    </div>
  );
}

const CK_API = "https://ckygjf6r.com/api/webapi";

const COUNTRY_CODES = [
  { code: "+95", label: "MM +95" },
  { code: "+1", label: "US +1" },
  { code: "+91", label: "IN +91" },
  { code: "+60", label: "MY +60" },
  { code: "+66", label: "TH +66" },
  { code: "+62", label: "ID +62" },
  { code: "+63", label: "PH +63" },
  { code: "+84", label: "VN +84" },
];

interface LoginPageProps {
  onLogin: (session: UserSession, userInfo: Record<string, unknown>) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "token">("login");
  const [tab, setTab] = useState<"phone" | "email">("phone");
  const [countryCode, setCountryCode] = useState("+95");
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [manualToken, setManualToken] = useState("");
  const [manualTokenHeader, setManualTokenHeader] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const payload =
        tab === "phone"
          ? { number, numberType: 1, password, loginType: 1 }
          : { number: email, numberType: 2, password, loginType: 1 };

      let data: Record<string, unknown>;
      try {
        const res = await fetch(`${CK_API}/Login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
          },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        data = JSON.parse(text);
      } catch {
        setError(
          "Could not reach the API. Cloudflare may be blocking cross-origin requests. Use 'Paste Token' below to log in with your existing session."
        );
        setLoading(false);
        return;
      }

      if ((data.code as number) !== 0) {
        setError(
          (data.msg as string) ||
            (data.message as string) ||
            "Login failed. Check your credentials."
        );
        setLoading(false);
        return;
      }

      const d = data.data as Record<string, unknown>;
      const { token, tokenHeader, refreshToken } = d || {};
      const session: UserSession = {
        token: token as string,
        tokenHeader: tokenHeader as string,
        refreshToken: refreshToken as string,
      };

      let infoData: Record<string, unknown> = {};
      try {
        const infoRes = await fetch(`${CK_API}/GetUserInfo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(token ? { Authorization: token as string } : {}),
            ...(tokenHeader ? { "token-header": tokenHeader as string } : {}),
          },
          body: JSON.stringify({}),
        });
        const infoJson = await infoRes.json();
        infoData = infoJson?.data || infoJson;
      } catch {
        infoData = {};
      }

      onLogin(session, infoData);
    } catch {
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTokenLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!manualToken.trim()) {
      setError("Please paste your token.");
      return;
    }
    setLoading(true);
    const session: UserSession = {
      token: manualToken.trim(),
      tokenHeader: manualTokenHeader.trim(),
      refreshToken: "",
    };
    let infoData: Record<string, unknown> = {};
    try {
      const infoRes = await fetch(`${CK_API}/GetUserInfo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(manualToken ? { Authorization: manualToken.trim() } : {}),
          ...(manualTokenHeader ? { "token-header": manualTokenHeader.trim() } : {}),
        },
        body: JSON.stringify({}),
      });
      const text = await infoRes.text();
      const infoJson = JSON.parse(text);
      infoData = infoJson?.data || infoJson;
    } catch {
      setError(
        "Could not fetch profile data. Cloudflare may be blocking requests. Check that your token is correct."
      );
      setLoading(false);
      return;
    }
    onLogin(session, infoData);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 pt-10 pb-10">
        <div className="flex items-center justify-between mb-6">
          <button className="text-white text-lg">←</button>
          <span className="text-white font-bold text-xl tracking-wide">CKLOTTERY</span>
          <div className="flex items-center gap-1 text-white text-sm">
            <span>🇺🇸</span> <span>EN</span>
          </div>
        </div>
        <h1 className="text-white text-2xl font-bold">Log in</h1>
        <p className="text-blue-100 text-sm mt-1">
          Please log in with your phone number or email
        </p>
        <p className="text-blue-100 text-sm">
          If you forget your password, please contact customer service
        </p>
      </div>

      <div className="bg-white mx-4 -mt-4 rounded-2xl shadow-lg px-5 py-5 flex-1">
        <div className="flex rounded-xl border border-gray-200 mb-5 overflow-hidden">
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mode === "login"
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-500"
            }`}
            onClick={() => { setMode("login"); setError(""); }}
          >
            Login
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mode === "token"
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-500"
            }`}
            onClick={() => { setMode("token"); setError(""); }}
          >
            Paste Token
          </button>
        </div>

        {mode === "login" ? (
          <>
            <div className="flex border-b border-gray-200 mb-5">
              <button
                className={`flex-1 pb-3 text-sm font-medium flex flex-col items-center gap-1 transition-colors ${
                  tab === "phone"
                    ? "text-blue-500 border-b-2 border-blue-500"
                    : "text-gray-400"
                }`}
                onClick={() => setTab("phone")}
              >
                <span className="text-xl">📱</span>
                phone number
              </button>
              <button
                className={`flex-1 pb-3 text-sm font-medium flex flex-col items-center gap-1 transition-colors ${
                  tab === "email"
                    ? "text-blue-500 border-b-2 border-blue-500"
                    : "text-gray-400"
                }`}
                onClick={() => setTab("email")}
              >
                <span className="text-xl">✉️</span>
                Email Login
              </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {tab === "phone" ? (
                <div>
                  <div className="flex items-center gap-1 text-blue-500 text-sm font-medium mb-2">
                    <span>📱</span> Phone number
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="border border-gray-200 rounded-xl px-3 py-3 text-sm bg-white text-gray-700 focus:outline-none focus:border-blue-400 w-28"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      placeholder="Enter phone number"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400"
                      required
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-1 text-blue-500 text-sm font-medium mb-2">
                    <span>✉️</span> Email
                  </div>
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400"
                    required
                  />
                </div>
              )}

              <div>
                <div className="flex items-center gap-1 text-blue-500 text-sm font-medium mb-2">
                  <span>🔒</span> Password
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 pr-12"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg"
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 accent-blue-500"
                />
                Remember password
              </label>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-4 rounded-full text-base shadow-md hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {loading ? "Logging in..." : "Log in"}
              </button>
            </form>
          </>
        ) : (
          <form onSubmit={handleTokenLogin} className="space-y-4">
            <p className="text-sm text-gray-500">
              Log in to <strong>cklottery.club</strong> in your browser, run two console commands, then paste the results below.
            </p>
            <HowToGuide />
            <div>
              <label className="block text-blue-500 text-sm font-medium mb-2">
                🔑 Token (from localStorage key <code className="bg-gray-100 px-1 rounded">token</code>)
              </label>
              <textarea
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Paste your token here..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-blue-400 h-24 resize-none font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-blue-500 text-sm font-medium mb-2">
                🪙 Token Header (localStorage key <code className="bg-gray-100 px-1 rounded">tokenHeader</code>)
              </label>
              <input
                type="text"
                value={manualTokenHeader}
                onChange={(e) => setManualTokenHeader(e.target.value)}
                placeholder="Paste tokenHeader value..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 font-mono"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-4 rounded-full text-base shadow-md hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {loading ? "Loading Profile..." : "View Profile Stats"}
            </button>
          </form>
        )}
      </div>

      <div className="flex justify-center mt-6 mb-8">
        <div className="flex flex-col items-center gap-1 text-gray-500 text-xs">
          <span className="text-3xl">🎧</span>
          Customer Service
        </div>
      </div>
    </div>
  );
}
