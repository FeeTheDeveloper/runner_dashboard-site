/* Business Dashboard — SMS OTP backend (Cloudflare Worker)
 *
 * Endpoints
 *   POST /otp/send    { phone }              → { ok, expiresIn }
 *   POST /otp/verify  { phone, code }        → { ok, token, name, greeting, role }
 *   POST /callback    Twilio delivery status webhook
 *   GET  /health                             → { ok, ts }
 *
 * Bindings expected in wrangler.toml:
 *   [[kv_namespaces]]
 *   binding = "OTP_KV"
 *   id = "<created via `wrangler kv:namespace create OTP_KV`>"
 *
 *   [vars]
 *   TWILIO_ACCOUNT_SID = "AC..."
 *   TWILIO_FROM        = "+15551234567"
 *   ALLOWED_ORIGIN     = "https://your-dashboard.example"
 *   SESSION_SECRET     = "long-random-string"
 *
 *   # Store the Twilio auth token as a secret, NOT in vars:
 *   #   wrangler secret put TWILIO_AUTH_TOKEN
 *
 * Roster ships in the repo; edit AUTHORIZED_USERS below to match
 * authorized_users.json (kept static here so the Worker never talks to
 * GitHub).
 */

const AUTHORIZED_USERS = [
  { name: "Admin Fee", phone: "+12144711386", role: "admin", greeting: "Admin Fee" },
  { name: "Lab",       phone: "+19043769615", role: "user",  greeting: "Lab" },
];

const OTP_TTL_SECONDS     = 10 * 60;      // 10 minutes
const OTP_MAX_ATTEMPTS    = 5;
const SEND_COOLDOWN_SECS  = 30;
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/health")
        return json({ ok: true, ts: Date.now() }, 200, cors);

      if (url.pathname === "/otp/send" && request.method === "POST")
        return await handleSend(await request.json(), env, cors);

      if (url.pathname === "/otp/verify" && request.method === "POST")
        return await handleVerify(await request.json(), env, cors);

      if (url.pathname === "/callback" && request.method === "POST")
        return await handleCallback(request, env, cors);

      return json({ ok: false, error: "not found" }, 404, cors);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 500, cors);
    }
  },
};

// ---------- Handlers ----------

async function handleSend(body, env, cors) {
  const phone = normalize(body && body.phone);
  const user = AUTHORIZED_USERS.find((u) => u.phone === phone);
  if (!user) return json({ ok: false, error: "not authorized" }, 403, cors);

  const cooldownKey = "cooldown:" + phone;
  if (await env.OTP_KV.get(cooldownKey))
    return json({ ok: false, error: "cooldown active" }, 429, cors);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256(code + ":" + (env.SESSION_SECRET || ""));
  const record = { phoneHash: await sha256(phone), codeHash, attempts: 0, issuedAt: Date.now() };
  await env.OTP_KV.put("otp:" + phone, JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS });
  await env.OTP_KV.put(cooldownKey, "1", { expirationTtl: SEND_COOLDOWN_SECS });

  const message =
    "Your business dashboard code is " + code +
    ". It expires in " + Math.round(OTP_TTL_SECONDS / 60) + " minutes.";
  const twilioRes = await sendSms(env, phone, message);
  if (!twilioRes.ok) {
    return json({ ok: false, error: "sms send failed", detail: twilioRes.detail }, 502, cors);
  }
  return json({ ok: true, expiresIn: OTP_TTL_SECONDS, provider: "twilio" }, 200, cors);
}

async function handleVerify(body, env, cors) {
  const phone = normalize(body && body.phone);
  const code = String(body && body.code || "");
  const user = AUTHORIZED_USERS.find((u) => u.phone === phone);
  if (!user) return json({ ok: false, error: "not authorized" }, 403, cors);

  const raw = await env.OTP_KV.get("otp:" + phone);
  if (!raw) return json({ ok: false, error: "no code requested or expired" }, 400, cors);
  const record = JSON.parse(raw);
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await env.OTP_KV.delete("otp:" + phone);
    return json({ ok: false, error: "too many attempts" }, 429, cors);
  }
  const codeHash = await sha256(code + ":" + (env.SESSION_SECRET || ""));
  if (codeHash !== record.codeHash) {
    record.attempts += 1;
    await env.OTP_KV.put("otp:" + phone, JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS });
    return json({ ok: false, error: "wrong code" }, 401, cors);
  }
  await env.OTP_KV.delete("otp:" + phone);
  const token = await mintSessionToken(env, user);
  return json({
    ok: true,
    token,
    name: user.name,
    greeting: user.greeting,
    role: user.role,
    expiresIn: SESSION_TTL_SECONDS,
  }, 200, cors);
}

// Twilio calls this after each SMS attempt. Log status; a real deploy
// would push to a store you actually watch.
async function handleCallback(request, env, cors) {
  const form = await request.formData();
  const status = form.get("MessageStatus");
  const to = form.get("To");
  const sid = form.get("MessageSid");
  const errorCode = form.get("ErrorCode");
  await env.OTP_KV.put(
    "callback:" + sid,
    JSON.stringify({ status, to, errorCode, at: Date.now() }),
    { expirationTtl: 24 * 60 * 60 }
  );
  return json({ ok: true }, 200, cors);
}

// ---------- Twilio ----------
async function sendSms(env, to, body) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM;
  if (!sid || !token || !from) return { ok: false, detail: "twilio env not configured" };

  const params = new URLSearchParams({ To: to, From: from, Body: body });
  // Callback URL — set to <worker-url>/callback
  if (env.CALLBACK_URL) params.set("StatusCallback", env.CALLBACK_URL);

  const authHeader = "Basic " + btoa(sid + ":" + token);
  const res = await fetch(
    "https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json",
    {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );
  if (!res.ok) {
    return { ok: false, detail: "twilio " + res.status + " " + (await res.text()).slice(0, 300) };
  }
  return { ok: true };
}

// ---------- Session token ----------
// HMAC-signed compact token. Good enough for a two-user dashboard.
// For anything larger, switch to a signed JWT library.
async function mintSessionToken(env, user) {
  const payload = {
    phone: user.phone, name: user.name, role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  const sig = await hmac(env.SESSION_SECRET || "insecure-dev-secret", body);
  return body + "." + sig;
}

// ---------- Helpers ----------
function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}
function normalize(phone) {
  if (!phone) return "";
  const d = String(phone).replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return "+" + d;
}
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64url(new Uint8Array(sig));
}
function base64url(input) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  let str = "";
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
