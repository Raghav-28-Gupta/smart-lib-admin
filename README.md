# SmartLib — Admin Console

The librarian console for SmartLib: log in with an admin account, approve or
decline the borrow and room requests students send, manage the study-space
resources and the bookings on them, and see live utilisation, circulation,
overdue and demand metrics. Everything updates live, without reloading. Built
with Next.js and the Organic design system; talks only to the SmartLib API
(`../backend`).

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

## Resources

The Resources page lists every seat and room by name, with its location,
capacity and status; a type filter narrows it to seats or rooms. A librarian can:

- add a resource: type, name, location and a capacity from 1 to 100;
- edit its name, location and capacity (the type is fixed once it exists);
- take it offline, with an optional note (up to 300 characters) that shows on
  its row, or bring it back online.

An offline resource stops taking new bookings: it leaves the student booking
picker, is never suggested as an alternative, and no booking can be moved onto
it. Bookings it already has stay, and the take-offline dialog says how many.

## Bookings

The Bookings page lists seat bookings and approved room bookings, newest start
first, 25 to a page with Previous and Next. Room requests that are still waiting
stay on Requests. Two filters narrow the list, and changing either goes back to
page 1:

- search, for a student's name or email or a resource name (sent after a short
  pause in typing);
- status: Booked, Checked in, Completed, Released (grace period) or Cancelled.

A cancelled row says whether the student or the library cancelled it and, if
one was given, why. A librarian can:

- cancel a booking, with an optional reason (up to 300 characters) that the
  student sees in My Bookings; the slot reopens at once;
- reassign it to another resource of the same type that is online and free for
  the booking's time; the dialog asks the server for those when it opens.

Cancel and Reassign only appear on bookings the server marks as still
manageable (booked, grace period not over), and the server checks again when you
confirm. If the student checked in or cancelled first, a toast gives the
server's reason and the list refreshes.

## Live updates

The console keeps one Server-Sent Events connection to `GET /admin/events`
(`lib/live.ts`). Events only say what changed; the views refetch, a second
after the last event. On every reconnect, and every 5 minutes, everything
refetches, so a dropped connection loses nothing. The top bar shows
`● Live` or `○ Reconnecting…`.

Each event names the topics it affects, and a view refetches on its own:
`requests` (the Requests page and the sidebar count), `metrics` (the dashboard),
`bookings` (the Bookings page: a seat booked, a check-in, a cancel or a move)
and `resources` (the Resources page: one added, edited, taken offline or brought
back).

## Design

The specs and plans for each slice are in `docs/`. Bookings and Resources
(slice 4) are built; Catalogue and Fines, with the student drawer (slice 5),
follow, and their sidebar entries show "Coming soon" until then.
