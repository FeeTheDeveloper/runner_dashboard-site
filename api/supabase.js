import { withSupabase } from '@supabase/server'

export const config = { runtime: 'edge' }

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

let cachedJwks = null
async function getJwks() {
  if (cachedJwks) return cachedJwks

  const jwksUrl = process.env.SUPABASE_JWKS_URL
  const supabaseUrl = process.env.SUPABASE_URL
  const url =
    jwksUrl || (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : null)

  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) return null
  cachedJwks = await res.json()
  return cachedJwks
}

export default withSupabase(
  {
    auth: ['anon', 'user'],
    env: async () => {
      const url = process.env.SUPABASE_URL
      const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
      const secretKey = process.env.SUPABASE_SECRET_KEY

      return {
        url,
        publishableKeys: publishableKey ? { default: publishableKey } : {},
        secretKeys: secretKey ? { default: secretKey } : {},
        jwks: await getJwks(),
      }
    },
  },
  async (req, ctx) => {
    if (req.method !== 'POST') return json(405, { error: 'Use POST' })

    let payload
    try {
      payload = await req.json()
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }

    const op = String(payload?.op || '').toLowerCase()
    if (!op) return json(400, { error: 'Missing op' })

    if (op === 'whoami') {
      return json(200, {
        authMode: ctx.authMode,
        userClaims: ctx.userClaims ?? null,
        jwtClaims: ctx.jwtClaims ?? null,
      })
    }

    if (ctx.authMode !== 'user') {
      return json(401, { error: 'User auth required (send Authorization: Bearer <token>)' })
    }

    if (op === 'select') {
      const table = String(payload?.table || '')
      const columns = payload?.columns ? String(payload.columns) : '*'
      const limit = Math.max(1, Math.min(100, Number(payload?.limit || 25)))
      if (!table) return json(400, { error: 'Missing table' })

      const { data, error } = await ctx.supabase.from(table).select(columns).limit(limit)
      if (error) return json(400, { error: error.message })
      return json(200, { data })
    }

    if (op === 'upsert') {
      const table = String(payload?.table || '')
      const rows = payload?.rows
      if (!table) return json(400, { error: 'Missing table' })
      if (!Array.isArray(rows) || rows.length === 0) return json(400, { error: 'rows must be a non-empty array' })
      if (rows.length > 100) return json(400, { error: 'Too many rows (max 100)' })

      const { data, error } = await ctx.supabase.from(table).upsert(rows).select()
      if (error) return json(400, { error: error.message })
      return json(200, { data })
    }

    return json(400, { error: 'Unsupported op' })
  },
)

