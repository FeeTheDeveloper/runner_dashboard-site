# Business Status Dashboard

A static, single-page dashboard for tracking multiple businesses and their key growth activities: **Net 30 accounts**, **banking**, and **credit monitoring**. No build step, no server — open `index.html` in a browser or host on GitHub Pages.

## Features

- **Business roster** — add multiple businesses (LLC / C-Corp / S-Corp / etc.), switch between them from the header selector.
- **Business status checklist** — every new business is seeded with the standard setup checklist (EIN, DUNS, business address, bank account, listings, etc.). Add or remove items freely; checked items get a green check.
- **Net 30 accounts** — track vendor name, status (approved / pending / denied / closed), credit limit, balance, opened date, and which bureaus each vendor reports to (D&B, Experian, Equifax).
- **Banking** — track institutions, account nicknames, type (checking / savings / credit card / LOC / loan), balance, available credit, and status.
- **Credit monitoring** — per-business scores for **D&B PAYDEX**, **Experian Intelliscore**, **Equifax Business**, and **FICO SBSS**, with color-coded progress bars and a history log showing per-bureau change (▲ / ▼).
- **Activity monitor** — timestamped feed of every action (task toggled, vendor added, score updated, etc.).
- **Upcoming reminders** — track filing deadlines, payments, renewals; overdue / due-soon items are highlighted.
- **Overview tiles** — total businesses, total Net 30 accounts (with approved count), average bureau score across the portfolio, total cash + available credit.
- **Integrations** — track sign-up status and (optionally) call the provider APIs for **Mercury Bank**, **My D&B**, and **NAV**. Each provider has both a REST-API path and an MCP-tool path (see below).
- **DUNS number** capture on the business form, with a separate DUNS status (not requested / requested / pending / issued). A DUNS entered here auto-links to the My D&B integration slot.
- **Persistence & live sync** — state lives in `localStorage` under the `business-dashboard-v1` key; multiple tabs stay in sync via the `storage` event.
- **Export / Import** — one-click JSON backup and restore.

## Integrations (Mercury / My D&B / NAV)

`integrations.js` exposes `window.BizIntegrations` with two callable transports per provider:

| Provider     | REST API method              | MCP tool method             | Auth needed                 |
|--------------|------------------------------|-----------------------------|-----------------------------|
| Mercury Bank | `mercury.api(action, params)`| `mercury.mcp(action, ...)`  | Mercury API token *or* the Mercury MCP connector authorized in Claude settings |
| My D&B       | `dnb.api(action, params)`    | `dnb.mcp(action, params)`   | D&B API bearer (client-credentials OAuth) |
| NAV          | `nav.api(action, params)`    | `nav.mcp(action, params)`   | NAV API token               |

Supported actions:

- **Mercury** — `listAccounts`, `getAccount({accountId})`, `listTransactions({accountId,limit})`
- **My D&B** — `lookupByDuns({duns})`, `matchCompany({name,city,region,postal,country})`
- **NAV** — `signupStatus`, `creditScores`, `applications`

`BizIntegrations.probeStatus(providerId, integration)` tries the preferred transport, falls back to the other, and returns `{ok, source, data|error}`.

**Important — browser limits.** This is a static site; direct REST calls to Mercury / D&B / NAV will fail CORS from a browser and would leak tokens if they didn't. In production, route requests through your own backend or a serverless proxy — the request shapes in `integrations.js` document exactly what to forward. Similarly, MCP tools like `mcp__Mercury__*` are only reachable from an MCP-aware host (Claude Code, an agent runtime with the connector loaded); the dashboard invokes them through an optional `window.callMcpTool(name, params)` bridge that your host page can install.

Tokens the user enters in the Integrations modal are saved to `localStorage` under `biz-integration-creds-v1` — fine for a local personal dashboard, **not** appropriate for shared or public hosting.

## Usage

Open `index.html` directly, or serve the folder statically:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

1. Click **+ Business** and fill in the details.
2. Toggle checklist items as you complete each setup step.
3. Add Net 30 vendors, bank accounts, and credit scores as they come in.
4. Add reminders for upcoming filings or payments.
5. Watch the activity feed on the right for a running log of what changed.

## Agent Assistant

The dashboard has two routes, switched via the header tabs (and via the URL hash, `#dashboard` / `#agent`).

**Agent route (`#agent`)** contains three panels:

1. **Recommended Next Steps** — a rules engine reads the active business's state and emits ranked recommendations (high / med / low). Missing DUNS, no active checking account, fewer than 3 approved Net 30 tradelines, no bureau-reporting vendors, pending vendor follow-ups, overdue reminders, PAYDEX push targets, checklist gaps — each has its own rule with a specific "why". Recommendations with a **link** open the relevant application page; recommendations with a **focus** jump to the dashboard and scroll/open the exact card.
2. **Best Plays** — the credit-building playbook grouped by tier: 1 Foundation (EIN, DUNS, address, phone, bank, website), 2 Starter (Uline, Grainger, Quill, Summa, Crown), 3 Store (Amazon, Home Depot, Lowe's), 4 Fleet (WEX, Fuelman), 5 Bank (first business card, LOC/SBA), 6 Scale (monitoring, PAYDEX 80, FICO SBSS 160+). Each play has a `done` predicate that checks the live state — completed plays show as struck-through.
3. **Ask the Agent** — a chat panel that answers questions grounded in the current dashboard state:
   - **Local mode** (default, no network) — a keyword-routed engine that answers "what should I do next?", "which vendors are pending?", "where's my PAYDEX?", etc. by reading state.
   - **Claude mode** — direct browser call to the Anthropic Messages API. Set your API key in the modal; it's stored in `localStorage` only and sent with the `anthropic-dangerous-direct-browser-access` header. Available models: Claude Haiku 4.5, Sonnet 5, Opus 4.8. The dashboard state is passed to the model as a system-block JSON snapshot so replies stay grounded.

An **agent badge** on the tab shows the count of high-priority recommendations; it disappears when nothing is high-priority.

## Login (SMS one-time code)

Access is gated to numbers listed in `authorized_users.json` at the repo root:

```json
{
  "users": [
    { "name": "Admin Fee", "phone": "+12144711386", "role": "admin", "greeting": "Admin Fee" },
    { "name": "Lab",       "phone": "+19043769615", "role": "user",  "greeting": "Lab" }
  ]
}
```

Edit that file to add or remove users — the client roster and the backend `AUTHORIZED_USERS` array (in `server/cloudflare-worker.js` / `server/vercel-api.js`) must stay in sync.

**Flow**
1. Visitor enters their phone number on the login gate.
2. Client normalizes to E.164 and calls the backend's `POST /otp/send`; backend generates a 6-digit code, stores its SHA-256 hash in KV with a 10-minute TTL, and hands it to Twilio to text.
3. Visitor enters the code; client calls `POST /otp/verify`; backend HMAC-signs a session token containing name/role and returns it. Session lives 12 hours in `localStorage`.
4. Twilio calls back into `POST /callback` after each delivery attempt; status is logged to KV for 24 hours.

**Modes**
- **Demo** (no backend configured) — the client generates the OTP locally and prints it to the browser console for testing. Anyone can bypass this via DevTools; use only for local dev.
- **Live** — set the endpoint before `auth.js` loads:
  ```html
  <meta name="auth-endpoint" content="https://biz-dashboard-otp.<sub>.workers.dev">
  ```
  or `<script>window.AUTH_ENDPOINT = "https://…";</script>`.

**Backends** — two drop-in templates in `server/`:
- `server/cloudflare-worker.js` — Workers + KV, deploy with `wrangler`.
- `server/vercel-api.js` — Vercel serverless + `@vercel/kv`.

Both use Twilio for SMS delivery. See `server/README.md` for the deploy commands, env vars, and Twilio setup.

**Personalization** — after login, the agent addresses the signed-in user by the `greeting` from the roster:
- `+1 214-471-1386` → **"Admin Fee"** (admin role — unlocked briefings, credential-management guidance)
- `+1 904-376-9615` → **"Lab"** (user role — lighter briefing)

The Claude system prompt receives the signed-in identity and role so responses are tailored. Local-mode replies get greeted client-side.

A **user chip** in the header shows the current user + a Log out button; logout clears the session and returns to the login gate.

## Files

- `index.html` — layout, tiles, cards, modals, both views, and the login gate
- `styles.css` — dark dashboard theme + agent view + login styles
- `app.js` — state, rendering, persistence, hash router, and login gating
- `auth.js` — client-side SMS OTP flow (demo + prod) and session store
- `authorized_users.json` — roster of authorized phone numbers
- `integrations.js` — REST + MCP wrappers for Mercury Bank, My D&B, and NAV
- `agent.js` — recommendations engine, plays library, and Claude API adapter
- `server/cloudflare-worker.js` — Twilio-backed OTP backend (Cloudflare Worker)
- `server/vercel-api.js` — Twilio-backed OTP backend (Vercel serverless)
- `server/README.md` — deploy walk-throughs and env-var checklist
