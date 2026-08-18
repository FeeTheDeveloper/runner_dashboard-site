# Runner Dashboard

Runner Dashboard is a single-page operations dashboard for managing multiple businesses, compliance, vendor credit, banking, reminders, and activity history.

Production deployment target is **Vercel** with **Supabase** cloud synchronization.

## Runtime architecture

Browser (`/`)  
→ Vercel static app (`public/index.html`, `public/app.js`, `public/cloud-sync.js`, `public/styles.css`)  
→ Vercel API route (`/api/runner-sync`)  
→ Supabase Edge Function (`runner-sync`)  
→ Supabase PostgreSQL

## Local development

1. Install dependencies:

```sh
npm install
```

2. Create local env:

```sh
cp .env.example .env.local
```

3. Fill `.env.local` with real values (never commit secrets).

4. Start local dashboard quickly (static):

```sh
npm run dev
```

Then open `http://127.0.0.1:8000`.

5. For full Vercel + `/api` local behavior, run:

```sh
npm run dev:vercel
```

## Required environment variables

Set these in Vercel Project Settings → Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_JWKS_URL` (optional but recommended)
- `SUPABASE_SECRET_KEY` (server-only)
- `RUNNER_SYNC_ACCESS_KEY` (server-only, if your runner-sync function expects it)
- `RUNNER_SYNC_URL` (optional override; defaults to `${SUPABASE_URL}/functions/v1/runner-sync`)
- `GITHUB_AGENT_API_TOKEN` (optional, for assistant GitHub commands)

## Cloud sync behavior

- On startup, the dashboard attempts cloud hydration from `runner-sync`.
- Cloud data wins initial hydration when available.
- Local storage remains as offline cache/resilience.
- User edits update UI immediately, then cloud saves are debounced.
- Status chip in header reports:
  - `Cloud Connecting...`
  - `Runner Cloud Connected`
  - `Syncing...`
  - `Cloud Save Failed`
  - `Cloud Offline - Local Cache Active`

## Entry points

- `/` → Runner Dashboard UI (served from `public/index.html`)
- `/styles.css` → styles
- `/cloud-sync.js` → cloud sync client
- `/app.js` → dashboard app
- `/api/*` → Vercel API routes

## Build and deploy

Build production output:

```sh
npm run build
```

Deploy to production from CLI:

```sh
npm run deploy
```

Or import this repository into a new Vercel project and deploy via Git integration.
