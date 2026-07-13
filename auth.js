/* Auth for the Business Status Dashboard
 *
 * SMS one-time-code login gated to the numbers in authorized_users.json.
 *
 * Two operating modes:
 *
 *   1. PROD    — set window.AUTH_ENDPOINT (or the meta tag below) to the
 *                base URL of the deployed backend. Client POSTs to
 *                {endpoint}/otp/send and {endpoint}/otp/verify. Backend
 *                (Cloudflare Worker or Vercel serverless in ./server/)
 *                generates + stores the code and calls Twilio to send
 *                the SMS. Client never sees the code.
 *
 *   2. DEMO    — no endpoint configured. The client generates the code
 *                locally and shows it in the browser console + a fallback
 *                prompt. USE FOR LOCAL DEV ONLY — anyone can bypass this
 *                by opening devtools. The real security boundary is the
 *                server-side code check in PROD mode.
 *
 * Session and last-known user survive in localStorage.
 */
(function () {
  "use strict";

  const SESSION_KEY = "biz-dashboard-session-v1";
  const OTP_DEMO_KEY = "biz-dashboard-otp-demo-v1";
  const ROSTER_URL = "authorized_users.json";

  // ---------- Endpoint resolution ----------
  function endpoint() {
    if (typeof window.AUTH_ENDPOINT === "string") return window.AUTH_ENDPOINT;
    const meta = document.querySelector('meta[name="auth-endpoint"]');
    if (meta && meta.content) return meta.content;
    return null;
  }

  // ---------- Phone normalization ----------
  // Accepts 214-471-1386, (214) 471-1386, +12144711386, 12144711386, etc.
  // Returns E.164 with + prefix (assumes US when the number is 10 digits).
  function normalize(phone) {
    if (!phone) return "";
    const digits = String(phone).replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.length === 10) return "+1" + digits;
    if (digits.length === 11 && digits[0] === "1") return "+" + digits;
    return "+" + digits;
  }

  function prettyPhone(e164) {
    const d = (e164 || "").replace(/[^\d]/g, "");
    if (d.length === 11 && d[0] === "1")
      return "+1 " + d.slice(1, 4) + "-" + d.slice(4, 7) + "-" + d.slice(7);
    return e164 || "";
  }

  // ---------- Roster ----------
  let rosterCache = null;
  async function loadRoster() {
    if (rosterCache) return rosterCache;
    try {
      const res = await fetch(ROSTER_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("Roster " + res.status);
      const data = await res.json();
      (data.users || []).forEach((u) => { u.phone = normalize(u.phone); });
      rosterCache = data;
      return data;
    } catch (e) {
      console.warn("Failed to load authorized_users.json — falling back to empty roster", e);
      rosterCache = { users: [], session_ttl_hours: 12, otp_ttl_minutes: 10 };
      return rosterCache;
    }
  }
  function findUser(roster, phone) {
    const p = normalize(phone);
    return (roster.users || []).find((u) => u.phone === p) || null;
  }

  // ---------- Session ----------
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.expiresAt || s.expiresAt < Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch { return null; }
  }
  function saveSession(user, ttlHours, token) {
    const s = {
      phone: user.phone,
      name: user.name,
      greeting: user.greeting || user.name,
      role: user.role || "user",
      token: token || null,
      loggedInAt: Date.now(),
      expiresAt: Date.now() + (ttlHours || 12) * 3600 * 1000,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }
  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(OTP_DEMO_KEY);
  }

  // ---------- OTP: demo mode ----------
  function demoSendOtp(phone, ttlMinutes) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const rec = {
      phone: normalize(phone),
      code,
      expiresAt: Date.now() + (ttlMinutes || 10) * 60 * 1000,
    };
    localStorage.setItem(OTP_DEMO_KEY, JSON.stringify(rec));
    console.info("%c[DEMO OTP] %c" + code + " %c(only shown when no AUTH_ENDPOINT is configured)",
      "color:#4f8cff;font-weight:600", "font-weight:700;font-size:14px", "color:#8a97ab");
    return { ok: true, demo: true, code, phone: rec.phone };
  }
  function demoVerifyOtp(phone, code) {
    try {
      const rec = JSON.parse(localStorage.getItem(OTP_DEMO_KEY) || "null");
      if (!rec) return { ok: false, error: "No code was requested" };
      if (rec.expiresAt < Date.now()) return { ok: false, error: "Code expired — request a new one" };
      if (normalize(phone) !== rec.phone) return { ok: false, error: "Phone does not match" };
      if (String(code) !== String(rec.code)) return { ok: false, error: "Wrong code" };
      localStorage.removeItem(OTP_DEMO_KEY);
      return { ok: true, demo: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  // ---------- OTP: prod mode (HTTP) ----------
  async function prodSendOtp(base, phone) {
    const res = await fetch(base.replace(/\/$/, "") + "/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: normalize(phone) }),
    });
    if (!res.ok) return { ok: false, error: "Send failed: HTTP " + res.status };
    const data = await res.json().catch(() => ({}));
    return { ok: !!data.ok, ...data };
  }
  async function prodVerifyOtp(base, phone, code) {
    const res = await fetch(base.replace(/\/$/, "") + "/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: normalize(phone), code: String(code) }),
    });
    if (!res.ok) return { ok: false, error: "Verify failed: HTTP " + res.status };
    return res.json();
  }

  // ---------- Public flow ----------
  async function sendCode(phone) {
    const roster = await loadRoster();
    const user = findUser(roster, phone);
    if (!user) return { ok: false, error: "Phone is not on the authorized list" };
    const base = endpoint();
    if (base) {
      const r = await prodSendOtp(base, user.phone);
      return Object.assign({ user }, r);
    }
    const r = demoSendOtp(user.phone, roster.otp_ttl_minutes);
    return Object.assign({ user }, r);
  }

  async function verifyCode(phone, code) {
    const roster = await loadRoster();
    const user = findUser(roster, phone);
    if (!user) return { ok: false, error: "Phone is not on the authorized list" };
    const base = endpoint();
    let result;
    if (base) result = await prodVerifyOtp(base, user.phone, code);
    else      result = demoVerifyOtp(user.phone, code);
    if (!result.ok) return result;
    const session = saveSession(user, roster.session_ttl_hours, result.token || null);
    return { ok: true, session, user };
  }

  window.BizAuth = {
    normalize,
    prettyPhone,
    loadRoster,
    findUser,
    sendCode,
    verifyCode,
    session: loadSession,
    logout,
    endpoint,
  };
})();
