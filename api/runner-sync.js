export const config = { runtime: "edge" };

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function resolveRunnerSyncUrl() {
  const explicit = process.env.RUNNER_SYNC_URL;
  if (explicit) return explicit;

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return null;
  return supabaseUrl.replace(/\/+$/, "") + "/functions/v1/runner-sync";
}

function buildHeaders(requestHeaders) {
  const headers = { "content-type": "application/json" };
  const accessKey = process.env.RUNNER_SYNC_ACCESS_KEY;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (accessKey) {
    headers.authorization = `Bearer ${accessKey}`;
    headers["x-runner-sync-key"] = accessKey;
  } else if (publishableKey) {
    headers.authorization = `Bearer ${publishableKey}`;
    headers.apikey = publishableKey;
  }

  const incomingAuth = requestHeaders.get("authorization");
  if (incomingAuth) headers["x-client-authorization"] = incomingAuth;
  return headers;
}

export default async function handler(req) {
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const runnerSyncUrl = resolveRunnerSyncUrl();
  if (!runnerSyncUrl) return json(500, { error: "Missing RUNNER_SYNC_URL or SUPABASE_URL" });

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const upstream = await fetch(runnerSyncUrl, {
    method: "POST",
    headers: buildHeaders(req.headers),
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!upstream.ok) {
    return json(upstream.status, {
      error: data?.error || data?.message || "runner-sync request failed",
      details: data,
    });
  }

  return json(200, data ?? {});
}
