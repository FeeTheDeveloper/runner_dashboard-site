# runner-dashboard-site

Business status dashboard (Net 30 accounts, banking, business credit) deployed
as a Cloudflare Worker with static assets and a D1-backed auth/sync API.

## Architecture

- `public/` — static frontend (vanilla JS, no build step). `app.js` keeps state
  in localStorage and, when signed in, syncs it to the server (debounced
  `PUT /api/state`).
- `src/worker.js` — Worker backend: session-cookie auth (PBKDF2 password
  hashing, hashed session tokens), profile management, and per-user dashboard
  state persistence. API routes live under `/api/*`; everything else is served
  from the assets binding.
- `schema.sql` — D1 schema (`users`, `sessions`, `dashboard_states`).
- `.github/workflows/deploy.yml` — deploys on push to `main` (and `claude/**`).
  Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets.

## Claude's direct connection to dashboard data

The production database is **`runner-dashboard-db`**
(id `e6c35059-574a-4178-a04e-ce3201ca6a09`) in the owner's Cloudflare account.
Claude sessions with the Cloudflare Developer Platform connector can operate on
it directly via `d1_database_query` — reading or updating users, sessions, and
per-user dashboard state (`dashboard_states.data` is the full dashboard JSON per
user). Schema changes should be applied both there and in `schema.sql`.

Deployments run through the GitHub Actions workflow (push to `main`, or
`workflow_dispatch`); Claude can trigger and monitor them with the GitHub MCP
tools. The Claude Code sandbox cannot reach `api.cloudflare.com` directly, so
never try to `wrangler deploy` locally — always deploy via the workflow.

## Local development

```sh
npm install
npx wrangler d1 execute DB --local --file=./schema.sql   # once, seeds local D1
npm run cf:dev                                           # full stack on :8787
```

`npm run dev` serves only the static frontend; the app then runs in
local-only mode (no login) since `/api/*` is absent.
