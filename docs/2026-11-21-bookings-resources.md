# Admin Console Slice 4 (Bookings and Resources) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give librarians a Resources page (list, add, edit, take offline and online) and a Bookings page (list, cancel, reassign), with students seeing library cancels and moves, and every change reaching open consoles live.

**Architecture:** New admin services and routes in the Node API, behind the existing `/admin` guard, plus two new live-event topics. The console gets two pages built one at a time (Resources, then Bookings) on a shared dialog extracted from the existing decline dialog. The Flutter app gains one booking state.

**Tech Stack:** Node 22, Express 5, Prisma 7, PostgreSQL (`btree_gist`), Zod, Vitest + Supertest (backend); Next.js, React, Vitest + Testing Library (admin); Flutter, Riverpod, `json_serializable` (frontend).

**Spec:** `docs/superpowers/specs/2026-11-21-bookings-resources-design.md` (read it first; the design canvas `docs/superpowers/assets/admin-console/canvas-source.dc.html` is the visual authority for both pages).

## Global Constraints

- Run package scripts from inside that package (`cd backend && ...`, `cd admin && ...`, `cd frontend && ...`).
- **Never run `git add`, `git commit`, `git push` or any state-changing git.** Each task ends with the exact commit commands for the owner, prefixed `backend:`, `admin:` or `frontend:`, with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never edit `backend/src/generated/**` by hand (regenerate with `npx prisma generate`), `frontend/build/**`, `.dart_tool/**`, `node_modules/`. Never read `backend/.env`. Never print or read the dev admin password file; pass it only as a file path to a script.
- Reasons and notes: trimmed, optional, at most 300 characters. Names and locations at most 100. Capacity an integer 1–100.
- Every route sits behind the existing `/admin` guard (401 without a token, 403 for a student).
- Cancel and reassign are conditional updates; neither changes a reliability score.
- The `no_overlapping_bookings` constraint is unchanged (`WHERE status IN ('requested','booked','checked_in')`).
- Times are stored in UTC and shown in the library time zone (`LIBRARY_TIMEZONE` in `admin/lib/format.ts`). Page size 25 (max 100), newest start time first.
- Tests derive dates from `new Date()`, never from fixed calendar dates (the existing `bookings.test.ts` fixed-date problem on 2027-01-10 is out of scope here but must not be copied).
- Copy: error strings are specific; never "Something went wrong" when the server gave a reason.

## Review Focus

Inputs and conditions the spec implies but its feature tests would not otherwise exercise. Each has an owning task below.

1. A student checks in or cancels at the same instant a librarian cancels or reassigns: exactly one wins, the loser gets a specific 409 (Task 8).
2. The reassign target is booked or taken offline between fetching the options and confirming: clean 409, booking unchanged (Task 8).
3. A resource goes offline while a student sits on the confirm screen, or has existing bookings: the confirm gets a readable 409, existing bookings stay checkable and cancellable (Tasks 3, 8).
4. Search text with `%`, `_`, quotes or only spaces, a page past the last page, `pageSize` over 100: no error, no wrong rows (Task 7).
5. Derived-status boundaries: exactly at the grace end, exactly at a checked-in booking's end (Task 7).
6. An older app receiving the new `cancelledByLibrary` status shows the update notice instead of failing the list (Task 12).

---

### Task 1: Schema, events and publisher wiring (backend)

**Files:**
- Modify: `backend/prisma/schema.prisma`; `backend/src/lib/events.ts`; `backend/src/services/bookingService.ts` (publishers only); `backend/src/services/adminRequestService.ts` (`approveRoom` event)
- Create: migration via `npx prisma migrate dev --name console_resources_bookings --create-only`, then review the SQL before applying
- Test: `backend/test/lib/events.test.ts`, `backend/test/routes/bookings.test.ts`, `backend/test/routes/adminRequests.test.ts` (extend; update any existing assertion on the old `activity` event for these actions)

**Interfaces:**
- Produces (schema): `enum ResourceStatus { available offline }`; `Resource.status ResourceStatus @default(available)`; `Resource.statusNote String?`; on `ResourceBooking`: `cancelledById String?` (relation `"BookingCanceller"` to `User`, with the back-relation added on `User`), `cancelledAt DateTime? @db.Timestamptz(3)`, `cancelReason String?`, `movedFromName String?`, `movedAt DateTime? @db.Timestamptz(3)`. A booking is library-cancelled exactly when `cancelledById` is not null. Optionally `@@index([startTime])` for the list's ordering.
- Produces (events): `LiveTopic` gains `'bookings' | 'resources'`; `LiveEventType` gains `'booking.changed' | 'resource.changed'`; `publishBookingChange(): void` publishes `{ type: 'booking.changed', topics: ['bookings', 'metrics'] }`; `publishResourceChange(): void` publishes `{ type: 'resource.changed', topics: ['resources', 'metrics'] }`.

- [ ] **Step 1: Write failing tests.** In `events.test.ts`: `publishBookingChange publishes booking.changed on bookings and metrics`, `publishResourceChange publishes resource.changed on resources and metrics` (use `recordEvents()` from `test/helpers/events.ts`). In `bookings.test.ts`: `a seat booking publishes booking.changed`, `a check-in publishes booking.changed`, `a student cancelling a booked seat publishes booking.changed`, `requesting a room publishes request.created and no booking.changed`. In `adminRequests.test.ts`: `approving a room request publishes request.decided with topics requests, metrics and bookings`; declining one does not include `bookings`.
- [ ] **Step 2: Run** `cd backend && npx vitest run test/lib/events.test.ts test/routes/bookings.test.ts test/routes/adminRequests.test.ts` and confirm the new tests fail for the stated reasons.
- [ ] **Step 3: Edit the schema, create the migration (`--create-only`), check the SQL is purely additive (`CREATE TYPE`, `ADD COLUMN` nullable or defaulted, `CREATE INDEX`), then `npx prisma migrate dev` and `node scripts/migrate-test-db.mjs` and `npx prisma generate`.** The seed needs no change: new resources default to `available`.
- [ ] **Step 4: Implement the two publish helpers in `events.ts`; replace `publishActivity()` with `publishBookingChange()` in `createBooking` (seat branch), `checkInBooking` and `cancelBooking` (non-withdrawal branch); add `'bookings'` to `approveRoom`'s topics.**
- [ ] **Step 5: Run the three test files, then the whole suite (`npm test`) and `npm run typecheck`.** Expected: all pass; fix any existing assertion that named the old event.
- [ ] **Step 6: Report the commit commands** (`git add backend/prisma backend/src backend/test` / `backend: add resource status, library-cancel columns and booking/resource live topics`).

### Task 2: Admin resources endpoints (backend)

**Files:**
- Create: `backend/src/services/adminResourceService.ts`, `backend/src/schemas/adminResources.ts`
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminResources.test.ts`

**Interfaces:**
- Consumes: `publishResourceChange()` (Task 1); `HOLDING_STATUSES` from `bookingService`; `NotFoundError`, `ConflictError` from `lib/httpError`.
- Produces:
  ```ts
  interface AdminResourceDto { id: string; type: 'seat' | 'room'; name: string; location: string | null; capacity: number;
    status: 'available' | 'offline'; statusNote: string | null; upcomingBookings: number }
  listResources(type?: 'seat' | 'room', now?: Date): Promise<AdminResourceDto[]>        // name order
  createResource(input: { type: 'seat' | 'room'; name: string; location?: string | null; capacity: number }): Promise<AdminResourceDto>
  updateResource(id: string, input: { name?: string; location?: string | null; capacity?: number }): Promise<AdminResourceDto>
  takeOffline(id: string, note: string | null): Promise<AdminResourceDto>
  bringOnline(id: string): Promise<AdminResourceDto>
  ```
  Routes: `GET /admin/resources?type=`, `POST /admin/resources` (201), `PATCH /admin/resources/:id`, `POST /admin/resources/:id/offline` (body `{note?}`, default `{}`), `POST /admin/resources/:id/online`. Plan call: `upcomingBookings` counts holding bookings with `endTime > now` (in progress or later), because those are the bookings that stay when a resource goes offline.

- [ ] **Step 1: Write failing tests in `adminResources.test.ts`** (helpers copied from `adminRequests.test.ts`): `is for admins only` (401 anonymous, 403 student, on all five routes); `lists resources in name order with status and upcoming count` (an in-progress booking and a past one: only the in-progress counts); `filters by type`; `creates a resource` (201, `status: 'available'`) and `rejects a blank name, a 101-character name, capacity 0 and capacity 101`; `edits name, location and capacity but ignores a type in the body` (400 or ignored: assert `type` unchanged); `PATCH with no fields is rejected`; `takes a resource offline with a note and shows it in the list`; `taking an offline resource offline again answers 409 "This resource is already offline."`; `bringing an available resource online answers 409 "This resource is already online."`; `unknown id answers 404`; `every write publishes resource.changed once, and refused writes publish nothing`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminResources.test.ts`; expect failures for missing routes.
- [ ] **Step 3: Implement `schemas/adminResources.ts` (zod: query, create, update with at-least-one-field refine, offline body trimmed `note` max 300, `.default({})`) and the five service functions; add the routes to `admin.ts` using `validate({...})` like the existing routes.** Offline/online transitions are conditional updates (`updateMany` on the current status) so two librarians clicking at once give one 409.
- [ ] **Step 4: Run the file, then `npm test` and `npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Report the commit commands** (`backend: add admin resource endpoints`).

### Task 3: Offline resources stop taking bookings (backend)

**Files:**
- Modify: `backend/src/services/resourceService.ts` (`getAvailability`), `backend/src/services/bookingService.ts` (`createBooking`, `findAlternatives`)
- Test: `backend/test/routes/resources.test.ts`, `backend/test/routes/bookings.test.ts`

**Interfaces:**
- Consumes: `Resource.status` (Task 1).
- Produces: behavior only. `GET /resources/availability` omits offline resources; `POST /bookings` for an offline resource answers 409 `"This resource is offline right now."` with no `alternatives`; conflict alternatives never suggest an offline resource; existing bookings on an offline resource are untouched (still listed, checkable, cancellable).

- [ ] **Step 1: Write failing tests:** `availability leaves out offline resources`; `booking an offline resource answers 409 with the offline message and no alternatives`; `alternatives never suggest an offline resource` (book a taken slot with the only other seat offline: `alternatives` has no entry for it); `a student can still check in to and cancel a booking on a resource that went offline`.
- [ ] **Step 2: Run both files;** expect the four to fail.
- [ ] **Step 3: Filter `status: 'available'` in `getAvailability` and in `findAlternatives`' other-resource query; in `createBooking`, after the not-found check, throw `ConflictError('This resource is offline right now.')` for an offline resource (no `details`).**
- [ ] **Step 4: Run both files, `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: stop offline resources taking new bookings`).

### Task 4: Console foundation: PATCH, live topics, shared dialog (admin)

**Files:**
- Modify: `admin/lib/api.ts`, `admin/lib/live.ts`, `admin/components/requests/DeclineDialog.tsx`
- Create: `admin/components/Dialog.tsx`
- Test: `admin/test/lib/api.test.ts`, `admin/test/components/Dialog.test.tsx`, existing `admin/test/app/requests.test.tsx` (must stay green untouched)

**Interfaces:**
- Produces: `apiRequest` accepts `method?: 'GET' | 'POST' | 'PATCH'`; `LiveTopic = 'requests' | 'metrics' | 'bookings' | 'resources'` and `LiveEventType` gains `'booking.changed' | 'resource.changed'` (mirror `backend/src/lib/events.ts`); `export function Dialog(props: { title: string; onCancel: () => void; children: ReactNode }): JSX.Element` renders the backdrop and `role="dialog"` shell with Escape-cancels, Tab/Shift+Tab staying inside, and focus returning to the opener (move that behavior out of `DeclineDialog`; children supply the body, fields and `.dialog-actions`).

- [ ] **Step 1: Write failing tests:** `api.test.ts` `sends PATCH with a JSON body`; `Dialog.test.tsx`: `Escape calls onCancel`, `Tab from the last button wraps to the first control`, `Shift+Tab from the first wraps to the last`, `focus returns to the opening button after unmount`, `labels the dialog by its title`.
- [ ] **Step 2: Run** `cd admin && npx vitest run test/lib/api.test.ts test/components/Dialog.test.tsx`; expect failures.
- [ ] **Step 3: Implement the three changes; refactor `DeclineDialog` to render through `Dialog` with no change in markup or behavior.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: every existing test (including all of `requests.test.tsx`) still passes.
- [ ] **Step 5: Report the commit commands** (`admin: add PATCH, booking and resource live topics, and a shared dialog`).

### Task 5: Resources page (admin)

**Files:**
- Create: `admin/lib/resources.ts`, `admin/app/(console)/resources/page.tsx`, `admin/components/resources/ResourcesTable.tsx`, `admin/components/resources/ResourceFormDialog.tsx`, `admin/components/resources/OfflineDialog.tsx`, `admin/components/resources/ResourcesStates.tsx`
- Modify: `admin/components/Sidebar.tsx` (give Resources `href: '/resources'`), `admin/app/(console)/layout.tsx` (`PAGE_TITLES['/resources'] = 'Resources'`), `admin/test/components/Sidebar.test.tsx`
- Test: `admin/test/app/resources.test.tsx`, `admin/test/lib/resources.test.ts`

**Interfaces:**
- Consumes: `Dialog` (Task 4), `useLiveRefresh(['resources'], ...)` (`lib/liveContext.tsx`), `useToast` (`components/Toasts.tsx`), the backend routes of Task 2.
- Produces (`lib/resources.ts`):
  ```ts
  interface AdminResource { id: string; type: 'seat' | 'room'; name: string; location: string | null; capacity: number;
    status: 'available' | 'offline'; statusNote: string | null; upcomingBookings: number }
  fetchResources(type?: 'seat' | 'room'): Promise<AdminResource[]>
  createResource(input: { type: 'seat' | 'room'; name: string; location: string; capacity: number }): Promise<AdminResource>
  updateResource(id: string, input: { name: string; location: string; capacity: number }): Promise<AdminResource>
  takeResourceOffline(id: string, note: string): Promise<AdminResource>
  bringResourceOnline(id: string): Promise<AdminResource>
  ```
  The page follows the canvas (type filter, "n resources" count, Add resource button, table Name/Type/Location/Capacity/Status with Edit and Take offline/Bring online, loading skeleton, "No resources match this filter" with Clear filter, "Couldn't load resources" with Retry). It refetches quietly on a `resources` event and keeps the rows on screen if a quiet refetch fails, like the Dashboard page.

- [ ] **Step 1: Write failing tests** with `mockFetch` (`test/helpers.ts`; keys are `METHOD /pathname`): `shows the loading skeleton then the table`; `shows the error state and Retry refetches`; `filters by type and Clear filter restores the list`; `an offline resource shows the Offline tag and its note`; `Add resource posts the form and the new row appears`; `Edit disables the type field and sends PATCH`; `Take offline shows how many upcoming bookings stay, sends the note, and the row updates`; `Bring online sends the request`; `a 409 from the server is shown as a toast and the list refetches`; `buttons are disabled until the list has refetched` (as on the Requests page); `a live resources event refetches without the skeleton`; `Sidebar: Resources is a link, Bookings, Catalogue and Fines still Coming soon`.
- [ ] **Step 2: Run** `npx vitest run test/app/resources.test.tsx test/lib/resources.test.ts test/components/Sidebar.test.tsx`; expect failures.
- [ ] **Step 3: Implement the files above, copying structure from `requests/page.tsx`, `DeclineDialog.tsx` and the canvas; use `lib/format.ts` helpers, `className`s from `styles/ds.css`/`console.css`, and `lucide-react` icons at `strokeWidth={2.75}`.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.** Expected: all pass; `/resources` appears in the route list.
- [ ] **Step 5: Report the commit commands** (`admin: add the Resources page`).

### Task 6: Resources checkpoint (live, all three apps)

**Files:** none (verification only; scratch files in the session scratchpad).

- [ ] **Step 1: Re-seed, create a throwaway dev admin whose password goes only to a scratchpad file, start backend (`npm run dev`), console (`npm run dev` on :3001) and the student web app.** Follow the live-check procedure of the previous slice (`docs/superpowers/reports/2026-10-25-request-approvals-rulings-and-deferred.md`, "Live check"): the owner types the admin password in the console; never print it.
- [ ] **Step 2: Verify in a browser:** the Resources page lists the 7 seeded resources; take "Silent Zone · Desk 3" offline with a note; the student app's seat picker no longer lists it within one refetch; a booking attempt on it via the API answers the 409 message; bring it online and it returns; a second console tab updates without reload; add and edit a resource.
- [ ] **Step 3: Stop only the process trees you started (verify command lines first), delete the password file and scripts, re-seed, and record the result in the plan's ledger.**
- [ ] **Step 4: Report that nothing needs committing**; fix anything found in a new task before Task 7.

### Task 7: Admin bookings list (backend)

**Files:**
- Create: `backend/src/services/adminBookingService.ts`, `backend/src/schemas/adminBookings.ts`
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminBookings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type AdminBookingStatus = 'booked' | 'released' | 'checked_in' | 'completed' | 'cancelled'
  interface AdminBookingDto { id: string; resource: { id: string; name: string; type: 'seat' | 'room' };
    student: { id: string; name: string; email: string }; startTime: Date; endTime: Date; status: AdminBookingStatus;
    cancelledBy: 'student' | 'library' | null; cancelReason: string | null; movedFromName: string | null; canManage: boolean }
  listBookings(q: { search?: string; status?: AdminBookingStatus; page: number; pageSize: number }, now?: Date):
    Promise<{ bookings: AdminBookingDto[]; total: number; page: number; pageSize: number }>
  ```
  Route `GET /admin/bookings?search=&status=&page=&pageSize=` (defaults page 1, pageSize 25; max 100; search trimmed, at most 100 characters). `canManage` is true exactly when the derived status is `booked`.
- Derived status, evaluated in SQL (one `$queryRaw` using `count(*) OVER()` for `total`; pass `now` the way `requestHolds.ts` does):
  | Raw status | Condition | Shown as |
  |---|---|---|
  | `cancelled` | | `cancelled` (`cancelledBy` = `library` if `cancelledById` is set, else `student`) |
  | `completed` | | `completed` |
  | `checked_in` | `endTime <= now` | `completed` |
  | `checked_in` | otherwise | `checked_in` |
  | `booked` | `startTime + gracePeriodMinutes minutes < now` | `released` |
  | `booked` | otherwise | `booked` |
  | `released` | | `released` |
  Rows with raw status `requested`, `declined`, `expired` or `no_show` are never listed. Order: `startTime` descending, then `id`. Search matches student name, student email or resource name, case-insensitively, with `%` and `_` treated as literal text.

- [ ] **Step 1: Write failing tests** (seed users, resources and bookings directly with Prisma): `is for admins only`; `excludes room requests, declined and expired rows`; `derives booked, released, checked_in and completed`; `a booking exactly at the end of its grace period is still booked and one millisecond later is released` (pass `now` to `listBookings` in a service-level test); `a checked-in booking exactly at its end is completed`; `shows who cancelled: student or library, with the reason`; `status filter works on the derived status`; `search matches student, email and resource names, ignoring case`; `search treats % and _ literally` and `a quote in the search is safe`; `a search of only spaces is ignored`; `pages: second page, a page past the end returns an empty list with the right total`; `pageSize 101 is rejected with 400`; `orders newest start first`; `canManage is true only for booked`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminBookings.test.ts`; expect failures.
- [ ] **Step 3: Implement the schema, the SQL-backed `listBookings`, and the route.** Resource and student fields come from the same query (no per-row follow-up queries).
- [ ] **Step 4: Run the file, `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add the admin bookings list`).

### Task 8: Library cancel and reassign (backend)

**Files:**
- Modify: `backend/src/services/adminBookingService.ts`, `backend/src/services/bookingService.ts` (export `isExclusionViolation`), `backend/src/schemas/adminBookings.ts`, `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminBookings.test.ts` (extend), `backend/test/services/adminBookingRaces.test.ts`

**Interfaces:**
- Consumes: `publishBookingChange()` (Task 1); the per-resource advisory lock idiom from `createBooking` (`pg_advisory_xact_lock(hashtext(resourceId))`); `ConflictError`, `NotFoundError`, `ValidationError`.
- Produces:
  ```ts
  cancelBookingAsLibrary(bookingId: string, adminId: string, reason: string | null, now?: Date): Promise<AdminBookingDto>
  listReassignOptions(bookingId: string, now?: Date): Promise<{ id: string; name: string; location: string | null; capacity: number }[]>
  reassignBooking(bookingId: string, resourceId: string, now?: Date): Promise<AdminBookingDto>
  ```
  Routes: `POST /admin/bookings/:id/cancel` (body `{reason?}` trimmed, max 300, default `{}`), `GET /admin/bookings/:id/reassign-options`, `POST /admin/bookings/:id/reassign` (body `{resourceId}`).
- Manageable means raw status `booked` and not past its grace end. Specific refusals (409 unless noted): already cancelled by the library `"Already cancelled by the library."`; cancelled by the student `"The student already cancelled this booking."`; `checked_in` `"The student already checked in."`; released by the clock `"This booking has already been released."`; completed `"This booking has already finished."`; a room request `"This is a room request. Decide it on the Requests page."`; unknown id 404. Cancel updates with `updateMany WHERE id AND status = 'booked'` setting `status: 'cancelled', cancelledById, cancelledAt: now, cancelReason`, and re-reads the row for the message when the count is 0. Options: online resources of the same type, other than the current one, with no holding booking overlapping the booking's range. Reassign runs in a transaction that takes the target's advisory lock, re-checks manageable and that the target exists, is online (409 `"That resource is offline."`) and of the same type (400), then updates `resourceId`, `movedFromName` (the old resource's name) and `movedAt: now`; an exclusion violation becomes 409 `"That resource is taken at this time."`.

- [ ] **Step 1: Write failing tests** (extend `adminBookings.test.ts`): `cancel frees the slot (a student can then book it) and records who, when and why`; `cancel without a body or reason succeeds with a null reason`; `a reason over 300 characters is rejected`; one test per refusal message above; `cancel publishes booking.changed once, a refused cancel publishes nothing`; `reassign options exclude the current resource, offline ones, other types and busy ones`; `options for a booking that cannot be managed answer the same refusal`; `reassign moves the booking and records movedFromName and movedAt`; `reassign to a resource of the other type is 400`; `reassign to an offline resource is 409`; `reassign to a busy resource is 409 "That resource is taken at this time." and the booking is unchanged`; `neither action changes the student's reliability score`; `a student can no longer check in to or cancel a library-cancelled booking`. In `adminBookingRaces.test.ts`: `a librarian cancel and a student check-in at once: exactly one succeeds`; `a librarian cancel and a student cancel at once: exactly one wins and the loser sees the specific message`; `two reassigns of different bookings to one target: exactly one succeeds` (use `Promise.all`; run the file several times to check stability, as `requestHolds` race tests do).
- [ ] **Step 2: Run both files;** expect failures.
- [ ] **Step 3: Implement the three functions, the schemas and the routes.**
- [ ] **Step 4: Run both files three times, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add library cancel and reassign for bookings`).

### Task 9: Students see library cancels and moves (backend)

**Files:**
- Modify: `backend/src/services/bookingService.ts` (`BookingDto`, `toBookingDto`, `listMyBookings`), `backend/README.md`, `backend/CLAUDE.md`
- Test: `backend/test/routes/bookings.test.ts`

**Interfaces:**
- Consumes: the columns of Task 1 and the library cancel of Task 8.
- Produces: `BookingDto.frontendStatus` gains `'cancelledByLibrary'`; `BookingDto` gains `cancelReason: string | null` (set only when library-cancelled) and `movedFrom: string | null` (the old resource's name, only within `REQUEST_OUTCOME_VISIBLE_DAYS` of `movedAt`). `GET /bookings/me` lists a library-cancelled booking for `REQUEST_OUTCOME_VISIBLE_DAYS` after `cancelledAt` and then drops it; a student's own cancel stays hidden as today.

- [ ] **Step 1: Write failing tests:** `a library-cancelled booking is listed as cancelledByLibrary with its reason`; `it disappears after 7 days`; `a cancel by the student is still not listed`; `a moved booking shows the new resource name and movedFrom`; `movedFrom is null after 7 days`; `an existing booking has null cancelReason and movedFrom`.
- [ ] **Step 2: Run** `npx vitest run test/routes/bookings.test.ts`; expect the new tests to fail.
- [ ] **Step 3: Implement the DTO fields and the extra `OR` branch in `listMyBookings`; document the new status and endpoints in `README.md` (endpoint table) and `CLAUDE.md`.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: show library cancels and moves to students`).

### Task 10: Bookings page: list, search, filter, paging (admin)

**Files:**
- Create: `admin/lib/bookings.ts`, `admin/app/(console)/bookings/page.tsx`, `admin/components/bookings/BookingsTable.tsx`, `admin/components/bookings/Pager.tsx`, `admin/components/bookings/BookingsStates.tsx`
- Modify: `admin/components/Sidebar.tsx` (Bookings `href: '/bookings'`), `admin/app/(console)/layout.tsx` (title), `admin/test/components/Sidebar.test.tsx`
- Test: `admin/test/app/bookings.test.tsx`, `admin/test/lib/bookings.test.ts`

**Interfaces:**
- Produces (`lib/bookings.ts`):
  ```ts
  type BookingStatus = 'booked' | 'released' | 'checked_in' | 'completed' | 'cancelled'
  interface AdminBooking { id: string; resource: { id: string; name: string; type: 'seat' | 'room' }; student: { id: string; name: string; email: string };
    startTime: string; endTime: string; status: BookingStatus; cancelledBy: 'student' | 'library' | null;
    cancelReason: string | null; movedFromName: string | null; canManage: boolean }
  interface BookingsPage { bookings: AdminBooking[]; total: number; page: number; pageSize: number }
  fetchBookings(q: { search: string; status: BookingStatus | 'all'; page: number }): Promise<BookingsPage>
  ```
  The page follows the canvas: search box (300 ms debounce), status select (All statuses, Booked, Checked in, Completed, Released (grace period), Cancelled; **no No-show**), "x–y of N" label, table Resource/Student/Date/Time/Status/actions, pager (25 per page). A filter or search change returns to page 1. A cancelled row shows "by the library" or "by the student" and the reason as muted text. A live `bookings` event refetches quietly, keeping filters and page. The student name is plain text. If Resources already built a loading/error/empty block or the quiet-refresh loader that this page also needs, extract it into `components/` and use it from both.

- [ ] **Step 1: Write failing tests:** `shows the skeleton, then rows with derived status tags`; `search waits 300 ms and sends one request`; `changing the status returns to page 1`; `the pager moves between pages and disables at the ends`; `shows "No bookings match these filters" with Clear filters`; `shows the error state and Retry refetches`; `a live bookings event refetches the current page without the skeleton`; `a quiet refetch that fails keeps the rows`; `a cancelled row shows who cancelled and why`; `Sidebar: Bookings is a link, Catalogue and Fines still Coming soon`. Assert the request URL carries `search`, `status`, `page` and `pageSize=25` (read `fetch.mock.calls`).
- [ ] **Step 2: Run** `npx vitest run test/app/bookings.test.tsx test/lib/bookings.test.ts test/components/Sidebar.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: add the Bookings page`).

### Task 11: Bookings page: cancel and reassign (admin)

**Files:**
- Create: `admin/components/bookings/CancelBookingDialog.tsx`, `admin/components/bookings/ReassignDialog.tsx`, `admin/components/bookings/useBookingAction.ts`
- Modify: `admin/lib/bookings.ts`, `admin/components/bookings/BookingsTable.tsx`
- Test: `admin/test/app/bookings.test.tsx` (extend)

**Interfaces:**
- Consumes: `Dialog` (Task 4), the routes of Task 8, the busy/refresh pattern of `components/requests/useDecision.ts`.
- Produces (`lib/bookings.ts`):
  ```ts
  interface ReassignOption { id: string; name: string; location: string | null; capacity: number }
  cancelBooking(id: string, reason: string): Promise<unknown>            // blank sends {}
  fetchReassignOptions(id: string): Promise<ReassignOption[]>
  reassignBooking(id: string, resourceId: string): Promise<unknown>
  ```
  Actions appear only when `canManage`. The cancel dialog is titled "Cancel this booking?", says the slot reopens at once, and takes an optional reason (max 300). The reassign dialog loads the options when it opens, shows "No other resource is free at this time" when empty, and confirms only with a selection. After either action the list refetches and the buttons stay disabled until it returns; a 409 from the server becomes a toast with its message.

- [ ] **Step 1: Write failing tests:** `Cancel and Reassign appear only on bookable rows`; `cancel sends the reason, toasts, and refetches`; `cancel with a blank reason sends an empty body`; `a 409 on cancel shows the server's message and refetches`; `the reassign dialog lists the options and confirms only with a choice`; `the reassign dialog says when no resource is free`; `a 409 on reassign shows "That resource is taken at this time." and refetches`; `Escape closes either dialog and returns focus to the button`; `a second click while an action is in flight sends nothing`.
- [ ] **Step 2: Run** `npx vitest run test/app/bookings.test.tsx`; expect the new tests to fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: add cancel and reassign to the Bookings page`).

### Task 12: Library cancel and move in the student app (frontend)

**Files:**
- Modify: `frontend/lib/models/resource_booking.dart` (+ regenerate `resource_booking.g.dart` with `dart run build_runner build`), `frontend/lib/features/bookings/bookings_screen.dart`, `frontend/lib/features/bookings/booking_repository.dart` (mock only if its constructor needs the new fields), `frontend/tool/capture_fixtures.dart`, `frontend/README.md`, `frontend/CLAUDE.md`
- Create: `frontend/test/fixtures/bookings_me_library.json` (captured)
- Test: `frontend/test/models/resource_booking_json_test.dart`, `frontend/test/features/bookings/bookings_screen_test.dart`

**Interfaces:**
- Consumes: Task 9's `frontendStatus: 'cancelledByLibrary'`, `cancelReason`, `movedFrom`.
- Produces: `BookingStatus.cancelledByLibrary` (before `unknown`); `ResourceBooking.cancelReason` and `ResourceBooking.movedFrom` (both `String?`); My Bookings shows `Cancelled by the library` or `Cancelled by the library — <reason>` with no buttons, and for a booking with `movedFrom` an extra line `Moved from <resource> by the library`. `advancedTo` must leave `cancelledByLibrary` unchanged (it is outside `_progress`).

- [ ] **Step 1: Extend `capture_fixtures.dart`:** after the existing steps, book a seat as the demo student, have the admin cancel one booking with reason `Room closed for maintenance` and reassign another, then save `GET /bookings/me` as `bookings_me_library`. Do not run it yet.
- [ ] **Step 2: Write failing tests:** model: `parses cancelledByLibrary with its reason`, `parses movedFrom`, `existing fixtures still parse with null cancelReason and movedFrom`, `an unknown frontendStatus still maps to unknown`, `advancedTo leaves cancelledByLibrary unchanged`; screen: `shows "Cancelled by the library — <reason>" without buttons`, `shows "Cancelled by the library" when there is no reason`, `a moved booking shows the move line`, `an unknown status still shows the update notice`. (Tests that read `bookings_me_library` fail until Step 4.)
- [ ] **Step 3: Run** `cd frontend && flutter test test/models test/features/bookings`; confirm the new tests fail.
- [ ] **Step 4: Capture the fixture** against a freshly seeded local backend following the header comment of `capture_fixtures.dart` (admin password passed only as `SMARTLIB_ADMIN_PASSWORD_FILE`, never printed; re-seed afterwards), then implement the model fields, enum value, `fromJson` annotations and screen lines.
- [ ] **Step 5: Run `flutter test` (all) and `flutter analyze`.** Expected: all pass, no issues.
- [ ] **Step 6: Add a Known-limitations line to `README.md` (the notice appears when My Bookings is opened or refetched; no push yet) and a convention note to `CLAUDE.md`.**
- [ ] **Step 7: Report the commit commands** (`frontend: show library cancels and moves on My Bookings`).

### Task 13: Docs, full live check and hand-off

**Files:**
- Modify: `admin/README.md`, `admin/CLAUDE.md`, `backend/README.md` (if not complete), `backend/CLAUDE.md`
- Create: `admin/docs/2026-11-21-bookings-resources-design.md` and `admin/docs/2026-11-21-bookings-resources.md` (byte-identical copies of this spec and plan; verify with `cmp`)

- [ ] **Step 1: Update the docs:** admin README (Bookings and Resources sections, the live topics, Coming soon now only Catalogue and Fines), backend README endpoint table (all nine new routes) and the offline rule.
- [ ] **Step 2: Run every suite:** `cd backend && npm run typecheck && npm test`; `cd admin && npm test && npm run typecheck && npm run build`; `cd frontend && flutter analyze && flutter test`. Record the counts.
- [ ] **Step 3: Full live check** (Task 6's procedure, all three apps): take a seat offline and see it vanish from the student picker; cancel a booked seat with a reason and see it on My Bookings; reassign and see the move line; confirm a second console tab updates without reload; stop and restart the API and see the console recover; run the two races by hand where practical. Capture screenshots of both new pages for the report.
- [ ] **Step 4: Clean up** (process trees you started, password file, temp scripts, re-seed).
- [ ] **Step 5: Hand-off message:** results of every suite, deferred findings, a dated note that `bookings.test.ts` still uses fixed dates, the Render deployment state (check `/borrow-requests/me` and the new `/admin/resources`), deploy order (backend, then console, then student app), and the commit commands for every repo not yet committed.
