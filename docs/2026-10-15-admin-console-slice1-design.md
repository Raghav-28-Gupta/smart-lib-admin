# SmartLib Admin Console — Slice 1: Login, Shell and Analytics Dashboard

**Status:** approved in brainstorming on 2026-10-15; awaiting written-spec review.
**Scope:** slice 1 of 3. Slice 2 is Bookings and Resources; slice 3 is Catalogue, Fines
and the student drawer. Each slice gets its own spec, plan and build, and ships on its own.
The "Needs attention" moderation queue is deferred with no slice assigned.

## 1. Goal

A librarian logs in with an admin account and sees accurate library metrics:
utilisation, circulation, overdue materials and demand. Students can never reach
the console or its API. This satisfies FR-9 of `SMARTLIB_PROJECT_CONTEXT.md`
(administrative dashboards for utilisation, circulation, overdue materials and demand)
through the API it documents: `GET /admin/metrics/{utilization|circulation|overdue|demand}`.

Success means:

- An admin can log in on the deployed console and see all four metrics, computed live
  from the production database.
- A student account is refused by the console and receives 403 from every `/admin` route;
  a request without a token receives 401.
- Every number on the Dashboard matches a direct database query in a live check.

## 2. Decisions

| Topic | Decision |
|---|---|
| Console platform | Next.js (App Router, TypeScript) in a new `admin/` repository, dev port 3001 (decided in the earlier admin planning) |
| Visual source | Claude Design canvas *SmartLib Admin* and its "Organic" design system; design wins where it conflicts with the backend, but labels say what the numbers actually measure |
| Utilisation | **Booked share**: booked hours ÷ open hours. A no-show counts as booked |
| Admin accounts | `npm run create-admin` prompts for the password. **No demo admin in the seed**, because the seed is also run against production |
| Hosting | Vercel, deployed from GitHub on push to `main` |
| Demo data | The seed adds 4 weeks of deterministic history |
| Unbuilt sections | Visible in the sidebar but disabled, tagged "Coming soon". "Needs attention" is omitted |
| Metrics API | Four endpoints matching the project context document |
| Schema changes | None in slice 1 |

## 3. Prerequisite: server time zone (live bug)

The backend builds days and hourly slots in the **server's** local time
(`bookingService.ts`, `resourceService.ts`). Render runs in UTC while the library and
its students are in IST. A probe of production on 2026-10-15 confirmed the fault:
Group Room 202, seeded with all 11 slots taken on 2026-10-10, was reported with only
6 taken (9 AM–2 PM), and Group Room 201's 2–4 PM bookings were reported as 9–10 AM.

Fix:

- Set `TZ=Asia/Kolkata` on the Render service. This is a settings change by the
  project owner and needs no code. Stored bookings are absolute instants and are unaffected.
- `src/index.ts` logs a warning at startup when `NODE_ENV=production` and `TZ` is unset.
- The backend README's Render settings list `TZ=Asia/Kolkata`.

"Library time" below means the server's local time once `TZ` is set.

## 4. Backend

### 4.1 Access

- A new `adminRouter` declares full paths under `/admin/...` (the codebase's existing
  no-prefix convention) and applies `requireAuth` then `requireAdmin` (which already
  exists in `middleware/requireAuth.ts`) to every route.
- No token → 401. Valid student token → 403. Both are tested for every endpoint.
- Login is unchanged: `POST /auth/login` and `GET /auth/me` already return `role`.
- Public registration still creates only students.

### 4.2 Shared metric rules

- **Day**: a calendar day in library time.
- **Last 7 days**: today and the 6 days before it, in library time. For bookings this
  means the whole of each day's open hours, including later today. For loans it means
  from the start of the first day up to now.
- **Open hours**: the 11 one-hour slots in `TIME_SLOTS`, 9 AM to 8 PM, per resource per day.
- **Booked**: any `ResourceBooking` whose status is not `cancelled`. Only the part of a
  booking that falls inside the day's open hours counts. Bookings need not be slot-aligned.
- **Percentages**: `Math.round(100 × booked ÷ open)`, and 0 when open hours are 0.

### 4.3 `GET /admin/metrics/utilization`

```json
{
  "today": { "date": "2026-10-15", "percent": 74, "lastWeekPercent": 68 },
  "days": [
    { "date": "2026-10-09", "seatPercent": 62, "roomPercent": 58 }
  ]
}
```

- `today.percent`: booked share of today's open hours across all resources. It includes
  bookings for later today.
- `today.lastWeekPercent`: the same measure for the same weekday 7 days earlier.
- `days`: 7 entries, oldest first, ending today. Seat and room shares are computed separately.

### 4.4 `GET /admin/metrics/circulation`

```json
{
  "borrows": 142,
  "returns": 118,
  "topTitles": [ { "bookId": "b1", "title": "Introduction to Algorithms", "borrows": 23 } ]
}
```

- `borrows`: loans whose `borrowedAt` falls in the last 7 days.
- `returns`: loans whose `returnedAt` falls in the last 7 days.
- `topTitles`: up to 5 titles ranked by borrows in the window, ties broken by title.

### 4.5 `GET /admin/metrics/overdue`

```json
{ "count": 9, "countYesterday": 7 }
```

- `count`: loans with `returnedAt` null and `dueAt` before now.
- `countYesterday`: the same rule evaluated at exactly now minus 24 hours. A loan counts
  if it had been borrowed by then, was not yet returned at that moment, and was past due
  at that moment.

### 4.6 `GET /admin/metrics/demand`

```json
{
  "areas": [ { "area": "Group study rooms", "percent": 92, "busiestSlot": "2:00 PM" } ]
}
```

- `area`: the resource's `location`. Resources without one fall into "Seats" or "Rooms"
  by type.
- `percent`: booked share over the last 7 days for the area's resources.
- `busiestSlot`: the `TIME_SLOTS` label with the most booked time in the area over the
  window, ties going to the earliest slot. It is `null` when the area has no bookings.
- Areas are sorted by `percent`, highest first, ties broken by name.

### 4.7 Computation

- Each endpoint's service fetches only the rows inside its window with Prisma: bookings
  with resource type and location, or loans with the book title through `BookCopy`.
- The arithmetic lives in pure functions in `src/services/adminMetrics.ts`. They take
  rows and "now" and return the response shape, so each formula is unit-tested without
  a database.
- At library scale (at most tens of thousands of bookings a week) this needs no
  precomputed summary table, which would also need a scheduler the project does not have.

### 4.8 `npm run create-admin`

- `scripts/create-admin.ts`, run with `tsx` like the seed.
- It prompts in the terminal for name, email, and a password typed twice without echo.
  The password must be at least 8 characters, matching registration.
- If no account has that email, it creates one with role `admin`.
- If the email exists, it asks "An account with this email exists. Make it an admin and
  set this password? (y/N)" and promotes it only on `y`. The account's existing name is
  kept; the name typed at the prompt is used only for a new account.
- Passwords are hashed with bcrypt at cost 10, the same as registration.
- It is run against production by setting `DATABASE_URL` in that terminal only, the same
  way as the seed. `dotenv` never overrides a variable that is already set.
- The create-or-promote logic is a function tested with Vitest; the prompt wrapper is thin.

### 4.9 Seed history

`prisma/history.ts` exports a pure function `generateHistory(today, random, inputs)`
that returns booking and loan rows; `prisma/seed.ts` inserts them after its existing rows.

- **Period**: 28 days ending yesterday in library time. Nothing is dated today or later.
- **Deterministic**: a fixed-seed PRNG produces identical output on every run, shifted to
  end yesterday.
- **Owners**: only the six "Seed Student" accounts. Aditi's demo account is untouched, so
  the student app's screens, its captured fixtures and its capture script behave as before.
- **Bookings**: roughly 600–900 across the seven seeded resources.
  - Occupancy follows a plausible shape: weekday afternoons busiest, rooms peaking
    2–4 PM, weekends quieter.
  - Each booking fills exactly one slot.
  - About 80% are `checked_in` with `checkedInAt` 0–10 minutes after the start. About 20%
    stay `booked` with no check-in. That is what a real no-show looks like today, since
    nothing marks missed bookings yet.
  - At most one booking per resource per slot, so the exclusion constraint is never
    tested by the seed. At most one booking per student per slot.
- **Loans**: roughly 40–60 borrows, weighted so a few titles stand out.
  - The due date is 14 days after the borrow.
  - Most are returned before the due date, a few late.
  - A loan that would still be out (overdue or not) is placed only on a copy the seed
    already marks `borrowed` and that has no loan. If no such copy exists, the loan is
    recorded as returned instead. Every active loan therefore points at a borrowed copy,
    no copy has two active loans, and availability counts do not change.
  - Late returns do not create `Fine` rows; slice 3 may extend this.
- **Areas**: rooms gain locations: "Group study rooms" for Group Room 201 and 202,
  "Discussion pods" for Discussion Pod 1. Seats keep "Reading Room A" and "Silent Zone".
- **Reset**: re-running the seed deletes and regenerates this history, as it already does
  for its other rows.
- **Invariants (unit-tested)**: nothing today or later; no overlapping bookings per
  resource; `returnedAt` after `borrowedAt`; `checkedInAt` only on `checked_in` bookings;
  identical output for the same `today` and seed.
- **Side effect**: the student app's "Trending in the library" reflects the generated
  borrowing. This is intended.

### 4.10 Configuration and docs

- README Render settings: add `TZ=Asia/Kolkata`, and extend `CORS_ORIGINS` to the student
  web app's origin plus the console's Vercel production origin, comma-separated. The Vercel
  origin is known once the Vercel project exists (Section 8).
- `.env.example` documents both.
- README documents `create-admin` and the seed history.

## 5. Admin console

### 5.1 Repository

```
admin/                         new repo: smart-lib-admin
├── app/
│   ├── layout.tsx             loads the design system and console stylesheets
│   ├── page.tsx               redirects to /dashboard
│   ├── login/page.tsx
│   └── (console)/
│       ├── layout.tsx         session guard + shell (sidebar, top bar)
│       └── dashboard/page.tsx
├── components/                Sidebar, TopBar, KpiCard, UtilisationChart, RankedBars,
│                              DashboardStates
├── lib/
│   ├── api.ts                 fetch wrapper, token storage, session-ended event
│   ├── session.tsx            login, session guard, useSession
│   ├── metrics.ts             response types and the four fetchers
│   └── format.ts              display formatting
├── styles/
│   ├── ds.css                 the Organic design system stylesheet, verbatim
│   └── console.css            the canvas's console rules (sidebar buttons, skeleton)
└── .github/workflows/ci.yml   typecheck, test, build
```

- Next.js, React and every dependency pinned to exact versions at least two weeks old at
  implementation time. npm.
- Every page is a client component, because the session lives in `localStorage`. There is
  no server-side data fetching.
- Icons: `lucide-react` at stroke width 2.75. Charts are plain elements, as in the design;
  there is no chart library.
- Visual sources: `ds.css` is the design system's `styles.css`, recovered verbatim from
  the earlier design read, except its Google Fonts `@import`: Caprasimo and Figtree load
  through `next/font/google`, which self-hosts them, and `console.css` points the design
  system's font variables at them.
  `console.css` carries the canvas's own rules (`sla-nav-btn`, `sla-skel` and related).
- Light theme only, matching the design system. The console targets laptop and desktop
  widths; it stays usable at tablet width and is not designed for phones.

### 5.2 Configuration

| Variable | Dev | Production |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | `https://smart-lib-backend.onrender.com` |
| `NEXT_PUBLIC_LIBRARY_TIMEZONE` | `Asia/Kolkata` | `Asia/Kolkata` |

### 5.3 Session

- The token is stored in `localStorage` under `smartlib.admin.token`.
- **Login page**: email, password, "Log in".
  - On success with role `admin`: store the token and go to `/dashboard`.
  - Role is not `admin`: show "This account doesn't have admin access." and store nothing.
  - Wrong credentials: show the server's message.
  - Server unreachable: show "Can't reach the SmartLib server. Try again in a minute."
- **Console guard** (`(console)/layout.tsx`): with no token, go to `/login`. Otherwise call
  `GET /auth/me`; continue only if the role is `admin`, else clear the token and go to `/login`.
- **Any 401 from the API**: clear the token and go to `/login`, which shows
  "Your session expired. Log in again."
- **Any 403 from the API** (the account is no longer an admin), or `/auth/me` returning a
  non-admin: clear the token and go to `/login`, which shows "This account doesn't have
  admin access." A 404 from `/auth/me` (the account was deleted) clears the token and goes
  to `/login`.
- **Server unreachable during the check**: keep the token and show "Can't reach the
  SmartLib server. Try again in a minute." with **Retry**.
- **Log out**: a link in the sidebar's user chip clears the token and returns to `/login`.
  The design has no log-out control; this is an addition.

### 5.4 API client

- Sends JSON with `Authorization: Bearer <token>`.
- Maps the backend's `{ error, details }` body to an error carrying `status` and `message`.
- Allows up to 60 seconds per request, so a Render free instance waking from sleep shows
  the loading skeleton rather than an error.

### 5.5 Shell

- **Sidebar**, following the canvas:
  - The SmartLib mark, with "Admin console" under it.
  - **Dashboard** (active).
  - **Bookings, Catalogue, Resources, Fines**: disabled, not focusable as links, each with
    a small "Coming soon" tag.
  - "Needs attention" is omitted.
- **User chip** at the bottom: the logged-in admin's name and initials, "Librarian admin",
  and "Log out".
- **Top bar**: the page title and today's date in library time, for example
  "Thursday, Oct 15, 2026".

### 5.6 Dashboard

The page calls the four endpoints in parallel and renders one of four states, using the
canvas's markup for each.

| State | When | Content |
|---|---|---|
| Loading | any request pending | the canvas skeleton: four card blocks, a chart block, two list blocks |
| Error | any request failed (other than 401) | "Couldn't load dashboard metrics", "Check your connection and try again.", **Retry** (re-runs all four) |
| Empty | every `days` entry has seat and room percent 0, `borrows` and `returns` are 0, and overdue `count` is 0 | "No activity recorded yet", "Utilisation, circulation and demand metrics will appear here once bookings and loans start coming in." |
| Loaded | otherwise | as below |

Loaded content:

- **Utilisation today**: `74%`, then "+6 pts vs last week" ("−3 pts", or "no change vs last week").
- **Circulation, 7 days**: `142 / 118`, then "Borrows / returns".
- **Overdue materials**: `9`, then "+2 since yesterday" ("−1 since yesterday", or "no change
  since yesterday"). Not clickable, since the queue it linked to is deferred.
- **Peak demand**: the top area's name, then "92% booked, 2–3 PM busiest". The busiest
  phrase is omitted when `busiestSlot` is null. With no areas at all (no resources), the
  card shows "No resources yet".
- **Seat & room utilisation, last 7 days**: paired bars per day, seats and rooms, with
  weekday labels and the canvas's legend.
- **Top titles, last 7 days**: up to 5 rows, with bar widths relative to the top title.
  The design says "this week"; the label states the real window.
- **Resource demand, last 7 days**: one row per area with its percentage.

`lib/format.ts` holds the formatting as pure, tested functions: points delta, day delta,
slot range ("2:00 PM" becomes "2–3 PM"), and today's date label.

### 5.7 Deployment

- Vercel imports the GitHub repository; production deploys from `main`.
- `NEXT_PUBLIC_API_BASE_URL` is set in the Vercel project.
- Render: `CORS_ORIGINS` gains the Vercel origin, and `TZ=Asia/Kolkata` is set (Section 3).

## 6. Testing

**Backend (Vitest)**

- Pure metric functions: each formula on hand-built rows, including partial-hour and
  non-aligned bookings, cancelled bookings excluded, empty inputs, and tie-breaks.
- Each endpoint against Postgres: 401 without a token, 403 for a student, and correct
  numbers on a known dataset.
- `generateHistory`: the invariants in 4.9.
- `create-admin` logic: create, promote on confirmation, refuse without it, and reject
  short passwords.
- Startup `TZ` warning: present in production without `TZ`, absent otherwise.

**Console (Vitest + Testing Library)**

- `format.ts` functions.
- API client: header, error mapping, 401 handling, timeout.
- Session: a student login is refused; the guard redirects without a token and with a
  non-admin `/auth/me`.
- Dashboard: loading, error with Retry, empty and loaded states, with `fetch` mocked.

**CI**: the backend's existing workflow runs the new tests. The admin repository's
workflow runs typecheck, tests and `next build` on every push.

**Live check before completion**: run the backend locally with the seeded history and the
console locally; compare every Dashboard number with a direct SQL query; capture a
screenshot of the loaded Dashboard.

## 7. Out of scope for slice 1

- Bookings, Catalogue, Resources and Fines sections, the student drawer, and every
  mutation (slices 2 and 3).
- The three schema additions (copy barcodes, resource status, fine adjustment and dispute)
  and the reliability-tier realignment (slices 2 and 3).
- The moderation queue ("Needs attention").
- Density and badge toggles (canvas design-time options), dark theme, phone layouts.
- Precomputed metrics, schedulers and no-show detection.

## 8. Actions for the project owner

1. Render: set `TZ=Asia/Kolkata` (needed now, independent of the console).
2. Create the `smart-lib-admin` GitHub repository, or approve creating it with `gh`.
3. Create a Vercel account, import the repository, and set `NEXT_PUBLIC_API_BASE_URL`.
4. Render: add the Vercel origin to `CORS_ORIGINS`.
5. Run `npm run create-admin` against production.
6. Re-run the seed against production to load the history.
