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
- **Persistence & live sync** — state lives in `localStorage` under the `business-dashboard-v1` key; multiple tabs stay in sync via the `storage` event.
- **Export / Import** — one-click JSON backup and restore.

## Local development

Install dependencies and serve the site locally:

```sh
npm install
npm run dev
# then open http://127.0.0.1:8000
```

You can also preview the site with Cloudflare Pages locally:

```sh
npm run cf:dev
```

1. Click **+ Business** and fill in the details.
2. Toggle checklist items as you complete each setup step.
3. Add Net 30 vendors, bank accounts, and credit scores as they come in.
4. Add reminders for upcoming filings or payments.
5. Watch the activity feed on the right for a running log of what changed.

## Cloudflare deployment

This repo is configured as a Cloudflare Worker serving static assets from `public/` (see `wrangler.jsonc`).

### Automatic deploys (GitHub Actions)

Every push to `main` runs `.github/workflows/deploy.yml`:

- **With repo secrets** `CLOUDFLARE_API_TOKEN` (permission: *Workers Scripts — Edit*) and `CLOUDFLARE_ACCOUNT_ID` set, the site deploys straight to your Cloudflare account.
- **Without secrets**, wrangler deploys to a temporary preview account (`wrangler deploy --temporary`) that stays live for 60 minutes. The deploy output — including the one-time **claim URL** that moves the deployment into your own Cloudflare account permanently — is uploaded as the `deployment-urls` workflow artifact rather than printed in the public log.

### Deploy from the CLI

```sh
npm install
npx wrangler login
npm run cf:deploy
```

## Files

- `public/index.html` — layout, tiles, cards, and modals
- `public/styles.css` — dark dashboard theme
- `public/app.js` — all state, rendering, and persistence logic
- `wrangler.jsonc` — Cloudflare Workers static assets configuration
- `.github/workflows/deploy.yml` — CI deployment workflow
