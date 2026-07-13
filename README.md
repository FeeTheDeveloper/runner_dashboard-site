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

## Files

- `index.html` — layout, tiles, cards, and modals
- `styles.css` — dark dashboard theme
- `app.js` — all state, rendering, and persistence logic
- `integrations.js` — REST + MCP wrappers for Mercury Bank, My D&B, and NAV
