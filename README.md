# Business Status Dashboard

A static, single-page dashboard for tracking multiple businesses and their key growth activities: **Net 30 accounts**, **banking**, and **credit monitoring**. No build step is required, and the repo is configured for direct deployment to Cloudflare Workers (static assets).

## Features

- **Business roster** — add multiple businesses (LLC / C-Corp / S-Corp / etc.), switch between them from the header selector.
- **Business status checklist** — every new business is seeded with the standard setup checklist (EIN, DUNS, business address, bank account, listings, etc.). Add or remove items freely; checked items get a green check.
- **Net 30 accounts** — track vendor name, status (approved / pending / denied / closed), credit limit, balance, opened date, and which bureaus each vendor reports to (D&B, Experian, Equifax).
- **Banking** — track institutions, account nicknames, type (checking / savings / credit card / LOC / loan), balance, available credit, and status.
- **Credit monitoring** — per-business scores for **D&B PAYDEX**, **Experian Intelliscore**, **Equifax Business**, and **FICO SBSS**, with color-coded progress bars and a history log showing per-bureau change (▲ / ▼).
- **Activity monitor** — timestamped feed of every action (task toggled, vendor added, score updated, etc.).
- **Upcoming reminders** — track filing deadlines, payments, renewals; overdue / due-soon items are highlighted.
- **Overview tiles** — total businesses, total Net 30 accounts (with approved count), average bureau score across the portfolio, total cash + available credit.
- **Accounts & profiles** — email/password login backed by Cloudflare D1; each user's dashboard is saved to their account and follows them across devices. Profile (name, email, password) editable in-app.
- **Persistence & live sync** — state lives in `localStorage` under the `business-dashboard-v1` key and syncs to the server when signed in; multiple tabs stay in sync via the `storage` event.
- **Export / Import** — one-click JSON backup and restore.

## Local development

Install dependencies, seed the local database, and run the full stack locally:

```sh
npm install
npx wrangler d1 execute DB --local --file=./schema.sql
npm run cf:dev
# then open http://127.0.0.1:8787
```

`npm run dev` serves just the static frontend on :8000 (no login — the app
falls back to browser-only storage when the API is absent).

1. Click **+ Business** and fill in the details.
2. Toggle checklist items as you complete each setup step.
3. Add Net 30 vendors, bank accounts, and credit scores as they come in.
4. Add reminders for upcoming filings or payments.
5. Watch the activity feed on the right for a running log of what changed.

## Cloudflare deployment

This repo is configured as a Cloudflare Worker: static assets from `public/`, an auth/sync API in `src/worker.js`, and a D1 database (`runner-dashboard-db`) for users, sessions, and dashboard data (see `wrangler.jsonc`).

### Automatic deploys (GitHub Actions)

Every push to `main` runs `.github/workflows/deploy.yml`, which deploys with wrangler and smoke-tests the live URL. Two repository secrets are required (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN` — API token with **Workers Scripts — Edit** and **D1 — Edit** permissions
- `CLOUDFLARE_ACCOUNT_ID` — your account id (dash.cloudflare.com → Workers & Pages → right sidebar)

### Deploy from the CLI

```sh
npm install
npx wrangler login
npm run cf:deploy
```

## Files

- `public/index.html` — layout, tiles, cards, modals, and auth overlay
- `public/styles.css` — dark dashboard theme
- `public/app.js` — state, rendering, auth flow, and server sync
- `src/worker.js` — Worker API: register/login/logout, profile, dashboard state
- `schema.sql` — D1 schema (users, sessions, dashboard_states)
- `wrangler.jsonc` — Worker + static assets + D1 binding configuration
- `.github/workflows/deploy.yml` — CI deployment workflow
