# Admin Console Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give librarians a deployed admin console where an admin logs in and sees live utilisation, circulation, overdue and demand metrics, while students are refused everywhere.

**Architecture:** The Node backend gains four guarded `GET /admin/metrics/*` endpoints whose arithmetic lives in pure, unit-tested TypeScript functions, a `create-admin` script, and four weeks of deterministic seed history. A new Next.js (App Router) app in a separate `admin/` repository reuses the existing login API, keeps its token in `localStorage`, and renders the Claude Design canvas's shell and Dashboard with client components. It deploys to Vercel.

**Tech Stack:** Backend: Node 22, Express 5, TypeScript 7.0.2, Prisma 7, Vitest 4 + Supertest (all existing). Console: Next.js 16.3.8, React 19.3.0, TypeScript 6.0.3, lucide-react 1.49.0, Vitest 5.0.3 + Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-15-admin-console-slice1-design.md` (read it alongside this plan). Design assets recovered from the Claude Design project: `docs/superpowers/assets/admin-console/` (`organic-styles.css`, `canvas-console.css`, `canvas-source.dc.html`).

## Global Constraints

- **Never run `git add` or `git commit`** (standing project rule). Each task ends by presenting the exact commands for the user to run. Commit prefixes: `backend:` and `admin:`.
- Run package commands from inside the package directory (`backend/` or `admin/`), never from the repository root.
- Library time is the server's local time zone; production sets `TZ=Asia/Kolkata`. The console formats dates with `NEXT_PUBLIC_LIBRARY_TIMEZONE`, default `Asia/Kolkata`.
- Open hours: the 11 one-hour `TIME_SLOTS`, 9 AM to 8 PM. "Booked" means any booking whose status is not `cancelled`.
- No Prisma migration in slice 1.
- Console dependency versions are exact and at least two weeks old: `next 16.3.8`, `react 19.3.0`, `react-dom 19.3.0`, `lucide-react 1.49.0`, `typescript 6.0.3`, `@types/node 26.6.4`, `@types/react 19.3.0`, `@types/react-dom 19.3.0`, `vitest 5.0.3`, `vite 8.3.2`, `@vitejs/plugin-react 6.1.1`, `jsdom 30.1.1`, `@testing-library/react 16.3.3`, `@testing-library/dom 10.4.2`, `@testing-library/jest-dom 7.0.1`, `@testing-library/user-event 14.6.7`. TypeScript 7 ships no JavaScript API, which Next.js needs, so the console stays on 6.0.3.
- Console token key: `smartlib.admin.token`. Request timeout: 60 000 ms.
- `styles/ds.css` is the design system's `styles.css` verbatim, except that its first-line Google Fonts `@import` is removed: Caprasimo and Figtree load through `next/font/google` instead (the spec is updated to match).
- Exact user-facing copy (do not paraphrase):
  - "This account doesn't have admin access."
  - "Your session expired. Log in again."
  - "Can't reach the SmartLib server. Try again in a minute."
  - "Couldn't load dashboard metrics" / "Check your connection and try again." / "Retry"
  - "No activity recorded yet" / "Utilisation, circulation and demand metrics will appear here once bookings and loans start coming in."
  - Card kickers: "Utilisation today", "Circulation, 7 days", "Overdue materials", "Peak demand"
  - Section titles: "Seat & room utilisation, last 7 days", "Top titles, last 7 days", "Resource demand, last 7 days"
  - "Coming soon", "Librarian admin", "Log out", "No resources yet"

## Review Focus

1. **Bookings outside open hours or across midnight.** Only the part inside each day's 9 AM–8 PM window counts. Test: Task 2, `counts only the part of a booking inside open hours` and `counts a booking across midnight only within each day's open hours`.
2. **Render waking from sleep, or the network failing, during the console's session check.** The console must keep the token and offer Retry with the network message, not bounce the admin to the login page or show a blank screen. Test: Task 10, `keeps the token and offers Retry when the server cannot be reached`.
3. **An admin demoted or deleted while logged in.** A 403 from an `/admin` route or a student role from `/auth/me` must clear the token and land on the login page with "This account doesn't have admin access."; a 404 from `/auth/me` must return to the login page. Tests: Task 9, `ends the session on a 403…`; Task 10, `turns away an account that is no longer an admin` and `sends a deleted account to the login page`.
4. **Login submitted twice** (double click, or Enter pressed twice) must send one request. Test: Task 10, `sends one request when submitted twice quickly`.
5. **Spaces around the name or email typed into `create-admin`** must not create a second account that cannot log in. Test: Task 5, `trims spaces around the name and email`.

---

## File Map

**Backend (`backend/`, existing repo)**

| File | Responsibility |
|---|---|
| `src/config/timezone.ts` (new) | `timeZoneWarning(env)`: the startup warning text, or null |
| `src/index.ts` (modify) | Logs that warning at startup |
| `src/services/adminMetrics.ts` (new) | Pure metric arithmetic and library-day helpers |
| `src/services/adminMetricsService.ts` (new) | Loads each metric's rows with Prisma and calls the pure functions |
| `src/routes/admin.ts` (new) | `/admin/*` guard and the four metric routes |
| `src/app.ts` (modify) | Mounts `adminRouter` |
| `src/services/authService.ts` (modify) | Exports `BCRYPT_ROUNDS` |
| `src/services/adminAccountService.ts` (new) | `createOrPromoteAdmin` |
| `scripts/create-admin.ts` (new) | Terminal prompts around `createOrPromoteAdmin` |
| `prisma/history.ts` (new) | `generateHistory`, `mulberry32`, `occupancy`, `HISTORY_SEED` |
| `prisma/seed.ts` (modify) | Room locations, copy bookkeeping, inserts the history |
| `package.json` (modify) | `create-admin` and `typecheck:scripts` scripts |
| `README.md`, `.env.example` (modify) | `TZ`, CORS, admin endpoints, `create-admin`, seed history |
| `test/config/timezone.test.ts`, `test/services/adminMetrics.test.ts`, `test/routes/admin.test.ts`, `test/services/adminAccountService.test.ts`, `test/seed/history.test.ts` (new) | Tests |

**Console (`admin/`, new repo cloned from `https://github.com/Raghav-28-Gupta/smart-lib-admin.git`)**

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `.gitignore`, `.env.example` | Project setup |
| `styles/ds.css`, `styles/console.css` | Design system and canvas console rules |
| `app/layout.tsx`, `app/page.tsx` | Root layout with fonts; redirect to `/dashboard` |
| `lib/format.ts` | Pure display formatting |
| `lib/api.ts` | Fetch wrapper, token storage, session-ended event |
| `lib/session.tsx` | `logIn`, `loginNotice`, `ConsoleGuard`, `useSession` |
| `lib/metrics.ts` | Metric response types, `fetchDashboardMetrics`, `isEmpty` |
| `app/login/page.tsx` | Login page |
| `app/(console)/layout.tsx` | Guard + shell frame |
| `components/Sidebar.tsx`, `components/TopBar.tsx` | Shell |
| `components/dashboard/KpiCard.tsx`, `UtilisationChart.tsx`, `RankedBars.tsx`, `DashboardStates.tsx`, `DashboardView.tsx` | Dashboard pieces |
| `app/(console)/dashboard/page.tsx` | Loads metrics and picks the state |
| `test/**` | Tests, mirroring the source tree |
| `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md` | CI and docs |

---

### Task 1: Server time-zone warning

**Files:**
- Create: `backend/src/config/timezone.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/README.md` (Deploy variables table), `backend/.env.example`
- Test: `backend/test/config/timezone.test.ts`

**Interfaces:**
- Produces: `timeZoneWarning(env: NodeJS.ProcessEnv): string | null`

- [ ] **Step 1: Write the failing test**

Create `backend/test/config/timezone.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { timeZoneWarning } from '../../src/config/timezone'

describe('timeZoneWarning', () => {
  it('warns when production runs without TZ', () => {
    expect(timeZoneWarning({ NODE_ENV: 'production' })).toMatch(/TZ is not set/)
  })

  it('is silent when production sets TZ', () => {
    expect(timeZoneWarning({ NODE_ENV: 'production', TZ: 'Asia/Kolkata' })).toBeNull()
  })

  it('is silent outside production, where the machine already uses local time', () => {
    expect(timeZoneWarning({ NODE_ENV: 'development' })).toBeNull()
    expect(timeZoneWarning({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (in `backend/`): `npx vitest run test/config/timezone.test.ts`
Expected: FAIL, cannot resolve `../../src/config/timezone`.

- [ ] **Step 3: Implement**

Create `backend/src/config/timezone.ts`:

```ts
// Days and booking slots are built in the server's local time zone
// (bookingService.ts, resourceService.ts, adminMetrics.ts). Render runs in
// UTC while the library is in IST, so without TZ every slot shifts by five
// and a half hours. Production must set TZ=Asia/Kolkata (README, "Deploy").
export function timeZoneWarning(env: NodeJS.ProcessEnv): string | null {
  if (env.NODE_ENV === 'production' && !env.TZ) {
    return 'TZ is not set: library days and booking slots will use the server time zone (UTC on Render). Set TZ=Asia/Kolkata.'
  }
  return null
}
```

In `backend/src/index.ts`, add the import after `import { app } from './app'` and the check before `const PORT`:

```ts
import { timeZoneWarning } from './config/timezone'
```

```ts
const tzWarning = timeZoneWarning(process.env)
if (tzWarning) console.warn(tzWarning)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/config/timezone.test.ts` → PASS (3 tests). Then `npx tsc --noEmit -p .` → no output.

- [ ] **Step 5: Document `TZ`**

In `backend/README.md`, in the Deploy variables table, add this row directly after the `| \`NODE_ENV\` | \`production\` |` row:

```markdown
| `TZ` | `Asia/Kolkata`. Days and booking slots use the server's time zone; without it Render uses UTC and every slot is off by 5½ hours |
```

In `backend/.env.example`, add before `PORT=3000`:

```bash
# Production (Render) must set TZ=Asia/Kolkata: days and booking slots use the
# server's time zone. Local machines already run in their own zone.
# TZ=Asia/Kolkata
```

- [ ] **Step 6: Hand off the commit**

Present to the user (do not run):

```bash
git add src/config/timezone.ts src/index.ts test/config/timezone.test.ts README.md .env.example
git commit -m "backend: warn at startup when production runs without TZ" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Booking metrics (pure functions)

**Files:**
- Create: `backend/src/services/adminMetrics.ts`
- Test: `backend/test/services/adminMetrics.test.ts`

**Interfaces:**
- Produces (all exported from `src/services/adminMetrics.ts`):
  - `interface ResourceRow { id: string; type: 'seat' | 'room'; location: string | null }`
  - `interface BookingRow { resourceId: string; startTime: Date; endTime: Date; status: string }`
  - `interface UtilizationDto { today: { date: string; percent: number; lastWeekPercent: number }; days: { date: string; seatPercent: number; roomPercent: number }[] }`
  - `interface DemandDto { areas: { area: string; percent: number; busiestSlot: string | null }[] }`
  - `startOfDay(d: Date): Date`, `addDays(d: Date, offset: number): Date`, `isoDate(d: Date): string`, `windowDays(now: Date): Date[]`
  - `bookedPercent(bookings: BookingRow[], resources: ResourceRow[], days: Date[]): number`
  - `areaOf(r: ResourceRow): string`
  - `computeUtilization(bookings: BookingRow[], resources: ResourceRow[], now: Date): UtilizationDto`
  - `computeDemand(bookings: BookingRow[], resources: ResourceRow[], now: Date): DemandDto`

- [ ] **Step 1: Write the failing tests**

Create `backend/test/services/adminMetrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  addDays,
  areaOf,
  bookedPercent,
  computeDemand,
  computeUtilization,
  isoDate,
  startOfDay,
  windowDays,
  type BookingRow,
  type ResourceRow,
} from '../../src/services/adminMetrics'

// Thursday 15 Oct 2026, 1 PM library time. Everything is built with local-time
// constructors, so these tests pass in any machine time zone.
const NOW = new Date(2026, 9, 15, 13, 0)
const TODAY = startOfDay(NOW)
const at = (day: Date, hour: number, minute = 0) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
const booking = (resourceId: string, day: Date, fromHour: number, toHour: number, status = 'booked'): BookingRow => ({
  resourceId,
  startTime: at(day, fromHour),
  endTime: at(day, toHour),
  status,
})
const seat = (id: string, location: string | null = 'Silent Zone'): ResourceRow => ({ id, type: 'seat', location })
const room = (id: string, location: string | null = null): ResourceRow => ({ id, type: 'room', location })

describe('library days', () => {
  it('windowDays lists the 7 days ending today, oldest first', () => {
    expect(windowDays(NOW).map(isoDate)).toEqual([
      '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
    ])
  })
})

describe('bookedPercent', () => {
  it('is booked hours over open hours, 11 per resource per day', () => {
    // 2 of 11 open hours -> 18%
    expect(bookedPercent([booking('s1', TODAY, 10, 11), booking('s1', TODAY, 15, 16)], [seat('s1')], [TODAY])).toBe(18)
  })

  it('ignores cancelled bookings and bookings on other resources or days', () => {
    const bookings = [
      booking('s1', TODAY, 10, 11, 'cancelled'),
      booking('s2', TODAY, 10, 11),
      booking('s1', addDays(TODAY, -1), 10, 11),
    ]
    expect(bookedPercent(bookings, [seat('s1')], [TODAY])).toBe(0)
  })

  it('counts a no-show, which stays booked, the same as a check-in', () => {
    const bookings = [booking('s1', TODAY, 10, 11, 'booked'), booking('s1', TODAY, 11, 12, 'checked_in')]
    expect(bookedPercent(bookings, [seat('s1')], [TODAY])).toBe(18)
  })

  it('counts only the part of a booking inside open hours', () => {
    // 8:30-9:30 adds half an hour, 19:30-21:00 adds half an hour: 1 of 11 -> 9%
    const early: BookingRow = { resourceId: 's1', startTime: at(TODAY, 8, 30), endTime: at(TODAY, 9, 30), status: 'booked' }
    const late: BookingRow = { resourceId: 's1', startTime: at(TODAY, 19, 30), endTime: at(TODAY, 21), status: 'booked' }
    expect(bookedPercent([early, late], [seat('s1')], [TODAY])).toBe(9)
  })

  it("counts a booking across midnight only within each day's open hours", () => {
    // Today 19:00-20:00 is open (1 h); tomorrow 9:00-10:00 is open (1 h).
    const overnight: BookingRow = {
      resourceId: 's1', startTime: at(TODAY, 19), endTime: at(addDays(TODAY, 1), 10), status: 'booked',
    }
    expect(bookedPercent([overnight], [seat('s1')], [TODAY])).toBe(9)
    expect(bookedPercent([overnight], [seat('s1')], [addDays(TODAY, 1)])).toBe(9)
  })

  it('is 0 when there are no resources', () => {
    expect(bookedPercent([], [], [TODAY])).toBe(0)
  })
})

describe('computeUtilization', () => {
  const resources = [seat('s1'), seat('s2'), room('r1')]

  it("reports today's booked share, including bookings later today", () => {
    // NOW is 1 PM; the 6 PM booking is still ahead but already booked. 3 of 33 h -> 9%
    const u = computeUtilization([booking('s1', TODAY, 18, 19), booking('r1', TODAY, 10, 12)], resources, NOW)
    expect(u.today).toEqual({ date: '2026-10-15', percent: 9, lastWeekPercent: 0 })
  })

  it('compares with the same weekday last week', () => {
    // 11 of 33 open hours on 8 Oct -> 33%
    const u = computeUtilization([booking('s1', addDays(TODAY, -7), 9, 20)], resources, NOW)
    expect(u.today.lastWeekPercent).toBe(33)
  })

  it('splits the last 7 days into seats and rooms, oldest first', () => {
    const u = computeUtilization([booking('s1', addDays(TODAY, -6), 9, 20), booking('r1', TODAY, 14, 16)], resources, NOW)
    expect(u.days).toHaveLength(7)
    expect(u.days[0]).toEqual({ date: '2026-10-09', seatPercent: 50, roomPercent: 0 }) // 11 of 22 seat hours
    expect(u.days[6]).toEqual({ date: '2026-10-15', seatPercent: 0, roomPercent: 18 }) // 2 of 11 room hours
  })
})

describe('computeDemand', () => {
  it('groups resources by location, falling back to Seats or Rooms', () => {
    expect(areaOf(seat('s1', 'Reading Room A'))).toBe('Reading Room A')
    expect(areaOf(seat('s1', null))).toBe('Seats')
    expect(areaOf(room('r1', null))).toBe('Rooms')
  })

  it("reports each area's 7-day booked share and busiest slot, busiest area first", () => {
    const resources = [seat('s1', 'Silent Zone'), room('r1', 'Group study rooms'), room('r2', 'Group study rooms')]
    const bookings = [
      booking('s1', TODAY, 9, 10),
      booking('r1', TODAY, 14, 16), // 2 PM and 3 PM
      booking('r2', addDays(TODAY, -1), 14, 15), // 2 PM again
      booking('r2', addDays(TODAY, -2), 10, 11, 'cancelled'),
    ]
    expect(computeDemand(bookings, resources, NOW).areas).toEqual([
      { area: 'Group study rooms', percent: 2, busiestSlot: '2:00 PM' }, // 3 of 154 h
      { area: 'Silent Zone', percent: 1, busiestSlot: '9:00 AM' }, // 1 of 77 h
    ])
  })

  it('breaks ties toward the earliest slot, and has no busiest slot without bookings', () => {
    const resources = [seat('s1', 'Silent Zone'), seat('s2', 'Reading Room A')]
    const bookings = [booking('s1', TODAY, 15, 16), booking('s1', TODAY, 11, 12)]
    expect(computeDemand(bookings, resources, NOW).areas).toEqual([
      { area: 'Silent Zone', percent: 3, busiestSlot: '11:00 AM' }, // 2 of 77 h
      { area: 'Reading Room A', percent: 0, busiestSlot: null },
    ])
  })

  it('orders areas with equal shares by name', () => {
    const resources = [seat('a', 'Zeta wing'), seat('b', 'Alpha wing')]
    expect(computeDemand([], resources, NOW).areas.map((a) => a.area)).toEqual(['Alpha wing', 'Zeta wing'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/services/adminMetrics.test.ts`
Expected: FAIL, cannot resolve `../../src/services/adminMetrics`.

- [ ] **Step 3: Implement**

Create `backend/src/services/adminMetrics.ts`:

```ts
// Pure arithmetic behind the admin Dashboard (GET /admin/metrics/*). Each
// function takes rows already loaded for its window plus "now", and returns
// a response body. Everything uses library time: the server's local time
// zone, which production sets with TZ=Asia/Kolkata (config/timezone.ts).
import { TIME_SLOTS } from '../config/constants'

export interface ResourceRow {
  id: string
  type: 'seat' | 'room'
  location: string | null
}

export interface BookingRow {
  resourceId: string
  startTime: Date
  endTime: Date
  status: string
}

export interface UtilizationDto {
  today: { date: string; percent: number; lastWeekPercent: number }
  days: { date: string; seatPercent: number; roomPercent: number }[]
}

export interface DemandDto {
  areas: { area: string; percent: number; busiestSlot: string | null }[]
}

const HOUR_MS = 60 * 60 * 1000
export const WINDOW_DAYS = 7

/** Midnight at the start of `d`'s day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Midnight of the day `offset` days from `d`'s day (negative goes back). */
export function addDays(d: Date, offset: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset)
}

/** 'YYYY-MM-DD' for `d`'s day. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The 7 days ending on `now`'s day, oldest first. */
export function windowDays(now: Date): Date[] {
  const today = startOfDay(now)
  return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i - (WINDOW_DAYS - 1)))
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.round((100 * part) / whole)) : 0
}

function overlapHours(b: BookingRow, from: Date, to: Date): number {
  const ms = Math.min(b.endTime.getTime(), to.getTime()) - Math.max(b.startTime.getTime(), from.getTime())
  return ms > 0 ? ms / HOUR_MS : 0
}

/**
 * Booked hours per slot label for these resources over these days. Cancelled
 * bookings don't count; anything outside the open slots never counts.
 */
function bookedHoursBySlot(bookings: BookingRow[], resourceIds: Set<string>, days: Date[]): Map<string, number> {
  const bySlot = new Map<string, number>(TIME_SLOTS.map((s) => [s.label, 0]))
  for (const b of bookings) {
    if (b.status === 'cancelled' || !resourceIds.has(b.resourceId)) continue
    for (const day of days) {
      for (const slot of TIME_SLOTS) {
        const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.hour)
        const to = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.hour + 1)
        const hours = overlapHours(b, from, to)
        if (hours > 0) bySlot.set(slot.label, (bySlot.get(slot.label) ?? 0) + hours)
      }
    }
  }
  return bySlot
}

function total(bySlot: Map<string, number>): number {
  let sum = 0
  for (const hours of bySlot.values()) sum += hours
  return sum
}

/** Booked share (0-100) of these resources' open hours over these days. */
export function bookedPercent(bookings: BookingRow[], resources: ResourceRow[], days: Date[]): number {
  const bySlot = bookedHoursBySlot(bookings, new Set(resources.map((r) => r.id)), days)
  return percent(total(bySlot), resources.length * TIME_SLOTS.length * days.length)
}

export function computeUtilization(bookings: BookingRow[], resources: ResourceRow[], now: Date): UtilizationDto {
  const today = startOfDay(now)
  const seats = resources.filter((r) => r.type === 'seat')
  const rooms = resources.filter((r) => r.type === 'room')
  return {
    today: {
      date: isoDate(today),
      percent: bookedPercent(bookings, resources, [today]),
      lastWeekPercent: bookedPercent(bookings, resources, [addDays(today, -WINDOW_DAYS)]),
    },
    days: windowDays(now).map((day) => ({
      date: isoDate(day),
      seatPercent: bookedPercent(bookings, seats, [day]),
      roomPercent: bookedPercent(bookings, rooms, [day]),
    })),
  }
}

/** The area a resource belongs to on the demand chart. */
export function areaOf(r: ResourceRow): string {
  return r.location ?? (r.type === 'seat' ? 'Seats' : 'Rooms')
}

export function computeDemand(bookings: BookingRow[], resources: ResourceRow[], now: Date): DemandDto {
  const days = windowDays(now)
  const byArea = new Map<string, ResourceRow[]>()
  for (const r of resources) byArea.set(areaOf(r), [...(byArea.get(areaOf(r)) ?? []), r])

  const areas = [...byArea].map(([area, members]) => {
    const bySlot = bookedHoursBySlot(bookings, new Set(members.map((r) => r.id)), days)
    let busiestSlot: string | null = null
    let busiestHours = 0
    // TIME_SLOTS is in time order, so a tie keeps the earliest slot.
    for (const slot of TIME_SLOTS) {
      const hours = bySlot.get(slot.label) ?? 0
      if (hours > busiestHours) {
        busiestSlot = slot.label
        busiestHours = hours
      }
    }
    return { area, percent: percent(total(bySlot), members.length * TIME_SLOTS.length * days.length), busiestSlot }
  })
  areas.sort((a, b) => b.percent - a.percent || a.area.localeCompare(b.area))
  return { areas }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/adminMetrics.test.ts` → PASS (14 tests). Then `npx tsc --noEmit -p .` → no output.

- [ ] **Step 5: Hand off the commit**

```bash
git add src/services/adminMetrics.ts test/services/adminMetrics.test.ts
git commit -m "backend: compute utilisation and demand metrics" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Loan metrics (pure functions)

**Files:**
- Modify: `backend/src/services/adminMetrics.ts` (append)
- Modify: `backend/test/services/adminMetrics.test.ts` (append)

**Interfaces:**
- Consumes: `startOfDay`, `addDays`, `windowDays` from Task 2.
- Produces:
  - `interface LoanRow { bookId: string; title: string; borrowedAt: Date; dueAt: Date; returnedAt: Date | null }`
  - `interface CirculationDto { borrows: number; returns: number; topTitles: { bookId: string; title: string; borrows: number }[] }`
  - `interface OverdueDto { count: number; countYesterday: number }`
  - `computeCirculation(loans: LoanRow[], now: Date): CirculationDto`
  - `overdueAt(loans: LoanRow[], t: Date): number`
  - `computeOverdue(loans: LoanRow[], now: Date): OverdueDto`

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/services/adminMetrics.test.ts`. Add `computeCirculation`, `computeOverdue` and `type LoanRow` to the existing import list from `../../src/services/adminMetrics`, then append:

```ts
const loan = (over: Partial<LoanRow>): LoanRow => ({
  bookId: 'b1',
  title: 'Introduction to Algorithms',
  borrowedAt: at(TODAY, 10),
  dueAt: at(addDays(TODAY, 14), 10),
  returnedAt: null,
  ...over,
})

describe('computeCirculation', () => {
  it('counts borrows and returns from the start of the 7-day window up to now', () => {
    const loans = [
      loan({ borrowedAt: at(addDays(TODAY, -6), 0, 0) }), // first moment of the window: counts
      loan({ borrowedAt: at(addDays(TODAY, -7), 23, 59) }), // the evening before: doesn't
      loan({ borrowedAt: at(addDays(TODAY, -10), 10), returnedAt: at(addDays(TODAY, -2), 12) }), // a return only
      loan({ borrowedAt: at(addDays(TODAY, -3), 10), returnedAt: at(addDays(TODAY, -1), 12) }), // both
    ]
    expect(computeCirculation(loans, NOW)).toMatchObject({ borrows: 2, returns: 2 })
  })

  it('ranks up to 5 titles by borrows, ties by title', () => {
    const counts: [string, string, number][] = [
      ['b1', 'Introduction to Algorithms', 3],
      ['b8', 'Clean Code', 3],
      ['b3', 'Database System Concepts', 2],
      ['b4', 'Computer Networks', 1],
      ['b5', 'Data Structures and Algorithms in Java', 1],
      ['b6', 'Design Patterns', 1],
    ]
    const loans = counts.flatMap(([bookId, title, n]) => Array.from({ length: n }, () => loan({ bookId, title })))
    expect(computeCirculation(loans, NOW).topTitles).toEqual([
      { bookId: 'b8', title: 'Clean Code', borrows: 3 },
      { bookId: 'b1', title: 'Introduction to Algorithms', borrows: 3 },
      { bookId: 'b3', title: 'Database System Concepts', borrows: 2 },
      { bookId: 'b4', title: 'Computer Networks', borrows: 1 },
      { bookId: 'b5', title: 'Data Structures and Algorithms in Java', borrows: 1 },
    ])
  })
})

describe('computeOverdue', () => {
  it('counts unreturned loans past due now, and as of exactly 24 hours earlier', () => {
    const loans = [
      loan({ borrowedAt: at(addDays(TODAY, -17), 10), dueAt: at(addDays(TODAY, -3), 10) }), // both
      loan({ borrowedAt: at(addDays(TODAY, -14), 18), dueAt: at(TODAY, 1) }), // now only
      loan({ borrowedAt: at(addDays(TODAY, -14), 19), dueAt: at(TODAY, 2) }), // now only
      // Returned this morning: overdue yesterday, not now.
      loan({ borrowedAt: at(addDays(TODAY, -20), 10), dueAt: at(addDays(TODAY, -6), 10), returnedAt: at(TODAY, 9) }),
      loan({ borrowedAt: at(addDays(TODAY, -2), 10), dueAt: at(addDays(TODAY, 12), 10) }), // not due
    ]
    expect(computeOverdue(loans, NOW)).toEqual({ count: 3, countYesterday: 2 })
  })

  it('ignores a loan borrowed after the moment being measured', () => {
    const loans = [loan({ borrowedAt: at(TODAY, 1), dueAt: at(TODAY, 2) })]
    expect(computeOverdue(loans, NOW)).toEqual({ count: 1, countYesterday: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/services/adminMetrics.test.ts`
Expected: FAIL, `computeCirculation` and `computeOverdue` are not exported.

- [ ] **Step 3: Implement**

Append to `backend/src/services/adminMetrics.ts`:

```ts
export interface LoanRow {
  bookId: string
  title: string
  borrowedAt: Date
  dueAt: Date
  returnedAt: Date | null
}

export interface CirculationDto {
  borrows: number
  returns: number
  topTitles: { bookId: string; title: string; borrows: number }[]
}

export interface OverdueDto {
  count: number
  countYesterday: number
}

const TOP_TITLES = 5

export function computeCirculation(loans: LoanRow[], now: Date): CirculationDto {
  const from = windowDays(now)[0]
  const inWindow = (d: Date | null) => d !== null && d >= from && d <= now
  const byBook = new Map<string, { bookId: string; title: string; borrows: number }>()
  let borrows = 0
  let returns = 0
  for (const l of loans) {
    if (inWindow(l.borrowedAt)) {
      borrows++
      const entry = byBook.get(l.bookId) ?? { bookId: l.bookId, title: l.title, borrows: 0 }
      entry.borrows++
      byBook.set(l.bookId, entry)
    }
    if (inWindow(l.returnedAt)) returns++
  }
  const topTitles = [...byBook.values()]
    .sort((a, b) => b.borrows - a.borrows || a.title.localeCompare(b.title))
    .slice(0, TOP_TITLES)
  return { borrows, returns, topTitles }
}

/** Loans that were out and past due at the moment `t`. */
export function overdueAt(loans: LoanRow[], t: Date): number {
  return loans.filter((l) => l.borrowedAt <= t && (l.returnedAt === null || l.returnedAt > t) && l.dueAt < t).length
}

export function computeOverdue(loans: LoanRow[], now: Date): OverdueDto {
  return { count: overdueAt(loans, now), countYesterday: overdueAt(loans, new Date(now.getTime() - 24 * HOUR_MS)) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/adminMetrics.test.ts` → PASS (18 tests). Then `npx tsc --noEmit -p .` → no output.

- [ ] **Step 5: Hand off the commit**

```bash
git add src/services/adminMetrics.ts test/services/adminMetrics.test.ts
git commit -m "backend: compute circulation and overdue metrics" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin metric endpoints

**Files:**
- Create: `backend/src/services/adminMetricsService.ts`, `backend/src/routes/admin.ts`
- Modify: `backend/src/app.ts`, `backend/README.md` (Endpoints table, CORS row), `backend/.env.example`
- Test: `backend/test/routes/admin.test.ts`

**Interfaces:**
- Consumes: everything Tasks 2 and 3 export; `requireAuth`, `requireAdmin` from `src/middleware/requireAuth.ts`.
- Produces: `GET /admin/metrics/utilization`, `/circulation`, `/overdue`, `/demand` returning `UtilizationDto`, `CirculationDto`, `OverdueDto`, `DemandDto`. No token → 401 `{ error }`; non-admin → 403 `{ error: 'Admin access required' }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/routes/admin.test.ts`:

```ts
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app'
import { JWT_SECRET } from '../../src/config/constants'
import { prisma } from '../../src/lib/prisma'
import { startOfDay } from '../../src/services/adminMetrics'
import { resetDb } from '../helpers/db'

const ENDPOINTS = ['utilization', 'circulation', 'overdue', 'demand'].map((m) => `/admin/metrics/${m}`)
const DAY_MS = 24 * 60 * 60 * 1000

async function tokenFor(role: 'student' | 'admin') {
  const user = await prisma.user.create({
    data: { name: `${role} ${Math.random()}`, email: `${role}${Math.random()}@test.com`, passwordHash: 'x', role },
  })
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' })
}

const at = (day: Date, hour: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour)

describe('admin metrics access', () => {
  beforeEach(resetDb)

  it.each(ENDPOINTS)('%s refuses a request without a token (401)', async (path) => {
    const res = await request(app).get(path)
    expect(res.status).toBe(401)
  })

  it.each(ENDPOINTS)('%s refuses a student (403)', async (path) => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${await tokenFor('student')}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Admin access required')
  })

  it.each(ENDPOINTS)('%s answers an admin (200)', async (path) => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${await tokenFor('admin')}`)
    expect(res.status).toBe(200)
  })
})

describe('admin metrics values', () => {
  beforeEach(resetDb)

  it('computes all four metrics from the database', async () => {
    const token = await tokenFor('admin')
    const today = startOfDay(new Date())
    const now = Date.now()
    const student = await prisma.user.create({ data: { name: 'S', email: `s${Math.random()}@test.com`, passwordHash: 'x' } })

    const desk = await prisma.resource.create({ data: { type: 'seat', name: 'Desk 1', location: 'Silent Zone' } })
    await prisma.resourceBooking.create({
      data: { userId: student.id, resourceId: desk.id, startTime: at(today, 14), endTime: at(today, 15) },
    })
    await prisma.resourceBooking.create({
      data: { userId: student.id, resourceId: desk.id, startTime: at(today, 10), endTime: at(today, 11), status: 'cancelled' },
    })

    const book = await prisma.book.create({
      data: { isbn: `isbn-${Math.random()}`, title: 'Clean Code', author: 'Robert C. Martin', totalCopies: 3 },
    })
    const copies = await Promise.all(
      [0, 1, 2].map(() => prisma.bookCopy.create({ data: { bookId: book.id, status: 'borrowed' } })),
    )
    // Borrowed this week, still out.
    await prisma.loan.create({
      data: { userId: student.id, bookCopyId: copies[0].id, borrowedAt: new Date(now - 2 * DAY_MS), dueAt: new Date(now + 12 * DAY_MS) },
    })
    // Returned this week.
    await prisma.loan.create({
      data: {
        userId: student.id, bookCopyId: copies[1].id, borrowedAt: new Date(now - 10 * DAY_MS),
        dueAt: new Date(now + 4 * DAY_MS), returnedAt: new Date(now - DAY_MS), status: 'returned',
      },
    })
    // Overdue for 3 days.
    await prisma.loan.create({
      data: { userId: student.id, bookCopyId: copies[2].id, borrowedAt: new Date(now - 17 * DAY_MS), dueAt: new Date(now - 3 * DAY_MS) },
    })

    const get = (metric: string) => request(app).get(`/admin/metrics/${metric}`).set('Authorization', `Bearer ${token}`)
    const [u, c, o, d] = await Promise.all(['utilization', 'circulation', 'overdue', 'demand'].map(get))

    // 1 of 11 open hours; the cancelled booking doesn't count.
    expect(u.body.today.percent).toBe(9)
    expect(u.body.days).toHaveLength(7)
    expect(u.body.days[6]).toMatchObject({ seatPercent: 9, roomPercent: 0 })
    expect(c.body).toEqual({ borrows: 1, returns: 1, topTitles: [{ bookId: book.id, title: 'Clean Code', borrows: 1 }] })
    expect(o.body).toEqual({ count: 1, countYesterday: 1 })
    expect(d.body).toEqual({ areas: [{ area: 'Silent Zone', percent: 1, busiestSlot: '2:00 PM' }] }) // 1 of 77 h
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes/admin.test.ts`
Expected: FAIL. The 401 cases pass by accident only if something answers 401; most cases fail with 404 because the routes don't exist.

- [ ] **Step 3: Implement the loaders**

Create `backend/src/services/adminMetricsService.ts`:

```ts
// Loads the rows each admin metric needs, for its window only, and hands
// them to the pure functions in adminMetrics.ts.
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import {
  addDays,
  computeCirculation,
  computeDemand,
  computeOverdue,
  computeUtilization,
  startOfDay,
  windowDays,
  type CirculationDto,
  type DemandDto,
  type LoanRow,
  type OverdueDto,
  type UtilizationDto,
} from './adminMetrics'

async function resourcesAndBookings(from: Date, to: Date) {
  const [resources, bookings] = await Promise.all([
    prisma.resource.findMany({ select: { id: true, type: true, location: true } }),
    prisma.resourceBooking.findMany({
      where: { status: { not: 'cancelled' }, startTime: { lt: to }, endTime: { gt: from } },
      select: { resourceId: true, startTime: true, endTime: true, status: true },
    }),
  ])
  return { resources, bookings }
}

async function loadLoans(where: Prisma.LoanWhereInput): Promise<LoanRow[]> {
  const rows = await prisma.loan.findMany({
    where,
    select: {
      borrowedAt: true,
      dueAt: true,
      returnedAt: true,
      bookCopy: { select: { book: { select: { id: true, title: true } } } },
    },
  })
  return rows.map((r) => ({
    bookId: r.bookCopy.book.id,
    title: r.bookCopy.book.title,
    borrowedAt: r.borrowedAt,
    dueAt: r.dueAt,
    returnedAt: r.returnedAt,
  }))
}

export async function getUtilization(now = new Date()): Promise<UtilizationDto> {
  // From the same weekday last week through the end of today.
  const today = startOfDay(now)
  const { resources, bookings } = await resourcesAndBookings(addDays(today, -7), addDays(today, 1))
  return computeUtilization(bookings, resources, now)
}

export async function getDemand(now = new Date()): Promise<DemandDto> {
  const { resources, bookings } = await resourcesAndBookings(windowDays(now)[0], addDays(startOfDay(now), 1))
  return computeDemand(bookings, resources, now)
}

export async function getCirculation(now = new Date()): Promise<CirculationDto> {
  const from = windowDays(now)[0]
  const loans = await loadLoans({ OR: [{ borrowedAt: { gte: from } }, { returnedAt: { gte: from } }] })
  return computeCirculation(loans, now)
}

export async function getOverdue(now = new Date()): Promise<OverdueDto> {
  // Anything overdue now or 24 hours ago was due before now, and was either
  // still out or returned after that earlier moment.
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const loans = await loadLoans({ dueAt: { lt: now }, OR: [{ returnedAt: null }, { returnedAt: { gt: dayAgo } }] })
  return computeOverdue(loans, now)
}
```

- [ ] **Step 4: Implement the routes and mount them**

Create `backend/src/routes/admin.ts`:

```ts
import { Router } from 'express'
import { requireAdmin, requireAuth } from '../middleware/requireAuth'
import { getCirculation, getDemand, getOverdue, getUtilization } from '../services/adminMetricsService'

export const adminRouter = Router()

// Every /admin route needs a valid token (401) and the admin role (403).
// Guarding the prefix once means a later admin route can't forget it.
adminRouter.use('/admin', requireAuth, requireAdmin)

adminRouter.get('/admin/metrics/utilization', async (req, res) => {
  res.json(await getUtilization())
})

adminRouter.get('/admin/metrics/circulation', async (req, res) => {
  res.json(await getCirculation())
})

adminRouter.get('/admin/metrics/overdue', async (req, res) => {
  res.json(await getOverdue())
})

adminRouter.get('/admin/metrics/demand', async (req, res) => {
  res.json(await getDemand())
})
```

In `backend/src/app.ts`, add `import { adminRouter } from './routes/admin'` with the other router imports, and `app.use(adminRouter)` directly after `app.use(recommendationsRouter)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/routes/admin.test.ts` → PASS (13 tests). Then `npx tsc --noEmit -p .` → no output.

- [ ] **Step 6: Run the whole backend suite**

Run: `npx vitest run` → all files pass (the previous 118 tests plus this slice's new ones).

- [ ] **Step 7: Document the endpoints and the console's origin**

In `backend/README.md`, Endpoints table, insert after the `/recommendations/me` row:

```markdown
| GET | `/admin/metrics/utilization` | admin | Booked share of open hours: today, the same weekday last week, and seats/rooms for the last 7 days |
| GET | `/admin/metrics/circulation` | admin | Borrows, returns and top 5 titles over the last 7 days |
| GET | `/admin/metrics/overdue` | admin | Loans overdue now and 24 hours ago |
| GET | `/admin/metrics/demand` | admin | Booked share and busiest slot per area over the last 7 days |
```

Add this paragraph directly after the table:

```markdown
`admin` routes need a token for an account with the admin role: 401 without a
token, 403 for a student. Admin accounts are created with `npm run create-admin`
(see *Admin accounts*). The metric definitions are in
`../docs/superpowers/specs/2026-10-15-admin-console-slice1-design.md` and in
`src/services/adminMetrics.ts`.
```

In the Deploy variables table, replace the `CORS_ORIGINS` row with:

```markdown
| `CORS_ORIGINS` | Browser origins, comma-separated: the student web app `https://raghav-28-gupta.github.io` and the admin console's Vercel origin |
```

In `backend/.env.example`, replace the line `#   CORS_ORIGINS=https://raghav-28-gupta.github.io` with:

```bash
#   CORS_ORIGINS=https://raghav-28-gupta.github.io,https://<admin console>.vercel.app
```

- [ ] **Step 8: Hand off the commit**

```bash
git add src/services/adminMetricsService.ts src/routes/admin.ts src/app.ts test/routes/admin.test.ts README.md .env.example
git commit -m "backend: add admin metric endpoints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `create-admin`

**Files:**
- Modify: `backend/src/services/authService.ts` (export `BCRYPT_ROUNDS`)
- Create: `backend/src/services/adminAccountService.ts`, `backend/scripts/create-admin.ts`
- Modify: `backend/package.json`, `backend/README.md`
- Test: `backend/test/services/adminAccountService.test.ts`

**Interfaces:**
- Consumes: `registerSchema` from `src/schemas/auth.ts`.
- Produces: `type AdminAccountResult = 'created' | 'promoted' | 'declined'`; `createOrPromoteAdmin(input: { name: string; email: string; password: string }, confirmPromote: () => Promise<boolean>): Promise<AdminAccountResult>`; `BCRYPT_ROUNDS` exported from `authService.ts`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/services/adminAccountService.test.ts`:

```ts
import bcrypt from 'bcrypt'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app'
import { prisma } from '../../src/lib/prisma'
import { createOrPromoteAdmin } from '../../src/services/adminAccountService'
import { resetDb } from '../helpers/db'

const yes = async () => true
const no = async () => false

describe('createOrPromoteAdmin', () => {
  beforeEach(resetDb)

  it('creates an admin who can log in', async () => {
    expect(await createOrPromoteAdmin({ name: 'Librarian', email: 'lib@thapar.edu', password: 'correct horse' }, no)).toBe('created')
    const res = await request(app).post('/auth/login').send({ email: 'lib@thapar.edu', password: 'correct horse' })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ name: 'Librarian', role: 'admin' })
  })

  it('trims spaces around the name and email', async () => {
    await createOrPromoteAdmin({ name: '  Librarian ', email: ' lib@thapar.edu ', password: 'correct horse' }, no)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'lib@thapar.edu' } })
    expect(user.name).toBe('Librarian')
  })

  it('does not ask for confirmation when the email is new', async () => {
    let asked = false
    await createOrPromoteAdmin({ name: 'Librarian', email: 'lib@thapar.edu', password: 'correct horse' }, async () => {
      asked = true
      return true
    })
    expect(asked).toBe(false)
  })

  it('promotes an existing account after confirmation, keeping its name and setting the new password', async () => {
    await prisma.user.create({ data: { name: 'Aditi', email: 'a@thapar.edu', passwordHash: await bcrypt.hash('old password', 10) } })
    expect(await createOrPromoteAdmin({ name: 'Ignored', email: 'a@thapar.edu', password: 'new password' }, yes)).toBe('promoted')
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'a@thapar.edu' } })
    expect(user).toMatchObject({ name: 'Aditi', role: 'admin' })
    expect(await bcrypt.compare('new password', user.passwordHash)).toBe(true)
  })

  it('changes nothing when promotion is declined', async () => {
    await prisma.user.create({ data: { name: 'Aditi', email: 'a@thapar.edu', passwordHash: await bcrypt.hash('old password', 10) } })
    expect(await createOrPromoteAdmin({ name: 'Aditi', email: 'a@thapar.edu', password: 'new password' }, no)).toBe('declined')
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'a@thapar.edu' } })
    expect(user.role).toBe('student')
    expect(await bcrypt.compare('old password', user.passwordHash)).toBe(true)
  })

  it('rejects a short password and creates nothing', async () => {
    await expect(createOrPromoteAdmin({ name: 'L', email: 'lib@thapar.edu', password: 'short' }, yes)).rejects.toThrow(
      'Password must be at least 8 characters',
    )
    expect(await prisma.user.count()).toBe(0)
  })

  it('rejects an invalid email', async () => {
    await expect(createOrPromoteAdmin({ name: 'L', email: 'not-an-email', password: 'correct horse' }, yes)).rejects.toThrow()
    expect(await prisma.user.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/services/adminAccountService.test.ts`
Expected: FAIL, cannot resolve `../../src/services/adminAccountService`.

- [ ] **Step 3: Implement the service**

In `backend/src/services/authService.ts`, change `const BCRYPT_ROUNDS = 10` to `export const BCRYPT_ROUNDS = 10`.

Create `backend/src/services/adminAccountService.ts`:

```ts
import bcrypt from 'bcrypt'
import { prisma } from '../lib/prisma'
import { registerSchema } from '../schemas/auth'
import { BCRYPT_ROUNDS } from './authService'

export type AdminAccountResult = 'created' | 'promoted' | 'declined'

/**
 * Makes `email` an admin. A new email gets a new admin account. An existing
 * account is promoted, and its password replaced, only if `confirmPromote`
 * resolves true; its name is kept. Inputs follow the registration rules.
 * Used by scripts/create-admin.ts; public registration never creates admins.
 */
export async function createOrPromoteAdmin(
  input: { name: string; email: string; password: string },
  confirmPromote: () => Promise<boolean>,
): Promise<AdminAccountResult> {
  const parsed = registerSchema.safeParse({ name: input.name.trim(), email: input.email.trim(), password: input.password })
  if (!parsed.success) throw new Error(parsed.error.issues[0].message)
  const { name, email, password } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing && !(await confirmPromote())) return 'declined'

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  if (!existing) {
    await prisma.user.create({ data: { name, email, passwordHash, role: 'admin' } })
    return 'created'
  }
  await prisma.user.update({ where: { id: existing.id }, data: { role: 'admin', passwordHash } })
  return 'promoted'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/adminAccountService.test.ts` → PASS (7 tests). Then `npx tsc --noEmit -p .` → no output.

- [ ] **Step 5: Add the terminal script**

Create `backend/scripts/create-admin.ts`:

```ts
// Creates an admin account, or promotes an existing one, from a terminal.
// Production: set DATABASE_URL to the production connection string in this
// terminal only (dotenv never overrides a variable that's already set).
import 'dotenv/config'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { prisma } from '../src/lib/prisma'
import { createOrPromoteAdmin } from '../src/services/adminAccountService'

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

/** Reads a line without echoing it, so the password never appears on screen. */
function askHidden(question: string): Promise<string> {
  stdout.write(question)
  return new Promise((resolve) => {
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          resolve(value)
          return
        }
        if (ch === '\u0003') {
          stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  if (!stdin.isTTY) {
    console.error('Run create-admin in an interactive terminal: it needs to read a password without echoing it.')
    process.exitCode = 1
    return
  }
  const name = await ask('Name: ')
  const email = await ask('Email: ')
  const password = await askHidden('Password (at least 8 characters): ')
  const again = await askHidden('Password again: ')
  if (password !== again) {
    console.error('The passwords do not match. Nothing was changed.')
    process.exitCode = 1
    return
  }
  const result = await createOrPromoteAdmin({ name, email, password }, async () => {
    const answer = await ask('An account with this email exists. Make it an admin and set this password? (y/N) ')
    return answer.trim().toLowerCase() === 'y'
  })
  const messages = {
    created: `Created admin account ${email.trim()}.`,
    promoted: `${email.trim()} is now an admin, with the new password.`,
    declined: 'Nothing was changed.',
  }
  console.log(messages[result])
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
```

In `backend/package.json` `scripts`, add after `"seed"`:

```json
"create-admin": "tsx scripts/create-admin.ts",
"typecheck:scripts": "tsc --noEmit --target ES2022 --module NodeNext --moduleResolution nodenext --esModuleInterop --strict --skipLibCheck --ignoreConfig scripts/create-admin.ts",
```

- [ ] **Step 6: Verify the script compiles**

Run: `npm run typecheck:scripts` → no output. (The prompts need a real terminal, so the interactive run happens in Task 13 and in the owner's production step.)

- [ ] **Step 7: Document admin accounts**

In `backend/README.md`, insert this section directly before `## Run`:

````markdown
## Admin accounts

The admin console (`../admin`) only lets in accounts with the admin role.
Public registration never creates one, and the seed doesn't either, because
the seed is also run against production. Create one per database:

```bash
npm run create-admin
```

It asks for a name, email and password (typed twice, not shown). If the email
already belongs to an account, it asks before making that account an admin and
setting the new password; the account keeps its name.

For production, point this terminal only at the production database first:

```powershell
$env:DATABASE_URL = '<production direct connection string>'
npm run create-admin
Remove-Item Env:DATABASE_URL
```
````

- [ ] **Step 8: Hand off the commit**

```bash
git add src/services/authService.ts src/services/adminAccountService.ts scripts/create-admin.ts package.json test/services/adminAccountService.test.ts README.md
git commit -m "backend: add create-admin script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Seed history

**Files:**
- Create: `backend/prisma/history.ts`
- Modify: `backend/prisma/seed.ts`, `backend/README.md` (Seed data)
- Test: `backend/test/seed/history.test.ts`

**Interfaces:**
- Consumes: `TIME_SLOTS`, `LOAN_PERIOD_DAYS` from `src/config/constants.ts`.
- Produces (from `prisma/history.ts`): `HISTORY_DAYS = 28`, `HISTORY_SEED = 20261015`, `mulberry32(seed: number): () => number`, `occupancy(type: 'seat' | 'room', weekday: number, hour: number): number`, `interface HistoryInputs`, `interface HistoryBooking`, `interface HistoryLoan`, `generateHistory(today: Date, random: () => number, inputs: HistoryInputs): { bookings: HistoryBooking[]; loans: HistoryLoan[] }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/seed/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateHistory, HISTORY_SEED, mulberry32, type HistoryInputs } from '../../prisma/history'

const TODAY = new Date(2026, 9, 15, 13, 0)
const MIDNIGHT = new Date(2026, 9, 15)
const DAY_MS = 24 * 60 * 60 * 1000

const INPUTS: HistoryInputs = {
  studentIds: ['st1', 'st2', 'st3', 'st4', 'st5', 'st6'],
  resources: [
    { id: 's1', type: 'seat' }, { id: 's2', type: 'seat' }, { id: 's3', type: 'seat' }, { id: 's4', type: 'seat' },
    { id: 'r1', type: 'room' }, { id: 'r2', type: 'room' }, { id: 'r3', type: 'room' },
  ],
  books: Array.from({ length: 12 }, (_, i) => ({
    id: `b${i + 1}`,
    copyIds: [`b${i + 1}-c1`, `b${i + 1}-c2`, `b${i + 1}-c3`],
    borrowedCopyIds: i % 3 === 0 ? [`b${i + 1}-c2`] : [],
  })),
  popularity: { b1: 6, b8: 5, b3: 4 },
}

const run = () => generateHistory(TODAY, mulberry32(HISTORY_SEED), INPUTS)

describe('generateHistory', () => {
  it('is deterministic for the same day and seed', () => {
    expect(run()).toEqual(run())
  })

  it('dates nothing today or later', () => {
    const { bookings, loans } = run()
    for (const b of bookings) expect(b.endTime.getTime()).toBeLessThanOrEqual(MIDNIGHT.getTime())
    for (const l of loans) {
      expect(l.borrowedAt.getTime()).toBeLessThan(MIDNIGHT.getTime())
      if (l.returnedAt) expect(l.returnedAt.getTime()).toBeLessThan(MIDNIGHT.getTime())
    }
  })

  it('never double-books a resource or a student', () => {
    const { bookings } = run()
    const resourceSlots = new Set<string>()
    const studentSlots = new Set<string>()
    for (const b of bookings) {
      const r = `${b.resourceId}@${b.startTime.getTime()}`
      const s = `${b.userId}@${b.startTime.getTime()}`
      expect(resourceSlots.has(r)).toBe(false)
      expect(studentSlots.has(s)).toBe(false)
      resourceSlots.add(r)
      studentSlots.add(s)
      expect(b.endTime.getTime() - b.startTime.getTime()).toBe(60 * 60 * 1000)
    }
  })

  it('checks in only checked-in bookings, within 10 minutes of the start', () => {
    for (const b of run().bookings) {
      if (b.status === 'checked_in') {
        expect(b.checkedInAt).not.toBeNull()
        const late = b.checkedInAt!.getTime() - b.startTime.getTime()
        expect(late).toBeGreaterThanOrEqual(0)
        expect(late).toBeLessThanOrEqual(10 * 60 * 1000)
      } else {
        expect(b.checkedInAt).toBeNull()
      }
    }
  })

  it('keeps loans consistent: 14-day due dates, returns after borrows, open loans on free borrowed copies', () => {
    const free = new Set(INPUTS.books.flatMap((b) => b.borrowedCopyIds))
    const used = new Set<string>()
    for (const l of run().loans) {
      expect(l.dueAt.getTime() - l.borrowedAt.getTime()).toBe(14 * DAY_MS)
      if (l.returnedAt) {
        expect(l.status).toBe('returned')
        expect(l.returnedAt.getTime()).toBeGreaterThan(l.borrowedAt.getTime())
      } else {
        expect(l.status).toBe('active')
        expect(free.has(l.bookCopyId)).toBe(true)
        expect(used.has(l.bookCopyId)).toBe(false)
        used.add(l.bookCopyId)
      }
    }
  })

  it('produces a believable volume: 600-900 bookings, about 1 in 5 missed, 40-60 loans', () => {
    const { bookings, loans } = run()
    expect(bookings.length).toBeGreaterThanOrEqual(600)
    expect(bookings.length).toBeLessThanOrEqual(900)
    const missed = bookings.filter((b) => b.status === 'booked').length / bookings.length
    expect(missed).toBeGreaterThan(0.1)
    expect(missed).toBeLessThan(0.3)
    expect(loans.length).toBeGreaterThanOrEqual(40)
    expect(loans.length).toBeLessThanOrEqual(60)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/seed/history.test.ts`
Expected: FAIL, cannot resolve `../../prisma/history`.

- [ ] **Step 3: Implement the generator**

Create `backend/prisma/history.ts`:

```ts
// Four weeks of past library activity for the seed, so the admin Dashboard
// has history to show. Pure and deterministic: the same `today` and random
// sequence always give the same rows. Everything ends before today, so
// nothing collides with the seed's "taken slots today", with the student
// app's fixtures, or with anything booked from now on. Only the seed
// students own these rows; the demo student's account is untouched.
import { LOAN_PERIOD_DAYS, TIME_SLOTS } from '../src/config/constants'

export const HISTORY_DAYS = 28
export const HISTORY_SEED = 20261015

export interface HistoryInputs {
  /** The seed students who own every generated row. */
  studentIds: string[]
  resources: { id: string; type: 'seat' | 'room' }[]
  /** Each book's copies, and which of them are 'borrowed' with no loan behind them. */
  books: { id: string; copyIds: string[]; borrowedCopyIds: string[] }[]
  /** Relative chance of each book being borrowed; unlisted books weigh 1. */
  popularity: Record<string, number>
}

export interface HistoryBooking {
  userId: string
  resourceId: string
  startTime: Date
  endTime: Date
  status: 'booked' | 'checked_in'
  checkedInAt: Date | null
}

export interface HistoryLoan {
  userId: string
  bookCopyId: string
  borrowedAt: Date
  dueAt: Date
  returnedAt: Date | null
  status: 'active' | 'returned'
}

const DAY_MS = 24 * 60 * 60 * 1000
const CHECK_IN_RATE = 0.8

/** mulberry32: a small seeded PRNG, so the seed's history is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Chance a resource is booked in a slot: weekday afternoons busiest, rooms peak 2-4 PM, weekends quieter. */
export function occupancy(type: 'seat' | 'room', weekday: number, hour: number): number {
  const weekend = weekday === 0 || weekday === 6
  let p = weekend ? 0.16 : 0.32
  if (hour >= 13 && hour <= 17) p += 0.25
  if (hour >= 18) p -= 0.1
  if (type === 'room' && (hour === 14 || hour === 15)) p += 0.25
  return Math.min(0.95, Math.max(0.05, p))
}

export function generateHistory(
  today: Date,
  random: () => number,
  inputs: HistoryInputs,
): { bookings: HistoryBooking[]; loans: HistoryLoan[] } {
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]

  const weights = inputs.books.map((b) => inputs.popularity[b.id] ?? 1)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const pickBook = () => {
    let r = random() * totalWeight
    for (let i = 0; i < inputs.books.length; i++) {
      r -= weights[i]
      if (r < 0) return inputs.books[i]
    }
    return inputs.books[inputs.books.length - 1]
  }
  const freeCopies = new Map(inputs.books.map((b) => [b.id, [...b.borrowedCopyIds]]))
  const nextCopy = new Map<string, number>()

  const makeLoan = (day: Date): HistoryLoan => {
    const book = pickBook()
    const userId = pick(inputs.studentIds)
    const borrowedAt = new Date(
      day.getFullYear(), day.getMonth(), day.getDate(), 10 + Math.floor(random() * 8), Math.floor(random() * 60),
    )
    const dueAt = new Date(borrowedAt.getTime() + LOAN_PERIOD_DAYS * DAY_MS)
    const roll = random()
    let returnedAt: Date | null =
      roll < 0.75
        ? new Date(borrowedAt.getTime() + (3 + Math.floor(random() * 11)) * DAY_MS) // on time: 3-13 days
        : roll < 0.9
          ? new Date(borrowedAt.getTime() + (15 + Math.floor(random() * 4)) * DAY_MS) // late: 15-18 days
          : null
    if (returnedAt && returnedAt >= midnight) returnedAt = null // not back yet
    if (returnedAt === null) {
      const copy = freeCopies.get(book.id)?.shift()
      if (copy) return { userId, bookCopyId: copy, borrowedAt, dueAt, returnedAt: null, status: 'active' }
      // No borrowed copy is free to carry an open loan, so record it as returned.
      returnedAt = new Date(Math.min(borrowedAt.getTime() + 7 * DAY_MS, midnight.getTime() - 60 * 60 * 1000))
    }
    const index = nextCopy.get(book.id) ?? 0
    nextCopy.set(book.id, index + 1)
    return { userId, bookCopyId: book.copyIds[index % book.copyIds.length], borrowedAt, dueAt, returnedAt, status: 'returned' }
  }

  const bookings: HistoryBooking[] = []
  const loans: HistoryLoan[] = []
  for (let back = HISTORY_DAYS; back >= 1; back--) {
    const day = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - back)
    for (const slot of TIME_SLOTS) {
      const busy = new Set<string>() // students already booked in this slot
      for (const resource of inputs.resources) {
        if (random() >= occupancy(resource.type, day.getDay(), slot.hour)) continue
        const free = inputs.studentIds.filter((id) => !busy.has(id))
        if (free.length === 0) continue
        const userId = pick(free)
        busy.add(userId)
        const startTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.hour)
        const endTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.hour + 1)
        const checkedIn = random() < CHECK_IN_RATE
        bookings.push({
          userId,
          resourceId: resource.id,
          startTime,
          endTime,
          status: checkedIn ? 'checked_in' : 'booked',
          checkedInAt: checkedIn ? new Date(startTime.getTime() + Math.floor(random() * 11) * 60_000) : null,
        })
      }
    }
    const weekend = day.getDay() === 0 || day.getDay() === 6
    const borrows = weekend ? (random() < 0.4 ? 1 : 0) : 2 + Math.floor(random() * 2)
    for (let i = 0; i < borrows; i++) loans.push(makeLoan(day))
  }
  return { bookings, loans }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/seed/history.test.ts` → PASS (6 tests).

If only the volume test fails, the occupancy constants drifted: expected values are about 840 bookings and 53 loans. Re-derive rather than widening the ranges: bookings ≈ Σ over 28 days of Σ over resources and slots of `occupancy`, so raise or lower the two base rates (0.32 weekday, 0.16 weekend) together until the count lands inside 600-900, then re-run.

- [ ] **Step 5: Wire the history into the seed**

Edit `backend/prisma/seed.ts`:

1. Add after the existing imports:

```ts
import { generateHistory, HISTORY_SEED, mulberry32 } from './history'
```

2. Change the three room rows in `RESOURCES` so they carry areas:

```ts
  { id: 'r1', type: 'room' as const, name: 'Group Room 201 · 4 seats', location: 'Group study rooms', capacity: 4, taken: ['2:00 PM', '3:00 PM'] },
  { id: 'r2', type: 'room' as const, name: 'Group Room 202 · 6 seats', location: 'Group study rooms', capacity: 6, taken: TIME_SLOTS.map((s) => s.label) },
  { id: 'r3', type: 'room' as const, name: 'Discussion Pod 1 · 2 seats', location: 'Discussion pods', capacity: 2, taken: ['10:00 AM', '11:00 AM'] },
```

3. Add after `DEMO_LOANS`:

```ts
// Relative borrow weights for the generated history, so a few titles stand
// out on the admin Dashboard. Books not listed weigh 1.
const BOOK_POPULARITY: Record<string, number> = { b1: 6, b8: 5, b3: 4, b2: 3, b4: 3, b12: 3, b5: 2, b7: 2, b9: 2, b11: 2 }
```

4. In `main()`, declare before the `for (const b of BOOKS)` loop:

```ts
  const copiesByBook: { id: string; copyIds: string[]; borrowedCopyIds: string[] }[] = []
```

Inside that loop, before the inner copy loop, add `const copies = { id: b.id, copyIds: [] as string[], borrowedCopyIds: [] as string[] }`. After `const copy = await prisma.bookCopy.create(...)`, add:

```ts
      copies.copyIds.push(copy.id)
      // A borrowed copy with no loan behind it can carry one of the history's open loans.
      if (isBorrowed && !(demoLoan && i === 0)) copies.borrowedCopyIds.push(copy.id)
```

After the inner copy loop ends, add `copiesByBook.push(copies)`.

5. After the `for (const r of RESOURCES)` loop and before the `console.log` lines, add:

```ts
  const history = generateHistory(today, mulberry32(HISTORY_SEED), {
    studentIds: seedStudents.map((s) => s.id),
    resources: RESOURCES.map((r) => ({ id: r.id, type: r.type })),
    books: copiesByBook,
    popularity: BOOK_POPULARITY,
  })
  await prisma.resourceBooking.createMany({ data: history.bookings })
  await prisma.loan.createMany({ data: history.loans })
```

and add a third log line:

```ts
  // eslint-disable-next-line no-console
  console.log(`Generated ${history.bookings.length} past bookings and ${history.loans.length} past loans for the seed students.`)
```

6. In the comment block at the top of `seed.ts`, add a paragraph after the "Safe to re-run" paragraph:

```ts
// It also generates four weeks of past bookings and loans for the six seed
// students (prisma/history.ts), ending yesterday, so the admin Dashboard has
// history to show. The demo student's account gets none of it.
```

- [ ] **Step 6: Verify the seed compiles and runs**

Run: `npm run typecheck:seed` → no output.
Run: `npm run seed` → ends with three lines, the last reading `Generated <n> past bookings and <m> past loans for the seed students.` (This writes the dev database, as the seed always does.)

- [ ] **Step 7: Run the whole backend suite**

Run: `npx vitest run` → all files pass.

- [ ] **Step 8: Document the history**

In `backend/README.md`, in *Seed data*, add after the paragraph that ends `…documented in the comment block at the top of \`prisma/seed.ts\`.`:

```markdown
It also generates four weeks of past activity, ending yesterday, for the six
"Seed Student" accounts: about 600-900 bookings (weekday afternoons busiest,
about 1 in 5 missed) and 40-60 loans. The admin console's Dashboard reads it.
The same seed (`HISTORY_SEED` in `prisma/history.ts`) gives the same history
every time, shifted to end yesterday. The demo student's account gets none of
it, so the student app looks exactly as before.
```

- [ ] **Step 9: Hand off the commit**

```bash
git add prisma/history.ts prisma/seed.ts test/seed/history.test.ts README.md
git commit -m "backend: seed four weeks of past activity for the admin Dashboard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Console project setup

**Files (all under `admin/`, new):**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `.gitignore`, `.env.example`, `styles/ds.css`, `styles/console.css`, `app/layout.tsx`, `app/page.tsx`, `test/helpers.ts`, `test/setup.test.ts`, `.github/workflows/ci.yml`, `CLAUDE.md`, `docs/2026-10-15-admin-console-slice1-design.md`, `docs/2026-10-15-admin-console-slice1.md`
- Modify: root `CLAUDE.md` (not under git)

**Interfaces:**
- Produces: path alias `@/` → `admin/`; test helpers `mockFetch(routes)` and `json(status, body)` in `test/helpers.ts`.

- [ ] **Step 1: Clone the repository**

Run (from the SmartLib root): `git clone https://github.com/Raghav-28-Gupta/smart-lib-admin.git admin`
Expected: an empty repository in `admin/`.

- [ ] **Step 2: Create the project files**

`admin/package.json`:

```json
{
  "name": "smartlib-admin",
  "version": "0.1.0",
  "private": true,
  "description": "SmartLib librarian console.",
  "engines": {
    "node": "22.x"
  },
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "lucide-react": "1.49.0",
    "next": "16.3.8",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@testing-library/dom": "10.4.2",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@types/node": "26.6.4",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "jsdom": "30.1.1",
    "typescript": "6.0.3",
    "vite": "8.3.2",
    "vitest": "5.0.3"
  }
}
```

`admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`admin/next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
```

`admin/vitest.config.ts`:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': root } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
```

`admin/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})
```

`admin/.gitignore`:

```
node_modules
.next
out
next-env.d.ts
*.tsbuildinfo
.env*.local
.vercel
coverage
```

`admin/.env.example`:

```bash
# Copy to .env.local for development.
# Where the SmartLib API lives. Production (Vercel): https://smart-lib-backend.onrender.com
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
# The library's time zone, used for today's date in the top bar.
NEXT_PUBLIC_LIBRARY_TIMEZONE=Asia/Kolkata
```

- [ ] **Step 3: Add the design system and the console rules**

Copy the recovered stylesheet, dropping its first two lines (the comment is kept; the Google Fonts `@import` is removed because `next/font` loads the fonts):

```bash
cp ../docs/superpowers/assets/admin-console/organic-styles.css styles/ds.css
```

Then delete the line in `styles/ds.css` that begins `@import url('https://fonts.googleapis.com/css2?family=Caprasimo` and, in its place, add:

```css
/* Fonts: loaded by next/font in app/layout.tsx; see styles/console.css. */
```

Create `admin/styles/console.css`:

```css
/* Console rules from the SmartLib Admin canvas (sla-*), then this console's additions. */

/* next/font provides the families as variables on <html> (app/layout.tsx). */
:root {
  --font-heading: var(--font-caprasimo), system-ui, sans-serif;
  --font-body: var(--font-figtree), system-ui, sans-serif;
}

@keyframes sla-pulse { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }
body { margin: 0 }
.sla-skel { background: var(--color-neutral-300); border-radius: var(--radius-sm); animation: sla-pulse 1.3s ease-in-out infinite }
.sla-nav-btn { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: none; border-radius: var(--radius-md); cursor: pointer; text-align: left; font-size: 13.5px; font-family: var(--font-body); width: 100% }
.sla-chip { border: none; cursor: pointer; font: inherit }
a { color: var(--color-accent-700) }
a:hover { color: var(--color-accent-800) }

/* Additions, not in the canvas */
.sla-nav-btn:disabled { cursor: default; opacity: .55 }
.sla-nav-btn:focus-visible, .sla-link-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }
.sla-soon { margin-left: auto; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; background: var(--color-neutral-100); color: var(--color-neutral-800); border-radius: 999px; padding: 1px 7px; white-space: nowrap }
.sla-link-btn { background: none; border: none; padding: 0; font: inherit; font-size: 10.5px; color: var(--color-accent-700); cursor: pointer; text-decoration: underline }
@media (prefers-reduced-motion: reduce) { .sla-skel { animation: none } }
```

- [ ] **Step 4: Add the root layout and the redirect**

`admin/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { Caprasimo, Figtree } from 'next/font/google'
import type { ReactNode } from 'react'
import '@/styles/ds.css'
import '@/styles/console.css'

const caprasimo = Caprasimo({ weight: '400', subsets: ['latin'], variable: '--font-caprasimo' })
const figtree = Figtree({ weight: ['400', '600', '700'], subsets: ['latin'], variable: '--font-figtree' })

export const metadata: Metadata = {
  title: 'SmartLib Admin',
  description: 'Librarian console for SmartLib.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

`admin/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/dashboard')
}
```

- [ ] **Step 5: Add the test helpers and a setup test**

`admin/test/helpers.ts`:

```ts
import { vi } from 'vitest'

/** A JSON response, as the SmartLib API sends them. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * Replaces fetch with routes keyed by "METHOD /path". Each handler is called
 * per request, so it can return a fresh Response every time. Unknown routes fail the test.
 */
export function mockFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`
    const handler = routes[key]
    if (!handler) throw new Error(`Unexpected request: ${key}`)
    return handler()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
```

`admin/test/setup.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design system', () => {
  it('ships the Organic tokens without the Google Fonts import', () => {
    const css = readFileSync('styles/ds.css', 'utf8')
    expect(css).toContain('--color-bg: #f5ead8')
    expect(css).not.toContain('fonts.googleapis.com')
  })
})
```

- [ ] **Step 6: Install and verify**

Run (in `admin/`): `npm install` → completes; `package-lock.json` is created.
Run: `npm test` → PASS (1 test).
Run: `npm run build` → completes. Next may add fields to `tsconfig.json` and create `next-env.d.ts`; keep the `tsconfig.json` changes (`next-env.d.ts` is ignored).

- [ ] **Step 7: Add CI, project notes, and the design documents**

`admin/.github/workflows/ci.yml`:

```yaml
# Tests and builds every push and pull request. Vercel deploys main itself.
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    env:
      NEXT_PUBLIC_API_BASE_URL: https://smart-lib-backend.onrender.com
      NEXT_PUBLIC_LIBRARY_TIMEZONE: Asia/Kolkata
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      # next build also type-checks the project.
      - run: npm run build
```

`admin/CLAUDE.md`:

```markdown
# SmartLib — Admin Console (Next.js)

The librarian console. It talks only to the Node backend (`../backend`), using
the same login API as the student app, and admits accounts with the admin role.

## Commands (run from `admin/`)

```bash
npm run dev        # http://localhost:3001 (needs the backend on :3000)
npm test           # Vitest + Testing Library, no backend needed
npm run build      # production build, includes type-checking
```

## Conventions

- Every page is a client component: the session token lives in `localStorage`
  (`smartlib.admin.token`), so nothing fetches on the server.
- All API calls go through `lib/api.ts`. A 401 or 403 there ends the session;
  `ConsoleGuard` (`lib/session.tsx`) sends the user to `/login` with the reason.
- Styling comes from the Organic design system (`styles/ds.css`, kept verbatim
  apart from fonts) and the canvas's console rules (`styles/console.css`). Use
  its classes (`card`, `btn`, `input`, `text-muted`, `sla-*`) before adding CSS.
- Icons: `lucide-react` at `strokeWidth={2.75}`.
- Copy follows the spec in `docs/`; don't paraphrase user-facing strings.
- Tests live in `test/`, mirroring the source tree. Mock `fetch` with
  `test/helpers.ts`; mock `next/navigation` and `next/link` per test file.
- Never commit for the user: present `git add`/`git commit` commands (prefix `admin:`).
```

Copy the design documents into the repository:

```bash
mkdir -p docs
cp ../docs/superpowers/specs/2026-10-15-admin-console-slice1-design.md docs/
cp ../docs/superpowers/plans/2026-10-15-admin-console-slice1.md docs/
```

In the root `SmartLib/CLAUDE.md` (not under git): in the architecture block add a line `Next.js Admin Console (:3001, Vercel) ──► Node Backend`, add `- **Admin Console (\`admin/\`)**: Next.js + React, the librarian console (separate repo).` to the component list, add `admin: build the admin dashboard` to the commit prefixes, and add the row `| Admin Console | \`http://localhost:3001\` | Librarian console; production on Vercel |` to the ports table.

- [ ] **Step 8: Hand off the commit**

```bash
git add .
git commit -m "admin: set up the Next.js console with the Organic design system" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 8: Display formatting

**Files:**
- Create: `admin/lib/format.ts`
- Test: `admin/test/lib/format.test.ts`

**Interfaces:**
- Produces: `pointsDelta(current: number, previous: number): string`, `countDelta(current: number, previous: number): string`, `slotRange(label: string): string`, `todayLabel(now: Date, timeZone: string): string`, `weekdayShort(isoDate: string): string`, `initials(name: string): string`.

- [ ] **Step 1: Write the failing tests**

`admin/test/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countDelta, initials, pointsDelta, slotRange, todayLabel, weekdayShort } from '@/lib/format'

describe('pointsDelta', () => {
  it('reports the change in percentage points against last week', () => {
    expect(pointsDelta(74, 68)).toBe('+6 pts vs last week')
    expect(pointsDelta(60, 63)).toBe('−3 pts vs last week')
    expect(pointsDelta(50, 50)).toBe('no change vs last week')
  })
})

describe('countDelta', () => {
  it('reports the change against yesterday', () => {
    expect(countDelta(9, 7)).toBe('+2 since yesterday')
    expect(countDelta(4, 5)).toBe('−1 since yesterday')
    expect(countDelta(3, 3)).toBe('no change since yesterday')
  })
})

describe('slotRange', () => {
  it("turns a slot label into the hour it covers", () => {
    expect(slotRange('2:00 PM')).toBe('2–3 PM')
    expect(slotRange('9:00 AM')).toBe('9–10 AM')
    expect(slotRange('11:00 AM')).toBe('11 AM–12 PM')
    expect(slotRange('12:00 PM')).toBe('12–1 PM')
    expect(slotRange('7:00 PM')).toBe('7–8 PM')
  })

  it('leaves an unexpected label as it is', () => {
    expect(slotRange('noon')).toBe('noon')
  })
})

describe('todayLabel', () => {
  it("names the library's day, not the browser's", () => {
    // 20:00 UTC on 14 Oct is already 15 Oct in India.
    expect(todayLabel(new Date('2026-10-14T20:00:00Z'), 'Asia/Kolkata')).toBe('Thursday, Oct 15, 2026')
  })
})

describe('weekdayShort', () => {
  it('names the weekday of a calendar date', () => {
    expect(weekdayShort('2026-10-15')).toBe('Thu')
    expect(weekdayShort('2026-10-11')).toBe('Sun')
  })
})

describe('initials', () => {
  it('takes up to two initials', () => {
    expect(initials('Raghav Gupta')).toBe('RG')
    expect(initials('mary jane watson')).toBe('MJ')
    expect(initials('  Aditi  ')).toBe('A')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/format.test.ts` → FAIL, cannot resolve `@/lib/format`.

- [ ] **Step 3: Implement**

`admin/lib/format.ts`:

```ts
// Display formatting for the Dashboard and shell. Pure, so every rule is tested.

const MINUS = '−' // U+2212, as in the spec's copy

function signed(n: number): string {
  return `${n > 0 ? '+' : MINUS}${Math.abs(n)}`
}

/** "+6 pts vs last week", "−3 pts vs last week", or "no change vs last week". */
export function pointsDelta(current: number, previous: number): string {
  const d = current - previous
  return d === 0 ? 'no change vs last week' : `${signed(d)} pts vs last week`
}

/** "+2 since yesterday", "−1 since yesterday", or "no change since yesterday". */
export function countDelta(current: number, previous: number): string {
  const d = current - previous
  return d === 0 ? 'no change since yesterday' : `${signed(d)} since yesterday`
}

/** "2:00 PM" becomes "2–3 PM"; "11:00 AM" becomes "11 AM–12 PM". */
export function slotRange(label: string): string {
  const match = /^(\d{1,2}):\d{2} (AM|PM)$/.exec(label)
  if (!match) return label
  const start = (Number(match[1]) % 12) + (match[2] === 'PM' ? 12 : 0)
  const end = start + 1
  const twelve = (h: number) => (h % 12 === 0 ? 12 : h % 12)
  const meridiem = (h: number) => (h % 24 < 12 ? 'AM' : 'PM')
  return meridiem(start) === meridiem(end)
    ? `${twelve(start)}–${twelve(end)} ${meridiem(end)}`
    : `${twelve(start)} ${meridiem(start)}–${twelve(end)} ${meridiem(end)}`
}

/** "Thursday, Oct 15, 2026" for `now` in the library's time zone. */
export function todayLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone,
  }).format(now)
}

/** "Thu" for '2026-10-15'. */
export function weekdayShort(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "RG" for "Raghav Gupta". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/format.test.ts` → PASS (7 tests).

- [ ] **Step 5: Hand off the commit**

```bash
git add lib/format.ts test/lib/format.test.ts
git commit -m "admin: add display formatting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: API client

**Files:**
- Create: `admin/lib/api.ts`
- Test: `admin/test/lib/api.test.ts`

**Interfaces:**
- Produces: `class ApiError extends Error { status: number }`; `TOKEN_KEY = 'smartlib.admin.token'`; `NETWORK_MESSAGE`; `REQUEST_TIMEOUT_MS = 60_000`; `type SessionEndReason = 'expired' | 'not-admin'`; `SESSION_ENDED_EVENT = 'smartlib:session-ended'` (a `CustomEvent<SessionEndReason>` on `window`); `apiBaseUrl(): string`; `readToken(): string | null`; `writeToken(token: string): void`; `clearToken(): void`; `apiRequest<T>(path: string, options?: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean }): Promise<T>`.

- [ ] **Step 1: Write the failing tests**

`admin/test/lib/api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, NETWORK_MESSAGE, readToken, SESSION_ENDED_EVENT, writeToken } from '@/lib/api'
import { json, mockFetch } from '../helpers'

function listenForSessionEnd() {
  const reasons: string[] = []
  const listener = (e: Event) => reasons.push((e as CustomEvent<string>).detail)
  window.addEventListener(SESSION_ENDED_EVENT, listener)
  return { reasons, stop: () => window.removeEventListener(SESSION_ENDED_EVENT, listener) }
}

describe('apiRequest', () => {
  it('sends the stored token with a timeout and returns the JSON body', async () => {
    writeToken('t1')
    const fetch = mockFetch({ 'GET /admin/metrics/overdue': () => json(200, { count: 1, countYesterday: 0 }) })
    await expect(apiRequest('/admin/metrics/overdue')).resolves.toEqual({ count: 1, countYesterday: 0 })
    const init = fetch.mock.calls[0][1]!
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t1')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends no token when auth is false, and posts JSON', async () => {
    writeToken('t1')
    const fetch = mockFetch({ 'POST /auth/login': () => json(200, { ok: true }) })
    await apiRequest('/auth/login', { method: 'POST', body: { email: 'a@b.c' }, auth: false })
    const init = fetch.mock.calls[0][1]!
    expect(new Headers(init.headers).get('Authorization')).toBeNull()
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(init.body).toBe('{"email":"a@b.c"}')
  })

  it("turns an error body into an ApiError carrying the server's message", async () => {
    mockFetch({ 'POST /auth/login': () => json(401, { error: "That email and password don't match our records." }) })
    await expect(apiRequest('/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      status: 401,
      message: "That email and password don't match our records.",
    })
  })

  it('reports an unreachable server with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ status: 0, message: NETWORK_MESSAGE })
  })

  it('ends the session on a 401 when a token was sent', async () => {
    writeToken('stale')
    const ended = listenForSessionEnd()
    mockFetch({ 'GET /admin/metrics/demand': () => json(401, { error: 'Invalid or expired token' }) })
    await expect(apiRequest('/admin/metrics/demand')).rejects.toBeInstanceOf(ApiError)
    expect(readToken()).toBeNull()
    expect(ended.reasons).toEqual(['expired'])
    ended.stop()
  })

  it('ends the session on a 403 from an account that is no longer an admin', async () => {
    writeToken('demoted')
    const ended = listenForSessionEnd()
    mockFetch({ 'GET /admin/metrics/demand': () => json(403, { error: 'Admin access required' }) })
    await expect(apiRequest('/admin/metrics/demand')).rejects.toMatchObject({ status: 403 })
    expect(readToken()).toBeNull()
    expect(ended.reasons).toEqual(['not-admin'])
    ended.stop()
  })

  it('leaves the session alone when a login is refused', async () => {
    const ended = listenForSessionEnd()
    mockFetch({ 'POST /auth/login': () => json(401, { error: 'no' }) })
    await expect(apiRequest('/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toBeInstanceOf(ApiError)
    expect(ended.reasons).toEqual([])
    ended.stop()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/api.test.ts` → FAIL, cannot resolve `@/lib/api`.

- [ ] **Step 3: Implement**

`admin/lib/api.ts`:

```ts
// The console's only route to the SmartLib API.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const TOKEN_KEY = 'smartlib.admin.token'
export const NETWORK_MESSAGE = "Can't reach the SmartLib server. Try again in a minute."
// Render's free tier sleeps when idle and takes up to a minute to wake; waiting
// that long shows the loading state instead of an error.
export const REQUEST_TIMEOUT_MS = 60_000

export type SessionEndReason = 'expired' | 'not-admin'
/** Fired on window, as a CustomEvent<SessionEndReason>, when the API ends the session. */
export const SESSION_ENDED_EVENT = 'smartlib:session-ended'

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage unavailable: there is nothing to clear.
  }
}

export async function apiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = options.auth === false ? null : readToken()
  if (token) headers.Authorization = `Bearer ${token}`

  // An AbortController with a timer, rather than AbortSignal.timeout, so the
  // timeout works in every browser and in the test DOM.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE)
  } finally {
    clearTimeout(timer)
  }

  const data = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) {
    // With a token, 401 means the session expired and 403 means the account
    // is no longer an admin (every console route is admin-only).
    if (token && (res.status === 401 || res.status === 403)) {
      clearToken()
      const reason: SessionEndReason = res.status === 401 ? 'expired' : 'not-admin'
      window.dispatchEvent(new CustomEvent<SessionEndReason>(SESSION_ENDED_EVENT, { detail: reason }))
    }
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`)
  }
  return data as T
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/api.test.ts` → PASS (7 tests).

- [ ] **Step 5: Hand off the commit**

```bash
git add lib/api.ts test/lib/api.test.ts
git commit -m "admin: add the API client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Session, login page and console guard

**Files:**
- Create: `admin/lib/session.tsx`, `admin/app/login/page.tsx`
- Test: `admin/test/lib/session.test.tsx`, `admin/test/app/login.test.tsx`

**Interfaces:**
- Consumes: everything Task 9 exports.
- Produces: `interface AdminUser { id: string; name: string; email: string; roll: string; role: 'student' | 'admin' }`; `NOT_ADMIN_MESSAGE`; `SESSION_EXPIRED_MESSAGE`; `logIn(email: string, password: string): Promise<AdminUser>`; `loginNotice(reason: string | null): string | null`; `ConsoleGuard({ children })`; `useSession(): { user: AdminUser; logOut: () => void }`.

- [ ] **Step 1: Write the failing tests for the guard**

`admin/test/lib/session.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NETWORK_MESSAGE, readToken, SESSION_ENDED_EVENT, writeToken } from '@/lib/api'
import { ConsoleGuard, useSession } from '@/lib/session'
import { json, mockFetch } from '../helpers'

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }) }))

const ADMIN = { id: 'a1', name: 'Librarian One', email: 'lib@thapar.edu', roll: 'Pending', role: 'admin' }

function Probe() {
  const { user, logOut } = useSession()
  return (
    <div>
      <p>Signed in as {user.name}</p>
      <button type="button" onClick={logOut}>Log out</button>
    </div>
  )
}

const renderGuard = () => render(<ConsoleGuard><Probe /></ConsoleGuard>)

beforeEach(() => nav.replace.mockReset())

describe('ConsoleGuard', () => {
  it('sends a visitor without a token to the login page', () => {
    renderGuard()
    expect(nav.replace).toHaveBeenCalledWith('/login')
    expect(screen.queryByText(/Signed in/)).toBeNull()
  })

  it('lets an admin in', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, ADMIN) })
    renderGuard()
    expect(await screen.findByText('Signed in as Librarian One')).toBeInTheDocument()
  })

  it('turns away an account that is no longer an admin', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, { ...ADMIN, role: 'student' }) })
    renderGuard()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login?reason=not-admin'))
    expect(readToken()).toBeNull()
  })

  it('sends a deleted account to the login page', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(404, { error: 'User not found' }) })
    renderGuard()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'))
    expect(readToken()).toBeNull()
  })

  it('keeps the token and offers Retry when the server cannot be reached', async () => {
    writeToken('t')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, ADMIN)))
    renderGuard()
    expect(await screen.findByText(NETWORK_MESSAGE)).toBeInTheDocument()
    expect(readToken()).toBe('t')
    expect(nav.replace).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Signed in as Librarian One')).toBeInTheDocument()
  })

  it('follows a session-ended event to the login page with its reason', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, ADMIN) })
    renderGuard()
    await screen.findByText('Signed in as Librarian One')
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: 'expired' }))
    })
    expect(nav.replace).toHaveBeenCalledWith('/login?reason=expired')
  })

  it('logs out by clearing the token and returning to the login page', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, ADMIN) })
    renderGuard()
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(readToken()).toBeNull()
    expect(nav.replace).toHaveBeenCalledWith('/login')
  })
})
```

- [ ] **Step 2: Write the failing tests for the login page**

`admin/test/app/login.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '@/app/login/page'
import { NETWORK_MESSAGE, readToken } from '@/lib/api'
import { NOT_ADMIN_MESSAGE, SESSION_EXPIRED_MESSAGE } from '@/lib/session'
import { json, mockFetch } from '../helpers'

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const user = (role: 'admin' | 'student') => ({ id: 'u', name: 'Someone', email: 'lib@thapar.edu', roll: 'Pending', role })

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'lib@thapar.edu')
  await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

beforeEach(() => {
  nav.replace.mockReset()
  nav.search = ''
})

describe('LoginPage', () => {
  it('logs an admin in and opens the dashboard', async () => {
    mockFetch({ 'POST /auth/login': () => json(200, { user: user('admin'), token: 'tok' }) })
    render(<LoginPage />)
    await fillAndSubmit()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard'))
    expect(readToken()).toBe('tok')
  })

  it('refuses a student account and keeps no token', async () => {
    mockFetch({ 'POST /auth/login': () => json(200, { user: user('student'), token: 'tok' }) })
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByText(NOT_ADMIN_MESSAGE)).toBeInTheDocument()
    expect(readToken()).toBeNull()
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it("shows the server's message for wrong credentials", async () => {
    mockFetch({ 'POST /auth/login': () => json(401, { error: "That email and password don't match our records." }) })
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByText("That email and password don't match our records.")).toBeInTheDocument()
  })

  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByText(NETWORK_MESSAGE)).toBeInTheDocument()
  })

  it('explains why the previous session ended', () => {
    nav.search = 'reason=expired'
    const { unmount } = render(<LoginPage />)
    expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeInTheDocument()
    unmount()
    nav.search = 'reason=not-admin'
    render(<LoginPage />)
    expect(screen.getByText(NOT_ADMIN_MESSAGE)).toBeInTheDocument()
  })

  it('sends one request when submitted twice quickly', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetch)
    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'lib@thapar.edu')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
    const form = screen.getByRole('button', { name: 'Log in' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/lib/session.test.tsx test/app/login.test.tsx` → FAIL, cannot resolve `@/lib/session` and `@/app/login/page`.

- [ ] **Step 4: Implement the session module**

`admin/lib/session.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  ApiError,
  apiRequest,
  clearToken,
  readToken,
  SESSION_ENDED_EVENT,
  writeToken,
  type SessionEndReason,
} from './api'

export interface AdminUser {
  id: string
  name: string
  email: string
  roll: string
  role: 'student' | 'admin'
}

export const NOT_ADMIN_MESSAGE = "This account doesn't have admin access."
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Log in again.'

/** Logs in and keeps the token only for an admin. Throws an ApiError carrying the message to show. */
export async function logIn(email: string, password: string): Promise<AdminUser> {
  const { user, token } = await apiRequest<{ user: AdminUser; token: string }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  })
  if (user.role !== 'admin') throw new ApiError(403, NOT_ADMIN_MESSAGE)
  writeToken(token)
  return user
}

/** The login page's notice for `?reason=`. */
export function loginNotice(reason: string | null): string | null {
  if (reason === 'expired') return SESSION_EXPIRED_MESSAGE
  if (reason === 'not-admin') return NOT_ADMIN_MESSAGE
  return null
}

interface Session {
  user: AdminUser
  logOut: () => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside <ConsoleGuard>')
  return session
}

type GuardState = { kind: 'checking' } | { kind: 'unreachable'; message: string } | { kind: 'ready'; user: AdminUser }

/** Lets an admin into the console and sends everyone else to /login. */
export function ConsoleGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<GuardState>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)

  const logOut = useCallback(() => {
    clearToken()
    router.replace('/login')
  }, [router])

  // Any API call can end the session: 401 (expired) or 403 (no longer an admin).
  useEffect(() => {
    const onEnded = (e: Event) => router.replace(`/login?reason=${(e as CustomEvent<SessionEndReason>).detail}`)
    window.addEventListener(SESSION_ENDED_EVENT, onEnded)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded)
  }, [router])

  useEffect(() => {
    if (!readToken()) {
      router.replace('/login')
      return
    }
    let cancelled = false
    setState({ kind: 'checking' })
    apiRequest<AdminUser>('/auth/me')
      .then((user) => {
        if (cancelled) return
        if (user.role !== 'admin') {
          clearToken()
          router.replace('/login?reason=not-admin')
          return
        }
        setState({ kind: 'ready', user })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return // the listener above handles it
        if (error instanceof ApiError && error.status === 404) {
          clearToken() // the account no longer exists
          router.replace('/login')
          return
        }
        setState({ kind: 'unreachable', message: error instanceof ApiError ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [router, attempt])

  if (state.kind === 'ready') {
    return <SessionContext.Provider value={{ user: state.user, logOut }}>{children}</SessionContext.Provider>
  }
  if (state.kind === 'unreachable') {
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '0 16px', textAlign: 'center', background: 'var(--color-bg)', color: 'var(--color-text)',
        }}
      >
        <p style={{ margin: 0 }}>{state.message}</p>
        <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    )
  }
  return <div aria-busy="true" aria-label="Checking your session" style={{ minHeight: '100vh', background: 'var(--color-bg)' }} />
}
```

- [ ] **Step 5: Implement the login page**

`admin/app/login/page.tsx`:

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/api'
import { logIn, loginNotice } from '@/lib/session'

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg)', padding: '24px 16px' }}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}

function LoginForm() {
  const router = useRouter()
  const notice = loginNotice(useSearchParams().get('reason'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // a second submit can arrive before React re-renders

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await logIn(email.trim(), password)
      router.replace('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="card elev-sm" aria-labelledby="login-title" style={{ width: '100%', maxWidth: 360, padding: 24, gap: 14 }}>
      <div>
        <h1 id="login-title" style={{ margin: 0, fontSize: 24 }}>SmartLib admin</h1>
        <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Log in with a librarian account.</p>
      </div>
      {notice && !error && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-800)' }}>{notice}</p>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-800)' }}>{error}</p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/lib/session.test.tsx test/app/login.test.tsx` → PASS (13 tests).

- [ ] **Step 7: Hand off the commit**

```bash
git add lib/session.tsx app/login/page.tsx test/lib/session.test.tsx test/app/login.test.tsx
git commit -m "admin: add login and the console session guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Console shell

**Files:**
- Create: `admin/components/Sidebar.tsx`, `admin/components/TopBar.tsx`, `admin/app/(console)/layout.tsx`
- Test: `admin/test/components/Sidebar.test.tsx`, `admin/test/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: `initials`, `todayLabel` (Task 8); `ConsoleGuard`, `useSession` (Task 10).
- Produces: `Sidebar({ userName, onLogOut }: { userName: string; onLogOut: () => void })`; `TopBar({ title }: { title: string })`; the `(console)` layout used by every console page.

- [ ] **Step 1: Confirm the icon names exist in lucide-react 1.49.0**

Run (in `admin/`):

```bash
node -e "const l=require('lucide-react'); console.log(['LayoutDashboard','Calendar','BookOpen','DoorOpen','Wallet','TriangleAlert','TrendingUp'].map(n=>n+':'+(n in l)).join(' '))"
```

Expected: every name prints `:true`. If one prints `:false`, find its current name with `node -e "console.log(Object.keys(require('lucide-react')).filter(k=>/Alert|Trend|Door|Wallet|Calendar|Layout|Book/.test(k)).join(' '))"`, pick the icon with the same drawing as the canvas, and use that name here and in Task 12.

- [ ] **Step 2: Write the failing tests**

`admin/test/components/Sidebar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const renderSidebar = (onLogOut = vi.fn()) => {
  render(<Sidebar userName="Librarian One" onLogOut={onLogOut} />)
  return onLogOut
}

describe('Sidebar', () => {
  it('marks the Dashboard as the current page', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the unbuilt sections as disabled and marked Coming soon', () => {
    renderSidebar()
    for (const name of ['Bookings', 'Catalogue', 'Resources', 'Fines']) {
      const button = screen.getByRole('button', { name: new RegExp(name) })
      expect(button).toBeDisabled()
      expect(button).toHaveTextContent('Coming soon')
    }
  })

  it('leaves out the deferred Needs attention queue', () => {
    renderSidebar()
    expect(screen.queryByText('Needs attention')).toBeNull()
  })

  it("shows the admin's name and initials, and logs out", async () => {
    const onLogOut = renderSidebar()
    expect(screen.getByText('Librarian One')).toBeInTheDocument()
    expect(screen.getByText('LO')).toBeInTheDocument()
    expect(screen.getByText('Librarian admin')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogOut).toHaveBeenCalledOnce()
  })
})
```

`admin/test/components/TopBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from '@/components/TopBar'

afterEach(() => vi.useRealTimers())

describe('TopBar', () => {
  it("shows the page title and the library's date", () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T20:00:00Z')) // already 15 Oct in India
    render(<TopBar title="Dashboard" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Thursday, Oct 15, 2026')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/components` → FAIL, cannot resolve the components.

- [ ] **Step 4: Implement the sidebar and top bar**

`admin/components/Sidebar.tsx`:

```tsx
'use client'

import { BookOpen, Calendar, DoorOpen, LayoutDashboard, Wallet, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { initials } from '@/lib/format'

interface Section {
  label: string
  icon: LucideIcon
  /** Absent until the section is built (slices 2 and 3). */
  href?: string
}

// "Needs attention" is deferred with no slice, so it is left out entirely.
const SECTIONS: Section[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Bookings', icon: Calendar },
  { label: 'Catalogue', icon: BookOpen },
  { label: 'Resources', icon: DoorOpen },
  { label: 'Fines', icon: Wallet },
]

export function Sidebar({ userName, onLogOut }: { userName: string; onLogOut: () => void }) {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Console"
      style={{
        width: 212, flex: 'none', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column',
        padding: '18px 12px', gap: 2, position: 'sticky', top: 0, height: '100vh', boxSizing: 'border-box',
        borderRight: '1px solid var(--color-divider)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 16px' }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--color-accent-2-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <BookOpen size={15} strokeWidth={2.75} color="var(--color-accent-2-800)" aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, lineHeight: 1.1 }}>SmartLib</div>
          <div style={{ fontSize: 10.5, opacity: 0.55 }}>Admin console</div>
        </div>
      </div>

      {SECTIONS.map(({ label, icon: Icon, href }) => {
        if (!href) {
          return (
            <button key={label} type="button" className="sla-nav-btn" disabled style={{ background: 'transparent', color: 'var(--color-text)' }}>
              <Icon size={17} strokeWidth={2.75} aria-hidden="true" />
              <span>{label}</span>
              <span className="sla-soon">Coming soon</span>
            </button>
          )
        }
        const active = pathname === href
        return (
          <Link
            key={label}
            href={href}
            className="sla-nav-btn"
            aria-current={active ? 'page' : undefined}
            style={{
              background: active ? 'var(--color-accent-100)' : 'transparent',
              color: active ? 'var(--color-accent-800)' : 'var(--color-text)',
              textDecoration: 'none',
            }}
          >
            <Icon size={17} strokeWidth={2.75} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        )
      })}

      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', borderTop: '1px solid var(--color-divider)', marginTop: 8 }}>
        <div
          aria-hidden="true"
          style={{
            width: 28, height: 28, borderRadius: '50%', background: 'var(--color-accent-100)', color: 'var(--color-accent-800)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontSize: 11, flex: 'none',
          }}
        >
          {initials(userName)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
          <div style={{ fontSize: 10.5, opacity: 0.55 }}>Librarian admin</div>
          <button type="button" className="sla-link-btn" onClick={onLogOut}>Log out</button>
        </div>
      </div>
    </nav>
  )
}
```

`admin/components/TopBar.tsx`:

```tsx
'use client'

import { todayLabel } from '@/lib/format'

const LIBRARY_TIMEZONE = process.env.NEXT_PUBLIC_LIBRARY_TIMEZONE ?? 'Asia/Kolkata'

export function TopBar({ title }: { title: string }) {
  return (
    <header
      style={{
        flex: 'none', padding: '16px 28px', borderBottom: '1px solid var(--color-divider)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 19, fontFamily: 'var(--font-heading)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </h2>
      <span className="text-muted" style={{ fontSize: 12, flex: 'none' }}>{todayLabel(new Date(), LIBRARY_TIMEZONE)}</span>
    </header>
  )
}
```

- [ ] **Step 5: Implement the console layout**

`admin/app/(console)/layout.tsx`:

```tsx
'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { ConsoleGuard, useSession } from '@/lib/session'

const PAGE_TITLES: Record<string, string> = { '/dashboard': 'Dashboard' }

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleGuard>
      <ConsoleFrame>{children}</ConsoleFrame>
    </ConsoleGuard>
  )
}

function ConsoleFrame({ children }: { children: ReactNode }) {
  const { user, logOut } = useSession()
  const pathname = usePathname()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      <Sidebar userName={user.name} onLogOut={logOut} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TopBar title={PAGE_TITLES[pathname] ?? 'Dashboard'} />
        <main style={{ flex: 1, overflow: 'auto', padding: '22px 28px 40px' }}>{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/components` → PASS (5 tests). Then `npm test` → all pass.

- [ ] **Step 7: Hand off the commit**

```bash
git add components/Sidebar.tsx components/TopBar.tsx "app/(console)/layout.tsx" test/components
git commit -m "admin: add the console shell" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Dashboard

**Files:**
- Create: `admin/lib/metrics.ts`, `admin/components/dashboard/KpiCard.tsx`, `UtilisationChart.tsx`, `RankedBars.tsx`, `DashboardStates.tsx`, `DashboardView.tsx`, `admin/app/(console)/dashboard/page.tsx`
- Test: `admin/test/app/dashboard.test.tsx`

**Interfaces:**
- Consumes: `apiRequest`, `ApiError` (Task 9); `pointsDelta`, `countDelta`, `slotRange`, `weekdayShort` (Task 8). The response shapes match the backend's `UtilizationDto`, `CirculationDto`, `OverdueDto` and `DemandDto` (Tasks 2–3).
- Produces: `interface DashboardMetrics { utilization; circulation; overdue; demand }`, `fetchDashboardMetrics(): Promise<DashboardMetrics>`, `isEmpty(m: DashboardMetrics): boolean`; the `/dashboard` page.

- [ ] **Step 1: Write the failing tests**

`admin/test/app/dashboard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DashboardPage from '@/app/(console)/dashboard/page'
import type { DashboardMetrics } from '@/lib/metrics'
import { json, mockFetch } from '../helpers'

const METRICS: DashboardMetrics = {
  utilization: {
    today: { date: '2026-10-15', percent: 74, lastWeekPercent: 68 },
    days: [
      { date: '2026-10-09', seatPercent: 62, roomPercent: 58 },
      { date: '2026-10-10', seatPercent: 70, roomPercent: 64 },
      { date: '2026-10-11', seatPercent: 75, roomPercent: 80 },
      { date: '2026-10-12', seatPercent: 68, roomPercent: 72 },
      { date: '2026-10-13', seatPercent: 80, roomPercent: 88 },
      { date: '2026-10-14', seatPercent: 54, roomPercent: 40 },
      { date: '2026-10-15', seatPercent: 48, roomPercent: 35 },
    ],
  },
  circulation: {
    borrows: 142,
    returns: 118,
    topTitles: [
      { bookId: 'b1', title: 'Introduction to Algorithms', borrows: 23 },
      { bookId: 'b8', title: 'Clean Code', borrows: 19 },
    ],
  },
  overdue: { count: 9, countYesterday: 7 },
  demand: {
    areas: [
      { area: 'Group study rooms', percent: 92, busiestSlot: '2:00 PM' },
      { area: 'Silent Zone', percent: 68, busiestSlot: '10:00 AM' },
    ],
  },
}

const EMPTY: DashboardMetrics = {
  utilization: { today: { date: '2026-10-15', percent: 0, lastWeekPercent: 0 }, days: METRICS.utilization.days.map((d) => ({ ...d, seatPercent: 0, roomPercent: 0 })) },
  circulation: { borrows: 0, returns: 0, topTitles: [] },
  overdue: { count: 0, countYesterday: 0 },
  demand: { areas: [{ area: 'Silent Zone', percent: 0, busiestSlot: null }] },
}

function serve(m: DashboardMetrics, status = 200) {
  const reply = (body: unknown) => () => (status === 200 ? json(200, body) : json(status, { error: 'Something went wrong.' }))
  return mockFetch({
    'GET /admin/metrics/utilization': reply(m.utilization),
    'GET /admin/metrics/circulation': reply(m.circulation),
    'GET /admin/metrics/overdue': reply(m.overdue),
    'GET /admin/metrics/demand': reply(m.demand),
  })
}

describe('Dashboard', () => {
  it('shows the loading skeleton while the metrics load', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    render(<DashboardPage />)
    expect(screen.getByLabelText('Loading dashboard metrics')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows all four metrics', async () => {
    serve(METRICS)
    render(<DashboardPage />)
    expect(await screen.findByText('74%')).toBeInTheDocument()
    expect(screen.getByText('+6 pts vs last week')).toBeInTheDocument()
    expect(screen.getByText('142 / 118')).toBeInTheDocument()
    expect(screen.getByText('Borrows / returns')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('+2 since yesterday')).toBeInTheDocument()
    expect(screen.getAllByText('Group study rooms')).toHaveLength(2) // Peak demand card and the demand list
    expect(screen.getByText('92% booked, 2–3 PM busiest')).toBeInTheDocument()
    expect(screen.getByText('Seat & room utilisation, last 7 days')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Tue: seats 80%, rooms 88%' })).toBeInTheDocument()
    expect(screen.getByText('Top titles, last 7 days')).toBeInTheDocument()
    expect(screen.getByText('Introduction to Algorithms')).toBeInTheDocument()
    expect(screen.getByText('Resource demand, last 7 days')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
  })

  it('offers Retry after a failure, and loads when retried', async () => {
    serve(METRICS, 500)
    render(<DashboardPage />)
    expect(await screen.findByText("Couldn't load dashboard metrics")).toBeInTheDocument()
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument()
    serve(METRICS)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('74%')).toBeInTheDocument()
  })

  it('shows the empty state before any activity', async () => {
    serve(EMPTY)
    render(<DashboardPage />)
    expect(await screen.findByText('No activity recorded yet')).toBeInTheDocument()
    expect(
      screen.getByText('Utilisation, circulation and demand metrics will appear here once bookings and loans start coming in.'),
    ).toBeInTheDocument()
  })

  it('copes with no busiest slot and with no resources at all', async () => {
    serve({ ...METRICS, demand: { areas: [{ area: 'Silent Zone', percent: 5, busiestSlot: null }] } })
    const { unmount } = render(<DashboardPage />)
    expect(await screen.findByText('5% booked')).toBeInTheDocument()
    unmount()
    serve({ ...METRICS, demand: { areas: [] } })
    render(<DashboardPage />)
    expect(await screen.findByText('No resources yet')).toBeInTheDocument()
  })

  it('leaves an ended session to the session guard instead of showing an error', async () => {
    const fetch = serve(METRICS, 401)
    render(<DashboardPage />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    expect(screen.queryByText("Couldn't load dashboard metrics")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/app/dashboard.test.tsx` → FAIL, cannot resolve `@/app/(console)/dashboard/page` and `@/lib/metrics`.

- [ ] **Step 3: Implement the metrics module**

`admin/lib/metrics.ts`:

```ts
import { apiRequest } from './api'

// Response shapes of GET /admin/metrics/* (backend: src/services/adminMetrics.ts).
export interface Utilization {
  today: { date: string; percent: number; lastWeekPercent: number }
  days: { date: string; seatPercent: number; roomPercent: number }[]
}

export interface Circulation {
  borrows: number
  returns: number
  topTitles: { bookId: string; title: string; borrows: number }[]
}

export interface Overdue {
  count: number
  countYesterday: number
}

export interface Demand {
  areas: { area: string; percent: number; busiestSlot: string | null }[]
}

export interface DashboardMetrics {
  utilization: Utilization
  circulation: Circulation
  overdue: Overdue
  demand: Demand
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const [utilization, circulation, overdue, demand] = await Promise.all([
    apiRequest<Utilization>('/admin/metrics/utilization'),
    apiRequest<Circulation>('/admin/metrics/circulation'),
    apiRequest<Overdue>('/admin/metrics/overdue'),
    apiRequest<Demand>('/admin/metrics/demand'),
  ])
  return { utilization, circulation, overdue, demand }
}

/** No bookings in the 7 days, no borrows or returns, and nothing overdue. */
export function isEmpty(m: DashboardMetrics): boolean {
  return (
    m.utilization.days.every((d) => d.seatPercent === 0 && d.roomPercent === 0) &&
    m.circulation.borrows === 0 &&
    m.circulation.returns === 0 &&
    m.overdue.count === 0
  )
}
```

- [ ] **Step 4: Implement the Dashboard pieces**

`admin/components/dashboard/KpiCard.tsx`:

```tsx
import type { CSSProperties } from 'react'

export function KpiCard({
  kicker, value, note, valueStyle, noteStyle,
}: {
  kicker: string
  value: string
  note?: string
  valueStyle?: CSSProperties
  noteStyle?: CSSProperties
}) {
  return (
    <div className="card elev-sm" style={{ padding: '14px 16px' }}>
      <span className="card-kicker">{kicker}</span>
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 26, ...valueStyle }}>{value}</span>
      {note && <span className="text-muted" style={{ fontSize: 12, ...noteStyle }}>{note}</span>}
    </div>
  )
}
```

`admin/components/dashboard/UtilisationChart.tsx`:

```tsx
import { weekdayShort } from '@/lib/format'
import type { Utilization } from '@/lib/metrics'

const MAX_BAR = 110

function barHeight(percent: number): number {
  return Math.round((Math.min(100, Math.max(0, percent)) / 100) * MAX_BAR)
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

export function UtilisationChart({ days }: { days: Utilization['days'] }) {
  return (
    <div className="card elev-sm" style={{ padding: '16px 18px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <span className="card-title" style={{ fontSize: 14 }}>Seat &amp; room utilisation, last 7 days</span>
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5 }}>
          <Legend color="var(--color-accent-600)" label="Seats" />
          <Legend color="var(--color-accent-2-600)" label="Rooms" />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 140 }}>
        {days.map((d) => (
          <div
            key={d.date}
            role="img"
            aria-label={`${weekdayShort(d.date)}: seats ${d.seatPercent}%, rooms ${d.roomPercent}%`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end', minWidth: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: MAX_BAR }}>
              <div style={{ width: 12, height: barHeight(d.seatPercent), background: 'var(--color-accent-600)', borderRadius: '3px 3px 0 0' }} />
              <div style={{ width: 12, height: barHeight(d.roomPercent), background: 'var(--color-accent-2-600)', borderRadius: '3px 3px 0 0' }} />
            </div>
            <span className="text-muted" style={{ fontSize: 11 }} aria-hidden="true">{weekdayShort(d.date)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

`admin/components/dashboard/RankedBars.tsx`:

```tsx
export interface RankedRow {
  key: string
  label: string
  value: number
  display: string
}

/** A titled list of rows with bars. `scaleMax: 'top'` scales bars to the largest row. */
export function RankedBars({
  title, rows, scaleMax, color, emptyText,
}: {
  title: string
  rows: RankedRow[]
  scaleMax: number | 'top'
  color: string
  emptyText: string
}) {
  const max = scaleMax === 'top' ? Math.max(1, ...rows.map((r) => r.value)) : scaleMax
  return (
    <div className="card elev-sm" style={{ padding: '16px 18px' }}>
      <span className="card-title" style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>{title}</span>
      {rows.length === 0 ? (
        <span className="text-muted" style={{ fontSize: 12.5 }}>{emptyText}</span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
              <span title={r.label} style={{ fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.label}
              </span>
              <div aria-hidden="true" style={{ width: 80, height: 6, background: 'var(--color-neutral-200)', borderRadius: 3, flex: 'none', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(Math.min(1, r.value / max) * 100)}%`, height: '100%', background: color }} />
              </div>
              <span className="text-muted" style={{ fontSize: 11.5, width: 34, textAlign: 'right', flex: 'none' }}>{r.display}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

`admin/components/dashboard/DashboardStates.tsx`:

```tsx
import { TrendingUp, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

const centered: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '70px 20px', textAlign: 'center',
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard metrics">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="sla-skel" style={{ height: 76 }} />)}
      </div>
      <div className="sla-skel" style={{ height: 180, marginBottom: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div className="sla-skel" style={{ height: 200 }} />
        <div className="sla-skel" style={{ height: 200 }} />
      </div>
    </div>
  )
}

export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" style={centered}>
      <TriangleAlert size={30} strokeWidth={2.5} color="var(--color-neutral-600)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>Couldn&apos;t load dashboard metrics</h3>
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Check your connection and try again.</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function DashboardEmpty() {
  return (
    <div style={centered}>
      <TrendingUp size={30} strokeWidth={2.5} color="var(--color-neutral-500)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>No activity recorded yet</h3>
      <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: '36ch' }}>
        Utilisation, circulation and demand metrics will appear here once bookings and loans start coming in.
      </p>
    </div>
  )
}
```

`admin/components/dashboard/DashboardView.tsx`:

```tsx
import { countDelta, pointsDelta, slotRange } from '@/lib/format'
import type { DashboardMetrics } from '@/lib/metrics'
import { KpiCard } from './KpiCard'
import { RankedBars } from './RankedBars'
import { UtilisationChart } from './UtilisationChart'

export function DashboardView({ metrics }: { metrics: DashboardMetrics }) {
  const { utilization: u, circulation: c, overdue: o, demand: d } = metrics
  const peak = d.areas[0]
  const peakNote = peak && `${peak.percent}% booked${peak.busiestSlot ? `, ${slotRange(peak.busiestSlot)} busiest` : ''}`

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 18 }}>
        <KpiCard
          kicker="Utilisation today"
          value={`${u.today.percent}%`}
          note={pointsDelta(u.today.percent, u.today.lastWeekPercent)}
          noteStyle={{ color: 'var(--color-accent-2-800)' }}
        />
        <KpiCard kicker="Circulation, 7 days" value={`${c.borrows} / ${c.returns}`} note="Borrows / returns" />
        <KpiCard
          kicker="Overdue materials"
          value={String(o.count)}
          valueStyle={{ color: 'var(--color-accent-700)' }}
          note={countDelta(o.count, o.countYesterday)}
        />
        <KpiCard
          kicker="Peak demand"
          value={peak ? peak.area : 'No resources yet'}
          valueStyle={{ fontSize: 19 }}
          note={peakNote || undefined}
        />
      </div>

      <UtilisationChart days={u.days} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <RankedBars
          title="Top titles, last 7 days"
          rows={c.topTitles.map((t) => ({ key: t.bookId, label: t.title, value: t.borrows, display: String(t.borrows) }))}
          scaleMax="top"
          color="var(--color-accent-600)"
          emptyText="No borrows in the last 7 days."
        />
        <RankedBars
          title="Resource demand, last 7 days"
          rows={d.areas.map((a) => ({ key: a.area, label: a.area, value: a.percent, display: `${a.percent}%` }))}
          scaleMax={100}
          color="var(--color-accent-2-600)"
          emptyText="No resources yet."
        />
      </div>
    </>
  )
}
```

- [ ] **Step 5: Implement the page**

`admin/app/(console)/dashboard/page.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardEmpty, DashboardError, DashboardSkeleton } from '@/components/dashboard/DashboardStates'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ApiError } from '@/lib/api'
import { fetchDashboardMetrics, isEmpty, type DashboardMetrics } from '@/lib/metrics'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; metrics: DashboardMetrics }

export default function DashboardPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(() => {
    setState({ kind: 'loading' })
    fetchDashboardMetrics()
      .then((metrics) => setState({ kind: 'loaded', metrics }))
      .catch((error: unknown) => {
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
        setState({ kind: 'error' })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (state.kind === 'loading') return <DashboardSkeleton />
  if (state.kind === 'error') return <DashboardError onRetry={load} />
  return isEmpty(state.metrics) ? <DashboardEmpty /> : <DashboardView metrics={state.metrics} />
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/app/dashboard.test.tsx` → PASS (6 tests). Then `npm test` → all pass, and `npm run build` → completes.

- [ ] **Step 7: Hand off the commit**

```bash
git add lib/metrics.ts components/dashboard "app/(console)/dashboard/page.tsx" test/app/dashboard.test.tsx
git commit -m "admin: add the analytics Dashboard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Live check, docs and deployment hand-off

**Files:**
- Create: `admin/README.md`
- Modify: root `SmartLib/CLAUDE.md` if Task 7's edits need adjusting (not under git)

**Interfaces:**
- Consumes: everything above, running together.

- [ ] **Step 1: Create a dev admin without showing its password**

The prompts in `create-admin` need an interactive terminal, so call the service from a temporary script. Generate the password into this session's scratchpad (`C:/Users/ragha/AppData/Local/Temp/claude/c--Users-ragha-project-SmartLib/5085a232-4d7a-422a-a5a9-c59ea926f657/scratchpad`, called `$SCRATCH` below), outside both repositories, and never print it.

```bash
SCRATCH="C:/Users/ragha/AppData/Local/Temp/claude/c--Users-ragha-project-SmartLib/5085a232-4d7a-422a-a5a9-c59ea926f657/scratchpad"
node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))" > "$SCRATCH/dev-admin-password.txt"
```

Create `backend/zz-dev-admin.ts` (temporary):

```ts
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { prisma } from './src/lib/prisma'
import { createOrPromoteAdmin } from './src/services/adminAccountService'

const password = readFileSync(process.argv[2], 'utf8')
createOrPromoteAdmin({ name: 'Dev Librarian', email: 'dev.admin@thapar.edu', password }, async () => true)
  .then((result) => console.log(result))
  .finally(() => prisma.$disconnect())
```

Run (in `backend/`): `npx tsx zz-dev-admin.ts "$SCRATCH/dev-admin-password.txt"` → prints `created` (or `promoted` on a re-run). Then delete `backend/zz-dev-admin.ts`. This writes the dev database only.

- [ ] **Step 2: Start the backend and the console**

In `backend/` (background): `npm run dev`. Wait for `Node backend running on port 3000`.
In `admin/`: `cp .env.example .env.local`, then (background) `npm run dev`. Wait for the ready line on port 3001.

- [ ] **Step 3: Compare every number with the database**

Log in through the API and fetch the four metrics:

```bash
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"dev.admin@thapar.edu\",\"password\":\"$(cat "$SCRATCH/dev-admin-password.txt")\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['token'])")
for m in utilization circulation overdue demand; do curl -s localhost:3000/admin/metrics/$m -H "Authorization: Bearer $TOKEN"; echo; done
```

Then recompute the same numbers independently of `adminMetrics.ts`. Create `backend/zz-check-metrics.ts` (temporary):

```ts
import 'dotenv/config'
import { prisma } from './src/lib/prisma'

const now = new Date()
const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
const open = new Date(day(0).getTime() + 9 * 3600e3)
const close = new Date(day(0).getTime() + 20 * 3600e3)

async function main() {
  const borrows = await prisma.loan.count({ where: { borrowedAt: { gte: day(-6), lte: now } } })
  const returns = await prisma.loan.count({ where: { returnedAt: { gte: day(-6), lte: now } } })
  const overdue = await prisma.loan.count({ where: { returnedAt: null, dueAt: { lt: now } } })
  const resources = await prisma.resource.count()
  const bookings = await prisma.resourceBooking.findMany({
    where: { status: { not: 'cancelled' }, startTime: { lt: close }, endTime: { gt: open } },
    select: { startTime: true, endTime: true },
  })
  const hours = bookings.reduce(
    (sum, b) => sum + Math.max(0, Math.min(+b.endTime, +close) - Math.max(+b.startTime, +open)) / 3600e3,
    0,
  )
  console.log({ borrows, returns, overdue, todayPercent: Math.round((100 * hours) / (resources * 11)) })
}

main().finally(() => prisma.$disconnect())
```

Run (in `backend/`): `npx tsx zz-check-metrics.ts`, then delete `backend/zz-check-metrics.ts`.

Expected: `borrows`, `returns` and `overdue` equal the API's `circulation.borrows`, `circulation.returns` and `overdue.count`; `todayPercent` equals `utilization.today.percent`. Any mismatch is a bug in Tasks 2–4; fix it before continuing.

- [ ] **Step 4: Check the console in a browser**

With the Claude in Chrome tools (load them in one ToolSearch call), open `http://localhost:3001` in a new tab:

1. The root redirects to `/login`.
2. Log in as `dev.admin@thapar.edu` with the password from the scratch file (type it; do not echo it in chat).
3. The Dashboard shows the four cards, the chart and both lists, with the same numbers as Step 3.
4. Bookings, Catalogue, Resources and Fines are greyed out with "Coming soon".
5. Log out returns to `/login`.
6. Log in as the demo student `aditi.sharma@thapar.edu` / `password123`: the page says "This account doesn't have admin access."

Take one screenshot of the loaded Dashboard (save it for the report), then close the tab.

- [ ] **Step 5: Stop the servers and clean up**

Stop both background dev servers. If a process still listens on port 3000 or 3001, stop that listener. Delete `"$SCRATCH/dev-admin-password.txt"`. (The dev admin account stays in the dev database; re-running the seed does not remove it.)

- [ ] **Step 6: Write the console README**

`admin/README.md`:

````markdown
# SmartLib — Admin Console

The librarian console for SmartLib: log in with an admin account and see live
utilisation, circulation, overdue and demand metrics. Built with Next.js and
the Organic design system; talks only to the SmartLib API (`../backend`).

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

## Design

The spec and plan for this slice are in `docs/`. Slices 2 (Bookings, Resources)
and 3 (Catalogue, Fines, student drawer) follow; their sidebar entries show
"Coming soon" until then.
````

- [ ] **Step 7: Hand off the commit and the owner's deployment steps**

```bash
git add README.md
git commit -m "admin: document setup and deployment" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

Then give the owner the spec's Section 8 actions, in order: set `TZ=Asia/Kolkata` on Render (if not done); create the Vercel project with the two variables; add the Vercel origin to `CORS_ORIGINS`; run `npm run create-admin` against production; re-run the seed against production for the history; then open the Vercel URL and log in.
