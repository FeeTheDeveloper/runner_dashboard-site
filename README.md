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

## Files

- `index.html` — layout, tiles, cards, modals, and both views
- `styles.css` — dark dashboard theme + agent view styles
- `app.js` — state, rendering, persistence, and the hash router
- `integrations.js` — REST + MCP wrappers for Mercury Bank, My D&B, and NAV
- `agent.js` — recommendations engine, plays library, and Claude API adapter
