/* Worker backend: session auth, user profiles, and dashboard state sync.
 * Static assets are served by the assets binding; everything under /api/* lands here.
 */

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100000;
const MAX_STATE_BYTES = 512 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, url, env);
      } catch (err) {
        console.error(err);
        return json({ error: "Internal error" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, url, env) {
  const route = request.method + " " + url.pathname;
  switch (route) {
    case "POST /api/register": return register(request, env);
    case "POST /api/login":    return login(request, env);
    case "POST /api/logout":   return logout(request, env);
    case "GET /api/me":        return me(request, env);
    case "PUT /api/profile":   return updateProfile(request, env);
    case "GET /api/state":     return getState(request, env);
    case "PUT /api/state":     return putState(request, env);
    default: return json({ error: "Not found" }, 404);
  }
}

// ---------- helpers ----------

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_STATE_BYTES) throw new RangeError("Payload too large");
  try { return JSON.parse(text); } catch { return null; }
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return hex(a.buffer);
}

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function hashPassword(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

async function currentUser(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.created_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return row;
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, now + SESSION_TTL_MS).run();
  return token;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at };
}

// ---------- routes ----------

async function register(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim().slice(0, 120);
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return json({ error: "An account with this email already exists" }, 409);

  const now = Date.now();
  const id = "u-" + randomHex(12);
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, email, name, passwordHash, salt, now, now).run();

  const token = await createSession(env, id);
  return json({ user: { id, email, name, createdAt: now } }, 201,
    { "set-cookie": sessionCookie(token, SESSION_TTL_MS / 1000) });
}

async function login(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const row = await env.DB.prepare(
    "SELECT id, email, name, password_hash, password_salt, created_at FROM users WHERE email = ?")
    .bind(email).first();
  // Hash even when the user is unknown so both paths take similar time.
  const attempted = await hashPassword(password, row ? row.password_salt : randomHex(16));
  if (!row || !timingSafeEqual(attempted, row.password_hash)) {
    return json({ error: "Invalid email or password" }, 401);
  }
  const token = await createSession(env, row.id);
  return json({ user: publicUser(row) }, 200,
    { "set-cookie": sessionCookie(token, SESSION_TTL_MS / 1000) });
}

async function logout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function me(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Not signed in" }, 401);
  return json({ user: publicUser(user) });
}

async function updateProfile(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Not signed in" }, 401);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);

  const name = String(body.name ?? user.name).trim().slice(0, 120);
  const email = normalizeEmail(body.email ?? user.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
  if (email !== user.email) {
    const taken = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?")
      .bind(email, user.id).first();
    if (taken) return json({ error: "That email is already in use" }, 409);
  }

  const updates = ["name = ?", "email = ?", "updated_at = ?"];
  const params = [name, email, Date.now()];
  if (body.newPassword) {
    const pw = String(body.newPassword);
    if (pw.length < 8) return json({ error: "New password must be at least 8 characters" }, 400);
    const salt = randomHex(16);
    updates.push("password_hash = ?", "password_salt = ?");
    params.push(await hashPassword(pw, salt), salt);
  }
  params.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  return json({ user: { id: user.id, email, name, createdAt: user.created_at } });
}

async function getState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Not signed in" }, 401);
  const row = await env.DB.prepare(
    "SELECT data, updated_at FROM dashboard_states WHERE user_id = ?").bind(user.id).first();
  if (!row) return json({ state: null, updatedAt: null });
  return json({ state: JSON.parse(row.data), updatedAt: row.updated_at });
}

async function putState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Not signed in" }, 401);
  let body;
  try { body = await readJson(request); } catch { return json({ error: "State too large" }, 413); }
  if (!body || typeof body.state !== "object" || body.state === null ||
      !Array.isArray(body.state.businesses)) {
    return json({ error: "Invalid state payload" }, 400);
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO dashboard_states (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .bind(user.id, JSON.stringify(body.state), now).run();
  return json({ ok: true, updatedAt: now });
}
