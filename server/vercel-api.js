/* Business Dashboard — SMS OTP backend (Vercel serverless)
 *
 * Deploy this file as three functions in api/:
 *   api/otp/send.js    → module.exports = handleSend
 *   api/otp/verify.js  → module.exports = handleVerify
 *   api/callback.js    → module.exports = handleCallback
 *
 * Backing store: Vercel KV (@vercel/kv) — install with `npm i @vercel/kv`.
 *
 * Env vars (Vercel project settings):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN     (encrypted)
 *   TWILIO_FROM
 *   SESSION_SECRET        (encrypted)
 *   ALLOWED_ORIGIN        (e.g. https://your-dashboard.vercel.app)
 *   CALLBACK_URL          (e.g. https://your-dashboard.vercel.app/api/callback)
 */

// eslint-disable-next-line no-unused-vars
const { kv } = require("@vercel/kv");
const crypto = require("node:crypto");

const AUTHORIZED_USERS = [
  { name: "Admin Fee", phone: "+12144711386", role: "admin", greeting: "Admin Fee" },
  { name: "Lab",       phone: "+19043769615", role: "user",  greeting: "Lab" },
];

const OTP_TTL_SECONDS     = 10 * 60;
const OTP_MAX_ATTEMPTS    = 5;
const SEND_COOLDOWN_SECS  = 30;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}
function json(res, data, status = 200) {
  cors(res);
  res.status(status).setHeader("content-type", "application/json").send(JSON.stringify(data));
}
function normalize(phone) {
  const d = String(phone || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return "+" + d;
}
function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
function hmac(secret, message) {
  return crypto.createHmac("sha256", secret).update(message).digest("base64url");
}

async function sendSms(to, body) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from, CALLBACK_URL } = process.env;
  if (!sid || !token || !from) return { ok: false, detail: "twilio env not configured" };
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  if (CALLBACK_URL) params.set("StatusCallback", CALLBACK_URL);
  const auth = "Basic " + Buffer.from(sid + ":" + token).toString("base64");
  const res = await fetch(
    "https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json",
    {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );
  if (!res.ok) return { ok: false, detail: "twilio " + res.status + " " + (await res.text()).slice(0, 300) };
  return { ok: true };
}

async function handleSend(req, res) {
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  if (req.method !== "POST") return json(res, { ok: false, error: "method not allowed" }, 405);
  const phone = normalize(req.body && req.body.phone);
  const user = AUTHORIZED_USERS.find((u) => u.phone === phone);
  if (!user) return json(res, { ok: false, error: "not authorized" }, 403);

  if (await kv.get("cooldown:" + phone))
    return json(res, { ok: false, error: "cooldown active" }, 429);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const record = {
    codeHash: sha256(code + ":" + (process.env.SESSION_SECRET || "")),
    attempts: 0,
    issuedAt: Date.now(),
  };
  await kv.set("otp:" + phone, JSON.stringify(record), { ex: OTP_TTL_SECONDS });
  await kv.set("cooldown:" + phone, "1", { ex: SEND_COOLDOWN_SECS });

  const message =
    "Your business dashboard code is " + code +
    ". It expires in " + Math.round(OTP_TTL_SECONDS / 60) + " minutes.";
  const sms = await sendSms(phone, message);
  if (!sms.ok) return json(res, { ok: false, error: "sms send failed", detail: sms.detail }, 502);
  return json(res, { ok: true, expiresIn: OTP_TTL_SECONDS, provider: "twilio" });
}

async function handleVerify(req, res) {
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  if (req.method !== "POST") return json(res, { ok: false, error: "method not allowed" }, 405);
  const phone = normalize(req.body && req.body.phone);
  const code = String(req.body && req.body.code || "");
  const user = AUTHORIZED_USERS.find((u) => u.phone === phone);
  if (!user) return json(res, { ok: false, error: "not authorized" }, 403);

  const raw = await kv.get("otp:" + phone);
  if (!raw) return json(res, { ok: false, error: "no code requested or expired" }, 400);
  const record = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await kv.del("otp:" + phone);
    return json(res, { ok: false, error: "too many attempts" }, 429);
  }
  const codeHash = sha256(code + ":" + (process.env.SESSION_SECRET || ""));
  if (codeHash !== record.codeHash) {
    record.attempts += 1;
    await kv.set("otp:" + phone, JSON.stringify(record), { ex: OTP_TTL_SECONDS });
    return json(res, { ok: false, error: "wrong code" }, 401);
  }
  await kv.del("otp:" + phone);
  const payload = {
    phone: user.phone, name: user.name, role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmac(process.env.SESSION_SECRET || "insecure-dev-secret", body64);
  const token = body64 + "." + sig;
  return json(res, { ok: true, token, name: user.name, greeting: user.greeting, role: user.role, expiresIn: SESSION_TTL_SECONDS });
}

async function handleCallback(req, res) {
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  if (req.method !== "POST") return json(res, { ok: false, error: "method not allowed" }, 405);
  // Twilio posts application/x-www-form-urlencoded. Vercel parses it into
  // req.body when Content-Type header is set.
  const b = req.body || {};
  await kv.set(
    "callback:" + (b.MessageSid || crypto.randomUUID()),
    JSON.stringify({ status: b.MessageStatus, to: b.To, errorCode: b.ErrorCode, at: Date.now() }),
    { ex: 24 * 60 * 60 }
  );
  return json(res, { ok: true });
}

module.exports = { handleSend, handleVerify, handleCallback };
