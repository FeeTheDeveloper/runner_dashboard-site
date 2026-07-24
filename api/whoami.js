import { withSupabase } from '@supabase/server'

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

export const config = { runtime: 'edge' }

export default withSupabase(
  {
    auth: 'user',
    env: async () => {
      const url = process.env.SUPABASE_URL
      const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY

      return {
        url,
        publishableKeys: publishableKey ? { default: publishableKey } : {},
        jwks: await getJwks(),
      }
    },
  },
  async (_req, ctx) => {
    return Response.json({
      authMode: ctx.authMode,
      userClaims: ctx.userClaims ?? null,
      jwtClaims: ctx.jwtClaims ?? null,
    })
  },
)

