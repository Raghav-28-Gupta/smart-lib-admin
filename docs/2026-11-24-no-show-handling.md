# Slice 7: No-show Handling (sweep, reliability, prediction, bounded priority, disputes, notices) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record missed seat and room bookings within minutes, lower the student's reliability by a recoverable amount, tell them (in-app notice plus email), let them dispute it from the app and the librarian overturn or uphold it from the Needs attention queue, and use an XGBoost no-show prediction to nudge the order of room requests by a small, capped amount that fails open.

**Architecture:** One idempotent `sweepBookings(now)` in the Node backend does detection and reminders; it is called by a scheduled GitHub Actions workflow (`POST /internal/sweep`), by the server's existing 60-second timer and, in the background and throttled, before pages that read bookings. The AI service stays stateless: the backend sends ten features and gets a probability and a bounded penalty back, off the request path, and any failure leaves priority at 1.0. Backend first, then ai-backend (parallel, a different repo), then admin and app against the fixed contracts, then seed, docs, final reviews and a live check.

**Tech Stack:** Node 22 (built-in `fetch`), Express 5, Prisma 7, PostgreSQL, Zod, Vitest + Supertest (backend); Python 3.11+, FastAPI, Pydantic v2, XGBoost, scikit-learn, pandas, numpy, joblib, pytest (ai-backend); Next.js 16, React, Vitest + Testing Library (admin); Flutter, Riverpod 3, Dio, `json_serializable` (frontend); GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-24-no-show-handling-design.md` (read it first; the numbered sections are cited below). Visual and copy authority for the console: `docs/superpowers/assets/admin-console/canvas-source.dc.html` (search `no_show_dispute`, `overturnNoShow`, `upholdNoShow`, `STATUS_META`). Slice 6's spec and plan (`2026-11-22-needs-attention-*`) define the patterns this slice repeats (notices, disputes, the queue, the mailer).

## Global Constraints

- Run package scripts from inside that package. Run Vitest (backend and admin) and `flutter test` from PowerShell with `C:\` paths (from Git Bash the lowercase `c:` drive makes Vitest load twice and every suite fails at collection). The backend's full suite takes ~40 minutes (the seed tests); run the admin suite alone (a default run can time out its pager tests: rerun with `npx vitest run --maxWorkers=3`). ai-backend: `cd ai-backend; .\.venv\Scripts\python.exe -m pytest` (PowerShell); never use the global Python.
- **Never run `git add`, `git commit`, `git push` or any state-changing git.** Each task ends with the exact commit commands for the owner, prefixed `backend:`, `ai-backend:`, `admin:` or `frontend:`, with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never edit `backend/src/generated/**` (regenerate with `npx prisma generate`), `frontend/**/*.g.dart` (regenerate with `dart run build_runner build`), `ai-backend/.venv/**`, `__pycache__/`, `build/`, `.dart_tool/`, `node_modules/`. **Never read `backend/.env`.** Never print or read the dev admin password file; pass it only as a file path. `BREVO_API_KEY` and `SWEEP_TOKEN` are secrets: never commit, print or log them, nor any email body.
- Migrations: additive and safe on live data (Render runs `prisma migrate deploy`); the only relaxing change is `NoShowEvent.predictedProbability` losing NOT NULL. Try `npx prisma migrate dev --name <name> --create-only`; if it refuses to run non-interactively, take the SQL from `npx prisma migrate diff --script` into a hand-made migration folder and say so. Read the SQL: no `DROP` of `no_overlapping_bookings`, `BorrowRequest_one_pending_per_title`, `IssueReport_exactly_one_target`, `IssueReport_one_open_per_copy` or `IssueReport_one_open_per_resource`, and it must not touch `BookCopy.barcode` or `next_copy_barcode()`. Then `npx prisma migrate dev`, `node scripts/migrate-test-db.mjs`, `npx prisma generate`. **If anything asks to reset the database, STOP and report; never accept.** Back up note for the owner goes in the hand-off.
- Every new table keeps `resetSeedData` working, in the task that adds it. Raw SQL against a plain `timestamp(3)` column casts a bound date `${now}::timestamp`; booking times are `timestamptz`.
- Every new `/admin` route answers 401 without a token and 403 for a student; `/internal/sweep` is not an admin route (token header only). Student routes use `requireAuth` and only ever touch the caller's own rows (another student's id is 404).
- Status changes are conditional updates; a lost race gets a specific 409. **Events** publish once, after commit and after any email outcome is written; a refused write publishes nothing. Lock order where several rows are touched: booking row, then the user row (as `checkInBooking` does); the sweep takes booking, then `NoShowEvent`, then user; an overturn takes booking, then dispute, then event, then user (the parent row first, as slice 6's fine then dispute); the scorer updates the booking row BEFORE it writes the `NoShowEvent`, never the reverse in one transaction.
- **The AI call is never inside a transaction and never on a request's critical path** (2-second timeout, `void ... .catch(log)`); every failure leaves `priorityScore` null (read as 1.0).
- **Email:** slice 6's mailer and every rule (off unless `BREVO_API_KEY` and `MAIL_FROM` are set; never sent from tests, a fake transport is injected; demo addresses and non-allowed domains `skipped`; a failure never fails or blocks an action). This slice's emails: the `no_show` notice, both `no_show_outcome` notices, and the `booking_reminder` for rooms only.
- Notes and reasons: trimmed, at most 300 characters. Notices last 7 days (`REQUEST_OUTCOME_VISIBLE_DAYS`), at most 20 shown. Older apps must keep working: new response fields are additive only, and **`frontendStatus` for a no-show stays `'released'`**.
- Copy is exactly as the spec, the canvas or this plan gives it; error strings are specific, never "Something went wrong" when the server gave a reason.
- Admin: writes go through `useWriteAction` and dialogs through `components/Dialog.tsx` with `useDialogSubmit` (a refusal keeps the dialog and its text); lists refetch with `useLiveRefresh`, never poll; names link through `StudentLink`; render student text as plain text and preserve line breaks (`white-space: pre-line`). Subagents cannot read `node_modules`: use Context7 for library docs.
- Student app: per-user controllers follow slice 5's rules (watch the user id; never render a previous user's value: `isReloading`/`hasError` guards; a generation counter drops stale results on EVERY write path; `refreshQuietly()` joins a fetch in flight); every HTTP call through `guardApi`; never `dart:io`; notes use the shared `NoteField` (UTF-16 `trim().length` against 300); tests use `mockRepositoryOverrides()`; JSON tests parse captured fixtures (`dart run tool/capture_fixtures.dart` against a freshly seeded backend, admin password only through `SMARTLIB_ADMIN_PASSWORD_FILE`, re-seed afterwards, token stays redacted).
- Tests derive dates from `new Date()` / `DateTime.now()` / `datetime.now(timezone.utc)`, never fixed calendar dates (the one exception is the shared feature fixture, whose cases carry their own `now`).
- ML reproducibility: fixed seeds, every figure in `metrics.json` regenerable with the documented command; no network access in tests.

## Review Focus

1. A check-in and the sweep landing together: exactly one wins, a checked-in student is never penalized (Tasks 2, 4).
2. The sweep run twice or concurrently, and the first sweep after deploy on a database full of old `booked` rows: one no-show, one penalty, one notice, one email, nothing old penalized (Tasks 1, 2).
3. The AI service down, slow, or returning garbage: bookings, check-in, approval and the sweep are unaffected and priority is 1.0 (Tasks 8, 9, 13).
4. An overturn when the score had been clamped at 0 or at 100: restores exactly what was taken, never above 100 (Task 7).
5. An old app against the new server: a missed booking shows the existing released text, never "Update the app" (Tasks 5, 17).

---

## Order and parallelism

Backend tasks 1 to 10 run strictly in order. ai-backend tasks 11 to 13 run in order, in parallel with the backend (different repo); **backend Task 8 needs Task 12's fixture**. Admin tasks 14 to 16 and frontend tasks 17 to 19 run in parallel with the backend once the contracts in the backend tasks' Produces blocks exist (they mock the server); admin tasks run one at a time, frontend tasks one at a time. Task 20 (live checkpoint, the controller) follows backend 10 and ai-backend 13.

## Phase A: Backend foundation

### Task 1: Schema, constants and the legacy backfill (backend)

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/config/constants.ts`, `backend/src/services/noticeService.ts`, `backend/prisma/seedData.ts`, `backend/test/helpers/db.ts`, `backend/.env.example`
- Create: `backend/prisma/migrations/<timestamp>_no_show_handling/migration.sql`
- Test: `backend/test/services/noShowSchema.test.ts`, `backend/test/seed/reseed.test.ts` (extend)

**Interfaces:**
- Produces (schema):
  ```prisma
  enum NoShowDisputeStatus { open overturned upheld }
  model NoShowDispute { id String @id @default(uuid()); bookingId String @unique (-> ResourceBooking); userId (-> User "NoShowDisputeStudent"); reason String; status NoShowDisputeStatus @default(open); resolutionNote String?; resolvedById String? (-> User "NoShowDisputeResolver", onDelete SetNull); createdAt DateTime @default(now()); resolvedAt DateTime?; @@index([status, createdAt]) }
  ResourceBooking.reminderSentAt DateTime? @db.Timestamptz(3)
  Notice.bookingId String? (-> ResourceBooking, onDelete SetNull)
  NoShowEvent.predictedProbability Float?      // was required
  NoShowEvent.reliabilityDelta Float?          // the applied (clamped) delta of the penalty
  NoticeKind += booking_reminder | no_show | no_show_outcome
  ```
- Produces (constants): `RELIABILITY_NOSHOW_PENALTY = 10` (**[ARBITRARY, flagged] like the +2 bonus**), `SWEEP_LOOKBACK_HOURS = 24`, `REMINDER_LEAD_MINUTES = 30`, `SWEEP_BATCH = 200`, `NO_SHOW_DISPUTE_DAYS = 7`, `MAX_PENALTY_CAP = 0.2`, `PRIORITY_WINDOW_HOURS = 6`, `PREDICT_TIMEOUT_MS = 2000`, `NO_SHOW_PRIOR_ATTENDANCE = 0.85`. `NoticeInput` gains `bookingId?: string` and `createNotice` writes it. `.env.example` documents `SWEEP_TOKEN` (commented out, empty, with a note that the sweep endpoint is off without it).
- The migration's last statement is the backfill: `UPDATE "ResourceBooking" SET status = 'released' WHERE status = 'booked' AND "startTime" + make_interval(mins => "gracePeriodMinutes") < now();` (what every screen already shows; no penalty, no notice).

- [ ] **Step 1: Write failing tests:** `noShowSchema.test.ts`: `a NoShowEvent can be created with no predicted probability`; `a notice can link to a booking and the link is cleared when the booking is deleted`; `a booking keeps a reminderSentAt`; `the backfill statement, read from the migration file and run on rows, turns past booked rows into released and leaves future booked, checked_in and no_show rows alone`; `the hand-written constraints are still there` (query `pg_constraint`/`pg_indexes` for the five names). `reseed.test.ts`: `a re-seed deletes seed students' no-show disputes and a librarian-made dispute on a non-seed booking survives`.
- [ ] **Step 2: Run** `npx vitest run test/services/noShowSchema.test.ts`; expect failures.
- [ ] **Step 3: Implement** the schema, the migration (`--create-only`, read the SQL, append the backfill, drift probe as in slices 5 and 6), constants, `createNotice`, `resetSeedData` (disputes before bookings; notices' booking link is SetNull so notices of other students survive) and `resetDb`.
- [ ] **Step 4: Run** the two test files, then `npm run typecheck` and `npm run typecheck:seed`; run `npm run seed` twice against dev (report the summaries; the dev admin must survive).
- [ ] **Step 5: Report the commit commands** (`backend: add the no-show schema, constants and a backfill for old unattended bookings`).

### Task 2: The sweep, detection (backend)

**Files:**
- Create: `backend/src/services/noShowService.ts`
- Test: `backend/test/services/noShowSweep.test.ts`

**Interfaces:**
- Consumes: Task 1; `applyReliabilityDelta(tx, userId, delta, reason)` (returns `{ appliedDelta, score }`); `createNotice`, `deliverNotice`; `publishBookingChange`, `publishStudentChange`; `test/helpers/rowLock.ts`, `test/helpers/events.ts`.
- Produces:
  ```ts
  interface SweepResult { noShows: number; reminders: number; remaining: number }
  sweepBookings(now?: Date): Promise<SweepResult>     // this task: detection only (reminders: 0)
  NO_SHOW_TITLE = 'Missed booking'
  ```
- Rules (spec 4, 5): candidates are `booked` rows with `startTime + gracePeriodMinutes < now` (strictly) and grace end within `SWEEP_LOOKBACK_HOURS`, oldest first, at most `SWEEP_BATCH` (`remaining` counts the rest). Per booking one transaction: `updateMany` where `status='booked'` to `no_show`; if it changed a row: upsert the `NoShowEvent` (`actualNoShow: true`, keep an existing `predictedProbability`), `applyReliabilityDelta(tx, userId, -RELIABILITY_NOSHOW_PENALTY, 'No-show: <resource name>')`, store `reliabilityDelta = appliedDelta` on the event, `createNotice` (kind `no_show`, `bookingId`, copy below). A failing row is logged by id only and does not stop the others. After all transactions: `deliverNotice` for each created notice with a concurrency of 10, then ONE `publishBookingChange()` and ONE `publishStudentChange()` if anything was recorded. Notice body: `You didn't check in to <Resource> (<day>, <time>), so the slot was released and a no-show was recorded. Your reliability score went from <a> to <b>. If this is wrong, you can dispute it from My Bookings within 7 days.` (`<day>` and `<time>` as `bookingService` formats them in the library time zone).

- [ ] **Step 1: Write failing tests:** `records a no-show: status no_show, one NoShowEvent actualNoShow true, one -10 reliability log, one no_show notice linked to the booking`; `sweeping twice, or two sweeps at once, records one no-show, one penalty and one notice`; `a check-in and the sweep at the same moment have exactly one winner, and a checked-in student is never penalized` (use `rowLock`); `a booking at the very end of its grace period is not swept, one minute later it is`; `a booking whose grace ended more than 24 hours ago is left alone`; `requested, cancelled, declined, checked_in and released rows are never swept`; `a student at score 4 loses 4 and the event stores reliabilityDelta -4`; `keeps an existing predictedProbability`; `handles seat and room bookings`; `stops at SWEEP_BATCH and reports remaining`; `one failing booking does not stop the rest`; `a failing email (fake transport) records failed and the no-show stands`; `events: booking.changed and student.changed once, after the email outcome; none when nothing was swept`; `the notice names the resource and the score change`.
- [ ] **Step 2: Run** `npx vitest run test/services/noShowSweep.test.ts`; expect failures.
- [ ] **Step 3: Implement** `sweepBookings`. Candidate ids come from one raw SQL (`timestamptz` arithmetic); everything else through Prisma. Same lock order as `checkInBooking`: booking row, then the user row inside `applyReliabilityDelta`.
- [ ] **Step 4: Run** the file three times, then `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`backend: record no-shows with a sweep`).

### Task 3: Reminders (backend)

**Files:**
- Modify: `backend/src/services/noShowService.ts`, `backend/src/services/noticeService.ts`
- Test: `backend/test/services/noShowSweep.test.ts` (extend), `backend/test/services/noticeService.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2. Produces: `sweepBookings` now also sends reminders (`SweepResult.reminders`); `listMyNotices` hides a `booking_reminder` whose booking is no longer `booked` or whose grace has ended.
- Rules (spec 4 step 2, 7): `booked` rows (never `requested`), `reminderSentAt` null, start within `REMINDER_LEAD_MINUTES` ahead, not past grace, and `COALESCE(decidedAt, requestedAt) <= startTime - REMINDER_LEAD_MINUTES`. Conditional update sets `reminderSentAt` and the notice is created in the same transaction. Copy: title `Your booking starts soon`, body `<Resource>, <time>. Check in within 15 minutes of the start or the slot is released.` Email only when the resource is a room. Same batch limit; no live event is published (a reminder changes nothing the console shows).

- [ ] **Step 1: Write failing tests:** `sends one reminder per booking and never a second`; `a room approved ten minutes before it starts gets none; a seat booked inside the window gets none`; `an unapproved room request gets none`; `a booking that has already started is never reminded`; `email goes only for a room`; `a failing email records failed and the reminder notice stands`; `the reminder disappears from /notices/me once the booking is checked in, cancelled or past grace`; `a reminder sent at the same moment as a cancel is hidden`; `no events are published for a reminder`.
- [ ] **Step 2 to 4:** run, implement, run three times and `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`backend: remind students before a booking starts`).

### Task 4: Callers, the cancel rule and the workflow (backend)

**Files:**
- Create: `backend/src/routes/internal.ts`, `backend/.github/workflows/sweep.yml`
- Modify: `backend/src/app.ts`, `backend/src/services/noShowService.ts`, `backend/src/services/bookingService.ts`, `backend/src/services/adminBookingService.ts`, `backend/src/services/requestHolds.ts` (or `index.ts`), `backend/.env.example`
- Test: `backend/test/routes/internalSweep.test.ts`, `backend/test/services/sweepCallers.test.ts`, `backend/test/routes/bookings.test.ts` (extend)

**Interfaces:**
- Produces: `sweepIfDue(now?): void` (at most once per 60 s per process, in the background, errors logged, never throws, never awaited; **off under test unless `enableLazySweepForTests()` is called**); `POST /internal/sweep` (header `x-sweep-token`, `crypto.timingSafeEqual` on equal-length buffers; 404 when `SWEEP_TOKEN` is unset, 401 wrong or missing, 200 `{ noShows, reminders, remaining }`, awaits the sweep). The existing `startExpirySweep(sweep, intervalMs)` timer (`requestHolds.ts`; it takes the function to run, default `expireStaleRequests`, and is started only by `src/index.ts`) also calls `sweepBookings`: `index.ts` passes one function that runs both, each failing independently. `listMyBookings`, `checkInBooking`, `cancelBooking` and the admin `listBookings` call `sweepIfDue()` first.
- Booking rules: a student's `cancelBooking` once the grace period has ended is 409 `This booking has already been released.`; before it ends (even after the start) it is allowed and costs nothing. `checkInBooking` on a `no_show` booking is 409 (the existing "cannot be checked into"), and a successful check-in sets `actualNoShow = false` on an existing `NoShowEvent` (inside its transaction, with the +2 bonus).
- `sweep.yml`: `on: schedule: cron "*/10 * * * *"` and `workflow_dispatch`; one job, `curl -fsS --max-time 120 --retry 1 -X POST -H "x-sweep-token: ${{ secrets.SWEEP_TOKEN }}" "${{ secrets.SWEEP_URL }}"`; `permissions: {}`; comments say the two secrets are the owner's step and the secret values are never echoed.

- [ ] **Step 1: Write failing tests:** `internalSweep`: `is 404 when SWEEP_TOKEN is unset, 401 for a missing or wrong token, 200 with the counts for the right one`; `a wrong token of a different length is 401, not an error`; `no live event is published for an empty sweep`. `sweepCallers`: `sweepIfDue runs at most once per minute`; `listMyBookings returns before a slow sweep finishes`; `a rejected sweep is swallowed`; `the 60-second timer also sweeps`; `the lazy sweep is off under test unless enabled`. `bookings`: `a cancel after the grace period is 409 and the booking is untouched`; `a cancel one minute before the grace period ends is allowed and records no no-show`; `check-in on a no_show booking is 409`; `a check-in marks an existing NoShowEvent actualNoShow=false`.
- [ ] **Step 2 to 4:** run, implement, three runs of the three files, `npm run typecheck`, and `build` check: `npm run build` must still compile.
- [ ] **Step 5: Report the commit commands** (`backend: run the sweep from a schedule, the timer and page reads`).

### Task 5: Students dispute a no-show (backend)

**Files:**
- Create: `backend/src/services/noShowDisputeService.ts`, `backend/src/schemas/noShowDisputes.ts`
- Modify: `backend/src/routes/bookings.ts`, `backend/src/services/bookingService.ts`
- Test: `backend/test/routes/noShowDisputes.test.ts`, `backend/test/routes/bookings.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  createNoShowDispute(userId: string, bookingId: string, reason: string, now?: Date): Promise<{ id: string; status: 'open' }>
  NO_SHOW_ALREADY_DISPUTED = "You've already disputed this no-show."
  NOT_A_NO_SHOW = 'This booking is not a recorded no-show.'
  NO_SHOW_WINDOW_PASSED = 'The 7 days to dispute this no-show have passed.'
  BookingDto.noShow: null | { canDispute: boolean; dispute: null | { status: 'open' | 'overturned' | 'upheld'; note: string | null } }
  ```
  `POST /bookings/:id/dispute` `{ reason }` (trimmed, 1 to 300) answers 201 `{ id, status }`. Own booking only (another student's id is 404), status `no_show`, `now <= graceEnd + NO_SHOW_DISPUTE_DAYS days`, once per booking (the `bookingId` unique violation maps to 409; P2002/P2039). `frontendStatus` stays `'released'` for a `no_show` booking. Publishes `attention.changed` once after commit.
- `canDispute` = a `no_show` booking inside the window with no dispute yet. `noShow` is non-null when the booking is `no_show` OR has a no-show dispute (an OVERTURNED one is `released` again, but the card must keep saying what happened); it is null for every other booking.

- [ ] **Step 1: Write failing tests:** `creates an open dispute and publishes attention.changed once`; `another student's booking is 404`; `a booking that is not a no-show is 409 "This booking is not a recorded no-show."`; `after seven days from the grace end is 409`; `a second dispute is 409`; `two submissions at once give one 201 and one 409`; `a blank or 301-character reason is 400`; `no token is 401`; `GET /bookings/me shows noShow {canDispute, dispute} and keeps frontendStatus 'released'`; `a booking that is not a no-show has noShow null`; `a refusal publishes nothing`.
- [ ] **Step 2 to 4:** run, implement, three runs, `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`backend: let students dispute a no-show`).

### Task 6: Reporting after a miss and the admin Bookings rules (backend)

**Files:**
- Modify: `backend/src/services/reportService.ts`, `backend/src/services/adminBookingService.ts`, `backend/src/schemas/adminBookings.ts`
- Test: `backend/test/routes/reports.test.ts`, `backend/test/routes/bookings.test.ts`, `backend/test/routes/adminBookings.test.ts` (change the tests that pinned the old behaviour)

**Interfaces:**
- Produces: `REPORTABLE_BOOKING_STATUSES` gains `no_show` and `released` (same time window; spec 4). `adminBookingStatuses` gains `'no_show'`; `AdminBookingStatus` too; `LISTED_STATUSES` includes `'no_show'`; `derivedStatusSql` passes it through; `?status=no_show` filters; `canManage` is false for `no_show` and `released`; `cancelBookingAsLibrary` and `reassignBooking` refuse both with 409 `This booking has already been released.`.

- [ ] **Step 1: Write failing tests (and update the old ones):** `a student with a no-show booking can still report its seat`; `a released booking can still be reported`; `?status=no_show lists only no-show rows with canManage false`; `the unfiltered list now includes no-show rows`; `cancel and reassign of a no-show are 409`; `an unknown status is still 400`.
- [ ] **Step 2 to 4:** run, implement, run the three files, `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`backend: keep reports working after a miss and list no-shows on the Bookings page`).

### Task 7: The queue, overturn and uphold (backend)

**Files:**
- Modify: `backend/src/services/noShowDisputeService.ts`, `backend/src/services/adminAttentionService.ts`, `backend/src/schemas/adminAttention.ts`, `backend/src/schemas/noShowDisputes.ts`, `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminNoShowDisputes.test.ts`, `backend/test/routes/adminAttention.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  AttentionKind += 'no_show_dispute'; attentionKinds += 'no_show_dispute'; AttentionCounts += no_show_dispute: number   // all = overdue + fine_dispute + report + no_show_dispute
  { id: string /* = disputeId */; kind: 'no_show_dispute'; student: AttentionStudent; waitingSince: Date;
    noShow: { disputeId: string; bookingId: string; resource: { id: string; name: string }; startTime: Date; endTime: Date; studentReason: string } }
  overturnNoShow(disputeId: string, adminId: string, reason: string, now?: Date): Promise<{ id: string }>
  upholdNoShow(disputeId: string, adminId: string, note: string | null, now?: Date): Promise<{ id: string }>
  POST /admin/no-show-disputes/:id/overturn  { reason }   // required, trimmed, 1 to 300
  POST /admin/no-show-disputes/:id/uphold    { note? }
  ```
  Both answer 200 `{ id }`. `DISPUTE_ALREADY_RESOLVED` ("This dispute was already resolved.") is reused; unknown id 404 `No-show dispute not found`.
- Overturn (spec 7), one transaction, conditional updates, lock order booking, dispute, event, user (lock the booking row `FOR NO KEY UPDATE` first): dispute `open` to `overturned`; booking `no_show` to `released`; event `actualNoShow=false`; restore exactly `reliabilityDelta` points through `applyReliabilityDelta` (reason `No-show overturned: <resource>`; never above 100; nothing when the delta was 0 or null); notice `no_show_outcome` (title `No-show removed`, body `The library removed the no-show for <Resource> (<day>) and restored your reliability score to <n>.` + `\n\nNote from the library: <reason>`). Uphold: dispute to `upheld`, notice title `No-show stands`, body `The library kept the no-show for <Resource> (<day>).` + the note suffix only when given. After commit, once: `deliverNotice`, then `booking.changed`, `student.changed`, `attention.changed` (overturn) or `attention.changed` only (uphold). A refusal publishes nothing.

- [ ] **Step 1: Write failing tests:** `the queue lists no-show disputes oldest first with the student's words, and counts and the kind filter include them`; `overturn restores the exact points taken, frees nothing else, sets the booking released and the event actualNoShow false`; `overturn after a clamp at 0 restores only what was taken`; `overturn never takes the score above 100`; `overturn with no reason is 400`; `uphold closes the dispute and the booking stays no_show`; `the notice copy and the note suffix`; `a second answer is 409 and publishes nothing`; `overturn and uphold at once: one wins`; `unknown id 404, student 403, no token 401`; `a failing email records failed and the answer stands`; `events once, after the email outcome`.
- [ ] **Step 2 to 4:** run, implement, three runs of both files, `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`backend: settle no-show disputes from the queue`).

### Task 8: The prediction client, the features and scoring (backend)

**Files:**
- Create: `backend/src/services/noShowFeatures.ts`, `backend/src/services/noShowScoring.ts`, `backend/test/fixtures/noshow-features.json` (a byte-identical copy of `ai-backend/tests/fixtures/noshow_features.json` from Task 12; verify with `cmp`)
- Modify: `backend/src/lib/aiClient.ts`, `backend/src/lib/events.ts` (add `'request.scored'`), `backend/src/services/bookingService.ts`
- Test: `backend/test/services/noShowFeatures.test.ts`, `backend/test/services/noShowScoring.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface NoShowFeatures { hour_of_day: number; day_of_week: number; duration_minutes: number; lead_time_hours: number; resource_type: 'seat' | 'room';
    past_attendance_ratio: number; consecutive_attended_count: number; recent_noshows_count: number; reliability_score: number; bookings_last_30d: number }
  buildNoShowFeatures(bookingId: string, now?: Date): Promise<NoShowFeatures>      // definitions: spec 6 "Feature definitions"
  predictNoShow(f: NoShowFeatures, signal?: AbortSignal): Promise<{ predicted_probability: number; penalty_factor: number; model_version: string }>   // throws on non-2xx, bad JSON or values outside range
  scoreBooking(bookingId: string, now?: Date): Promise<void>    // never throws
  ```
  `createBooking` calls `void scoreBooking(id).catch(log)` after the commit (seats and rooms), outside the booking's transaction. `scoreBooking` upserts the `NoShowEvent` (`predictedProbability`, `actualNoShow` untouched) and sets `priorityScore = 1 - clamp(penalty_factor, 0, MAX_PENALTY_CAP)`; for a room request it then publishes ONE event `{ type: 'request.scored', topics: ['requests'] }`. Timeout `PREDICT_TIMEOUT_MS`. `scoreBooking` does nothing when `AI_BACKEND_URL` is unset (production today; the tests set it), so no failing fetch is made on every booking.

- [ ] **Step 1: Write failing tests:** `noShowFeatures`: run every case in the shared fixture and compare all ten features; `a student with no history gets the 0.85 prior`; `an overturned no-show counts as attended`; `legacy released and cancelled rows are ignored`; `the feature keys equal the fixture's and aiClient's NoShowFeatures keys`. `noShowScoring` (stub `fetch` with `vi.stubGlobal`): `writes predictedProbability and priorityScore = 1 - penalty for a room request and publishes request.scored once`; `a penalty above the cap is clamped to 0.2`; `a seat booking gets a NoShowEvent and a priorityScore but publishes no request event`; `a 503, a 3-second answer, invalid JSON and a probability of 1.4 each leave priorityScore null and write nothing`; `createBooking answers before a slow prediction finishes`; `the AI service being down does not fail createBooking`; `scoring never runs inside a transaction` (the stub observes no open transaction: assert the call happens after `createBooking` resolved).
- [ ] **Step 2 to 4:** run, implement, three runs, `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`backend: score new bookings with the no-show model, failing open`).

### Task 9: Bounded priority in the Requests queue (backend)

**Files:**
- Modify: `backend/src/services/adminRequestService.ts`, `backend/src/schemas/adminRequests.ts`, `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminRequests.test.ts` (extend), `backend/test/services/requestPriority.test.ts`

**Interfaces:**
- Produces: `AdminRequestDto.room` gains `priority?: { suggestedDelayMinutes: number; riskPercent: number | null }` (additive; absent when `priorityScore` is null). The merged list key for a room request is `requestedAt + (1 - priorityScore) * PRIORITY_WINDOW_HOURS * 3600000 ms`; borrow requests keep `requestedAt`; ties keep request time. `GET /admin/requests?order=request` (zod enum `request | suggested`, default `suggested`) restores plain request-time order. `suggestedDelayMinutes` is rounded; `riskPercent` is the event's `predictedProbability` rounded, or null.

- [ ] **Step 1: Write failing tests:** `a room request with priorityScore 0.8 sits at most 72 minutes later than its request time says`; `a null score changes nothing`; `borrow requests are never reordered by priority`; `order=request returns plain request-time order`; `a priority never hides, declines or expires a request`; `a score above 1 or below 0.8 in the database is clamped when read`; `the order is stable and deterministic for equal keys`; `riskPercent comes from the NoShowEvent`.
- [ ] **Step 2 to 4:** run, implement, three runs, `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`backend: order room requests with a bounded priority`).

### Task 10: Seed and re-seed (backend)

**Files:**
- Modify: `backend/prisma/history.ts`, `backend/prisma/seedData.ts`, `backend/prisma/seed.ts`, `backend/README.md` (seed section)
- Test: `backend/test/seed/reseed.test.ts`, `backend/test/seed/history.test.ts`

**Interfaces:**
- Produces (behaviour, spec 11): every seeded booking whose grace has ended at seed time is in its final state: the history generator's unattended bookings (and any "taken"-slot booking in `seedData.ts` whose start is past) become `no_show` with a `NoShowEvent` (`actualNoShow: true`, a plausible `predictedProbability`, `reliabilityDelta` null) and **no** reliability log, notice or email; "taken" slots already started become `checked_in`; future ones stay `booked`. The demo student `aditi.sharma@thapar.edu` has one recent disputable no-show (no dispute yet, grace ended within 6 days). Two seeded open no-show disputes on two other seed students' recent no-shows. `SeedSummary` gains `noShows` and `noShowDisputes`.

- [ ] **Step 1: Write failing tests:** `a fresh seed leaves no booked row past its grace period`; `seeded no-shows have an event and no reliability log, notice or email`; `the demo student has one disputable no-show and the two seeded disputes are open on other seed students`; `the first sweep after a seed records nothing for seeded rows`; `a second run succeeds and replaces the seeded disputes`; `a librarian-made no-show dispute on a non-seed booking survives a re-seed`.
- [ ] **Step 2 to 4:** run `npx vitest run test/seed` (about 10 minutes, in the background), `npm run typecheck:seed`, `npm run seed` twice against dev (summaries; dev admin survives).
- [ ] **Step 5: Report the commit commands** (`backend: seed no-shows and make re-seeding safe for them`).

## Phase B: ai-backend

### Task 11: Test setup, the feature schema and the endpoint contract (ai-backend)

**Files:**
- Create: `ai-backend/requirements-dev.txt` (`pytest`, `httpx`, pinned), `ai-backend/pytest.ini`, `ai-backend/tests/__init__.py`, `ai-backend/tests/conftest.py`, `ai-backend/tests/test_noshow_contract.py`, `ai-backend/app/ml/noshow/features.py`
- Modify: `ai-backend/app/schemas/noshow.py`, `ai-backend/app/routers/noshow.py`

**Interfaces:**
- Produces: `NoShowRequest` with the ten features, bounds as the spec 6 contract (`hour_of_day` 0-23, `day_of_week` 0-6, `duration_minutes` 1-1440, `lead_time_hours` >= 0, `resource_type` Literal seat/room, `past_attendance_ratio` 0-1, the two counts >= 0, `reliability_score` 0-100, `bookings_last_30d` >= 0; extra fields forbidden); `NoShowResponse { predicted_probability: float (0-1), penalty_factor: float (0-0.2), model_version: str }`; `FEATURE_ORDER: list[str]` in `features.py`; a FastAPI dependency `get_model()` returning the loaded model or `None` (overridable in tests); the router answers 503 `{"detail": "model_unavailable"}` when there is none.

- [ ] **Step 1: Write failing tests:** `200 with probability, penalty and version for a valid request (a fake model injected)`; `422 for each missing field, each out-of-range value, an unknown resource_type and an extra field`; `503 model_unavailable without a model`; `FEATURE_ORDER equals the request's fields`; `/health still answers`.
- [ ] **Step 2: Run** `.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt`, then pytest; expect failures.
- [ ] **Step 3: Implement.** The stub's 0.0 answer goes away. Pin the two dev packages in `requirements-dev.txt` only.
- [ ] **Step 4: Run** pytest.
- [ ] **Step 5: Report the commit commands** (`ai-backend: define the no-show prediction contract`).

### Task 12: The simulator, history features and the shared fixture (ai-backend)

**Files:**
- Create: `ai-backend/app/ml/noshow/simulate.py`, `ai-backend/app/ml/noshow/history.py`, `ai-backend/tests/test_simulate.py`, `ai-backend/tests/test_history_features.py`, `ai-backend/tests/fixtures/noshow_features.json`

**Interfaces:**
- Produces: `features_from_history(booking: dict, history: list[dict], reliability_score: float, now: datetime, tz: str = "Asia/Kolkata") -> dict` (the ten features, spec 6 definitions: 90-day history of `checked_in`/`completed`/`no_show`, overturned counts as attended via `history[i]["overturned"]`, `released` legacy and cancelled/declined/expired ignored, prior 0.85, caps 20/10/30, Monday = 0); `simulate(n_students: int, seed: int) -> pandas.DataFrame` (one row per booking: the ten features plus `no_show` 0/1 and `student_id`; features use only history before the booking).
- The fixture file: a JSON list of about ten cases `{ name, now, tz, booking, history, reliability_score, expected }`, hand-written from the spec: no history; all attended; one miss then three attended (consecutive 3); an overturned miss counted attended; legacy `released` ignored; cancelled ignored; a booking exactly 90 days old in and 91 days out; the three caps; a late-night booking that crosses midnight between UTC and Asia/Kolkata; a Monday (`day_of_week` 0). It is the contract with the backend (Task 8 copies it, `cmp`).

- [ ] **Step 1: Write failing tests:** `every fixture case passes`; `the fixture's expected keys equal FEATURE_ORDER`; `simulate is deterministic for a seed and differs for another`; `the base no-show rate is between 12 and 18 percent`; `a long lead time and late-evening hours raise the rate on average`; `a new student's first booking uses the 0.85 prior`; `no row's features use a later booking (no leakage)`; `the simulated student reliability explains the label better than chance`.
- [ ] **Step 2 to 4:** run pytest (expect failures), implement with `numpy.random.default_rng(seed)`, run pytest.
- [ ] **Step 5: Report the commit commands** (`ai-backend: add the synthetic booking simulator and shared feature definitions`).

### Task 13: Training, the artifact and serving (ai-backend)

**Files:**
- Create: `ai-backend/app/ml/noshow/train.py`, `ai-backend/app/ml/noshow/model.py`, `ai-backend/app/ml/artifacts/noshow-<version>.joblib`, `ai-backend/app/ml/artifacts/metrics.json`, `ai-backend/tests/test_train.py`, `ai-backend/tests/test_model.py`
- Modify: `ai-backend/app/routers/noshow.py`, `ai-backend/README.md`, `ai-backend/CLAUDE.md` (commands and the artifact rule)

**Interfaces:**
- Produces: `python -m app.ml.noshow.train --seed 42` (generate with Task 12, split by student, `XGBClassifier(n_estimators=150, max_depth=4, learning_rate=0.05, eval_metric="logloss", random_state=seed)`, probability calibration, write the artifact and `metrics.json` with ROC AUC, Brier score, log loss, calibration bins, feature importances, the seed, row counts and library versions); `penalty_factor(p, alpha=0.5, cap=0.2)` = `min(max(p * alpha, 0), cap)`; `NoShowModel.load(dir) -> NoShowModel` (newest artifact) and `.predict(features: dict) -> tuple[float, float, str]`; `model_version = "noshow-<yyyymmdd>-<hash8 of the artifact>"`; the router's `get_model()` loads the committed artifact once at startup (none: 503 as in Task 11).

- [ ] **Step 1: Write failing tests:** `training twice with one seed gives identical metrics`; `holdout ROC AUC is at least 0.70 and the Brier score beats the base-rate predictor`; `calibration: the mean absolute gap across bins is at most 0.05`; `the split is by student, with no student in both sets`; `probability rises on average with recent_noshows_count`; `penalty_factor is within 0 and 0.2 for every probability from 0 to 1, including the ends, and is monotone`; `the endpoint serves the committed artifact: 200, version matches metrics.json`; `a corrupt artifact makes the service answer 503, not crash`; `model_version has the documented shape`.
- [ ] **Step 2 to 4:** run pytest (expect failures), implement, run the training command, commit the artifact files in the tree (the owner commits them), run pytest and `uvicorn app.main:app --port 8000` smoke (`curl 127.0.0.1:8000/health`).
- [ ] **Step 5: Report the commit commands** (`ai-backend: train, calibrate and serve the no-show model`; include the artifact paths).

## Phase C: Admin console

### Task 14: No-show rows on the Bookings page (admin)

**Files:** Modify `admin/lib/bookings.ts`, the Bookings page and its table and status-tag components under `admin/components/bookings/` and `admin/app/(console)/bookings/`; Test `admin/test/lib/bookings.test.ts`, `admin/test/app/bookings.test.tsx`.

**Interfaces:** Consumes Task 6's contract (`status=no_show` filter value, `canManage` false for `no_show` and `released`). Produces: status `no_show` labelled "No-show" (canvas `STATUS_META`, `tag-accent`); the status filter gains "No-show" between "Completed" and "Cancelled" (canvas order); `released` stays "Released (grace period)".

- [ ] **Step 1: Write failing tests:** `lists a no-show row with the No-show tag`; `the status filter offers No-show and sends status=no_show`; `no-show and released rows offer no Cancel or Move`; `a refused cancel of a released booking shows the server's message`.
- [ ] **Step 2 to 4:** run focused files, implement, `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`admin: list no-shows on the Bookings page`).

### Task 15: No-show disputes in Needs attention (admin)

**Files:** Modify `admin/lib/attention.ts`, `admin/components/attention/AttentionCard.tsx`, `admin/components/attention/useAttentionActions.ts`, `admin/app/(console)/attention/page.tsx`; Create `admin/components/attention/OverturnNoShowDialog.tsx`, `admin/components/attention/UpholdNoShowDialog.tsx`; Test `admin/test/app/attention.test.tsx`, `admin/test/lib/attention.test.ts`.

**Interfaces:** Consumes Task 7 (item `kind: 'no_show_dispute'`, `noShow {...}`, `counts.no_show_dispute`). Produces: `export const ATTENTION_KINDS = ['overdue', 'fine_dispute', 'report', 'no_show_dispute'] as const` used by the type and by the page's known-kinds filter (so a later unknown kind never crashes the page); a card per item: tag "No-show dispute" (canvas `REQ_TYPE_LABEL`), summary `Disputes no-show flag on <Resource>`, detail = the student's words in FULL (`white-space: pre-line`, no clamp) with the booking line `<day>, <start>–<end>`, primary button "Overturn no-show", secondary "Uphold flag"; a chip "No-show disputes (n)" after "Fine disputes"; dialogs exactly as the canvas: Overturn title `Overturn this no-show flag?`, body `<student>'s reliability score is restored and the flag is removed. A reason is required for the record.`, confirm "Overturn flag", the reason textarea (placeholder `Why is this no-show being overturned?`, required, 300, UTF-16 counting through the app's note rule) and it shows the student's words above it; Uphold title `Uphold the no-show flag?`, body `The dispute is closed and the flag stands. <summary>.`, confirm "Uphold flag", optional note; writes through `useWriteAction`, a refusal keeps the dialog and its text; after a success the list refetches; live refresh on `attention.changed` already exists.

- [ ] **Step 1: Write failing tests:** `shows a no-show dispute card with the student's words in full and the booking line`; `the chip counts and filters no-show disputes`; `Overturn needs a reason, sends POST /admin/no-show-disputes/:id/overturn {reason} and refetches`; `Uphold sends POST .../uphold with and without a note`; `a 409 "This dispute was already resolved." keeps the dialog and its text`; `a network failure keeps the dialog`; `an unknown item kind does not crash the page`; `the dialogs show the student's words and render markup as text`.
- [ ] **Step 2 to 4:** run focused files, implement, `npm run typecheck`, `npm run build`.
- [ ] **Step 5: Report the commit commands** (`admin: settle no-show disputes from the Needs attention page`).

### Task 16: Suggested order on the Requests page (admin)

**Files:** Modify `admin/lib/requests.ts`, the Requests page and room request card under `admin/components/requests/`, `admin/app/(console)/requests/`; Test `admin/test/lib/requests.test.ts`, `admin/test/app/requests.test.tsx`.

**Interfaces:** Consumes Task 9 (`room.priority { suggestedDelayMinutes, riskPercent }`, `?order=request`). Produces: a neutral note on a room request card only when `suggestedDelayMinutes > 0`: `Suggested order: <n> min later (predicted no-show risk <p>%)` (just `Suggested order: <n> min later` when `riskPercent` is null); a "By request time" toggle (default off = suggested order) that refetches with `order=request`; a live `request.scored` event refetches the list and shows no toast (only `request.created` toasts).

- [ ] **Step 1: Write failing tests:** `shows the note only when the delay is above zero`; `no priority field shows no note`; `By request time sends order=request and restores the order`; `a request.scored event refetches and raises no toast`; `the note text for a null risk`.
- [ ] **Step 2 to 4:** run focused files, implement, `npm run typecheck`.
- [ ] **Step 5: Report the commit commands** (`admin: show the suggested order of room requests`).

## Phase D: Student app

### Task 17: Models, repository and fixtures (frontend)

**Files:** Modify `frontend/lib/models/resource_booking.dart` (+ regenerate `.g.dart`), `frontend/lib/models/notice.dart`, `frontend/lib/features/bookings/booking_repository.dart`, `frontend/test/support/` mock repositories, `frontend/tool/capture_fixtures.dart`; Test `frontend/test/models/`, `frontend/test/fixtures/`.

**Interfaces:** Consumes Task 5. Produces: `NoShowInfo { bool canDispute; NoShowDisputeInfo? dispute }` and `NoShowDisputeInfo { status (open/overturned/upheld, unknown for anything else); String? note }`, `ResourceBooking.noShow` nullable (absent in an old payload = null); `NoticeKind` gains `bookingReminder`, `noShow`, `noShowOutcome` (unknown still maps to `unknown`); `BookingRepository.disputeNoShow(String bookingId, String reason) -> Future<void>` through `guardApi` (POST `/bookings/:id/dispute`, `{ reason }`); the capture signs in as the demo student, disputes its seeded no-show (Task 10), re-captures the bookings and notices fixtures (token redacted, ids and timestamps only change).

- [ ] **Step 1: Write failing tests:** `a booking payload without noShow parses to null`; `a captured no-show booking parses with canDispute true`; `an unknown dispute status maps to unknown`; `the three new notice kinds parse and an unknown kind still maps to unknown`; `disputeNoShow posts {reason} and maps a 409 to the server's message`.
- [ ] **Step 2 to 4:** run focused files, `dart run build_runner build`, capture against a freshly seeded backend (after backend Task 10), `flutter analyze`.
- [ ] **Step 5: Report the commit commands** (`frontend: parse no-shows and the new notice kinds`).

### Task 18: My Bookings, the missed card and Dispute (frontend)

**Files:** Modify `frontend/lib/features/bookings/bookings_screen.dart`, `bookings_controller.dart`; Test `frontend/test/features/bookings/`.

**Interfaces:** Consumes Task 17. Produces: a booking with `noShow != null` shows `Missed. A no-show was recorded.` in place of the released text, with a **Dispute** button (screen-reader label `Dispute the no-show for <resource>`) when `canDispute`; the dialog mirrors the fine dispute dialog (read `fines_section.dart`; "no-show" for "fine"; the shared `NoteField`; a refusal keeps the text and shows the server's message; Send off in flight); a dispute shows `Under review` at once (the local mark and the in-flight-fetch wait of `FinesController.dispute`), then `No-show removed` or `No-show stands`; `BookingsController.disputeNoShow` follows the per-user rules with the generation check on this write; an old payload keeps the released text.

- [ ] **Step 1: Write failing tests:** `a no-show booking shows the missed text and Dispute`; `no Dispute button when canDispute is false or a dispute exists`; `sending marks Under review at once and survives an in-flight fetch finishing later`; `a 409 keeps the dialog and the typed text`; `301 UTF-16 units disables Send`; `an account switch while the dispute is in flight never shows it for the next student`; `a booking without noShow shows the released text`; `outcome texts`.
- [ ] **Step 2 to 4:** run focused files, implement, `flutter analyze`.
- [ ] **Step 5: Report the commit commands** (`frontend: show missed bookings and let students dispute them`).

### Task 19: Booking notices on My Bookings (frontend)

**Files:** Modify `frontend/lib/features/notices/notices_section.dart`, `notices_controller.dart`, `bookings_screen.dart`, `loans_screen.dart`; Test `frontend/test/features/notices/`, `frontend/test/features/bookings/`, `frontend/test/features/loans/`.

**Interfaces:** Consumes Task 17. Produces: `NoticesSection(kinds: ...)` (a filter by kind, the same per-user controller and refresh rules); My Bookings shows booking-kind notices (`bookingReminder`, `noShow`, `noShowOutcome`) in a "Library notices" section at its top, refreshed on open like My Loans; My Loans shows every kind EXCEPT those three (unknown kinds stay on My Loans); an empty section renders nothing.

- [ ] **Step 1: Write failing tests:** `My Bookings shows only booking notices and My Loans never shows them`; `an unknown kind still shows on My Loans`; `opening My Bookings refreshes the notices; a failed quiet refresh keeps the last list`; `an account switch never shows the previous student's notices on either screen`; `an empty list shows no section`.
- [ ] **Step 2 to 4:** run focused files, implement, `flutter analyze`.
- [ ] **Step 5: Report the commit commands** (`frontend: show booking notices on My Bookings`).

## Phase E: Checkpoint, docs, finish

### Task 20: Live checkpoint (the controller, after backend 10 and ai-backend 13)

**Files:** none (scratch scripts in the scratchpad, deleted after).

- [ ] **Step 1: Run** the real stack against the freshly seeded dev DB: own backend on :3000 with `BREVO_API_KEY`/`MAIL_FROM` blanked to a single space and `SWEEP_TOKEN` set to a random value; the AI service from the venv on 127.0.0.1:8000 (stop only processes you start). Check: `POST /internal/sweep` 404/401/200; a past booking is swept once (status, event, one -10 log, notice) and a second sweep records nothing; a check-in and the sweep racing; a student's cancel after grace 409; the dispute, overturn (points restored exactly), uphold; the queue counts and item keys equal `admin/lib/attention.ts`; `POST /bookings` scored by the real model (`priorityScore` in [0.8, 1], event `request.scored` once); the Requests order and `order=request`; **stop the AI service: a booking still succeeds and priority is 1.0**; the first sweep after a re-seed records nothing; response keys equal the Dart models; every refusal publishes nothing.
- [ ] **Step 2: Fix findings** through the process (a finding is a task); delete the scripts and stop the processes you started; re-seed.

### Task 21: Docs

**Files:** Modify `backend/README.md`, `backend/CLAUDE.md`, `backend/.env.example` (confirm), `ai-backend/README.md`, `ai-backend/CLAUDE.md`, `admin/README.md`, `admin/CLAUDE.md`, `frontend/README.md`, `frontend/CLAUDE.md`; Create `admin/docs/2026-11-24-no-show-handling-design.md` and `admin/docs/2026-11-24-no-show-handling.md` (byte-identical copies of this spec and plan; verify with `cmp`).

- [ ] **Step 1: Update the docs** from the code as it stands: the sweep and its three callers, `POST /internal/sweep`, the new routes and fields, the statuses, the reliability rule and its flagged placeholders, the prediction contract and the bounded priority (cap, window, worst case 72 minutes), the notices and the email rule, events, the constraints, the owner steps (`SWEEP_TOKEN` on Render and as a repo secret, the `SWEEP_URL` secret, enabling the workflow, GitHub pausing scheduled workflows after 60 idle days, deploying `ai-backend/` as a second service and setting `AI_BACKEND_URL`, the Brevo free-plan daily limit), how to retrain (`python -m app.ml.noshow.train --seed 42`), the console's Bookings, Needs attention and Requests changes, and the app's My Bookings and notices; fix every statement this slice made wrong (the admin README "No-show handling is deferred", the Bookings "no No-show filter", the backend README's note that reliability only rises).
- [ ] **Step 2: Check each statement against the code**; list every difference from the spec or plan in the report (do not fix code).
- [ ] **Step 3: Report the commit commands** per repo (`backend: document ...`, `ai-backend: document ...`, `admin: document ...`, `frontend: document ...`).

### Task 22: Final suites, full live check and hand-off

**Files:** none (the controller runs the final reviews first, per the process: one whole-slice review per repo on the most capable model, one fix wave, one scoped re-review; this task follows them).

- [ ] **Step 1: Run every suite on the final code:** `cd backend; npm run typecheck; npm run typecheck:seed; npm test`; `cd admin; npm test; npm run typecheck; npm run build` (alone; rerun with `--maxWorkers=3` if the pager tests time out and report both); `cd frontend; flutter analyze; flutter test`; `cd ai-backend; .\.venv\Scripts\python.exe -m pytest`. Record the counts.
- [ ] **Step 2: Full live check** (Task 20 once more end to end, plus the admin Bookings listing of no-show rows, the sidebar badge against the queue, a re-seed with a librarian-made no-show dispute). Browser part only if the owner has logged in.
- [ ] **Step 3: Clean up** (processes you started, scratch scripts, test data through exact markers only, re-seed). The dev-admin password file stays for the owner's browser checks, with its path in the hand-off.
- [ ] **Step 4: Hand-off message:** every suite's result; the rulings and deferred findings; the Render state (probe a route only this slice adds: `POST /internal/sweep` answering 404 means the old build or no token; `GET /bookings/me` answering a `noShow` key means deployed); the owner's steps (database backup, `SWEEP_TOKEN` and the two repo secrets, enabling the workflow, deploying the AI service and `AI_BACKEND_URL`, the Brevo limit); deploy order (backend with its migration, then console, then app with a new APK tag, then the workflow); and the commit commands, two per repo.
