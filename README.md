# SmartLib — Admin Console

The librarian console for SmartLib: log in with an admin account, approve or
decline the borrow and room requests students send, and see live utilisation,
circulation, overdue and demand metrics. Everything updates live, without
reloading. Built with Next.js and the Organic design system; talks only to the
SmartLib API (`../backend`).

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev        # http://localhost:3001
```

Needs the backend running on `http://localhost:3000` (`cd ../backend && npm run dev`)
and an admin account: `cd ../backend && npm run create-admin`. Student accounts
are refused.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3001 |
| `npm test` | Tests (Vitest + Testing Library); no backend needed |
| `npm run build` | Production build, including type-checking |

## Deploy (Vercel)

1. Vercel → Add New → Project → import `smart-lib-admin`. The framework is detected as Next.js.
2. Environment variables: `NEXT_PUBLIC_API_BASE_URL` = `https://smart-lib-backend.onrender.com`, `NEXT_PUBLIC_LIBRARY_TIMEZONE` = `Asia/Kolkata`.
3. Deploy. Every push to `main` redeploys.
4. On Render, add the console's Vercel origin to `CORS_ORIGINS` (comma-separated after the student web app's origin), or the browser will refuse every API response.

The API sleeps after 15 idle minutes on Render's free plan; the console waits up
to 60 seconds and shows its loading skeleton meanwhile.

## Live updates

The console keeps one Server-Sent Events connection to `GET /admin/events`
(`lib/live.ts`). Events only say what changed; the views refetch, a second
after the last event. On every reconnect, and every 5 minutes, everything
refetches, so a dropped connection loses nothing. The top bar shows
`● Live` or `○ Reconnecting…`.

## Design

The specs and plans for each slice are in `docs/`. Bookings and Resources
(slice 4) and Catalogue, Fines and the student drawer (slice 5) follow; their
sidebar entries show "Coming soon" until then.
