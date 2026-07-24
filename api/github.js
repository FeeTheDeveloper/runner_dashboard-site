export const config = { runtime: 'edge' }

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function isAllowedMethod(method) {
  return ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)
}

function normalizePath(path) {
  if (!path) return null
  const p = String(path).trim()
  if (!p.startsWith('/')) return null
  if (p.includes('..')) return null
  return p
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'Use POST' })

  const token = process.env.GITHUB_AGENT_API_TOKEN
  if (!token) return json(500, { error: 'Missing GITHUB_AGENT_API_TOKEN' })

  let payload
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const method = String(payload?.method || 'GET').toUpperCase()
  const path = normalizePath(payload?.path)
  const body = payload?.body

  if (!isAllowedMethod(method)) return json(400, { error: 'Unsupported method' })
  if (!path) return json(400, { error: 'Invalid path' })

  const url = 'https://api.github.com' + path
  const ghRes = await fetch(url, {
    method,
    headers: {
      authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'runner-dashboard-site',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })

  const text = await ghRes.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  if (!ghRes.ok) {
    return json(ghRes.status, {
      error: data?.message || 'GitHub request failed',
      status: ghRes.status,
      details: data,
    })
  }

  return json(200, data)
}

