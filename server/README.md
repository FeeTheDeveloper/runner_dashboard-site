# Auth backend templates

Two drop-in templates that expose the same three endpoints:

| Method | Path            | Purpose                                   |
|--------|-----------------|-------------------------------------------|
| POST   | `/otp/send`     | `{phone}` → generates a 6-digit code and SMS-sends it via Twilio |
| POST   | `/otp/verify`   | `{phone, code}` → returns a signed session token + user greeting |
| POST   | `/callback`     | Twilio delivery-status webhook            |
| GET    | `/health`       | Worker only                               |

Both templates enforce the roster locally (they never call GitHub for `authorized_users.json`), so the client roster and the backend roster must stay in sync — edit both files when adding a user.

## Cloudflare Worker (`cloudflare-worker.js`)

```sh
npm i -g wrangler
wrangler init biz-dashboard-otp
# copy cloudflare-worker.js into src/index.js

# KV for OTP + cooldown + callbacks
wrangler kv:namespace create OTP_KV

# In wrangler.toml:
#   main = "src/index.js"
#   compatibility_date = "2025-01-01"
#   [[kv_namespaces]] binding = "OTP_KV" id = "<from create>"
#   [vars]
#   TWILIO_ACCOUNT_SID = "AC..."
#   TWILIO_FROM        = "+15551234567"
#   ALLOWED_ORIGIN     = "https://your-dashboard.example"
#   CALLBACK_URL       = "https://<worker>.workers.dev/callback"

wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put SESSION_SECRET

wrangler deploy
```

Then set the client endpoint:

```html
<meta name="auth-endpoint" content="https://biz-dashboard-otp.<subdomain>.workers.dev">
```

or before `auth.js` loads:

```html
<script>window.AUTH_ENDPOINT = "https://…";</script>
```

## Vercel serverless (`vercel-api.js`)

```sh
mkdir -p api/otp
cat > api/otp/send.js   <<'EOF'
const { handleSend }   = require("../../server/vercel-api");
module.exports = handleSend;
EOF
cat > api/otp/verify.js <<'EOF'
const { handleVerify } = require("../../server/vercel-api");
module.exports = handleVerify;
EOF
cat > api/callback.js   <<'EOF'
const { handleCallback } = require("../../server/vercel-api");
module.exports = handleCallback;
EOF

npm i @vercel/kv
vercel link
vercel env add TWILIO_ACCOUNT_SID
vercel env add TWILIO_AUTH_TOKEN
vercel env add TWILIO_FROM
vercel env add SESSION_SECRET
vercel env add ALLOWED_ORIGIN
vercel env add CALLBACK_URL
vercel --prod
```

## Twilio setup

1. Buy or port a number in the Twilio console.
2. Set the number's **Messaging → A Message Comes In** webhook to `https://<your-app>/callback` (both templates ignore inbound messages but log delivery statuses).
3. Copy `Account SID` and `Auth Token` from the Twilio console into the deployment env vars above.

## Editing the roster

Client roster: `authorized_users.json` at the repo root.
Server roster: the `AUTHORIZED_USERS` array at the top of the backend template you deployed. Keep them identical.

## Security notes

- The demo (client-only) mode is bypassable via devtools — it exists so the UI can be tested without a backend. Never rely on it in production.
- The session token is HMAC-signed with `SESSION_SECRET`. Rotate it periodically; every rotation invalidates all sessions.
- `SEND_COOLDOWN_SECS` throttles code re-requests; `OTP_MAX_ATTEMPTS` caps verify failures per issued code before the code is discarded.
