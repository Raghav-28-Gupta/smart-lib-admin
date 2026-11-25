# SmartLib — Slice 7: No-show Handling (detection, prediction, bounded priority, disputes, notices)

**Status:** draft for approval (2026-11-24). First half of the ML work. It makes the system notice a
missed seat or room booking, lower the student's reliability, tell them, let them dispute it, and use
an XGBoost no-show prediction to nudge the order of room requests by a small, capped, recoverable
amount. The hybrid book recommender is the next slice and is not touched here.

**Repos touched:** `backend/` (schema, a sweep, no-show disputes, prediction client, events, a scheduled
workflow), `ai-backend/` (a synthetic simulator, features, training, the prediction endpoint, tests),
`admin/` (Bookings, Needs attention, Requests), `frontend/` (My Bookings, notices). Run scripts inside
each package; commit prefixes `backend:`, `ai-backend:`, `admin:`, `frontend:`; the owner commits,
never the assistant.

## 1. Intent

Today nothing notices a missed booking. A booking whose grace period passes only *looks* released
when someone reads it (`computeWindow`, `derivedStatusSql`); nothing writes `no_show`, nothing writes a
`NoShowEvent`, the reliability score can only go up (+2 per on-time check-in), `ResourceBooking.priorityScore`
is never set, and the reliability screen already promises the score "can lightly affect priority access".
(The server does already run one 60-second timer, `startExpirySweep` in `src/services/requestHolds.ts`, for
lapsed room requests and waitlist claims; it only ticks while the instance is awake.)
The console's Needs attention page was built so a no-show dispute kind could be added, and the design
canvas has the "No-show disputes" chip, "Overturn no-show" and "Uphold flag" dialogs waiting.

After this slice: a missed booking is recorded within minutes, costs reliability points that the student
can earn back, can be disputed, and the prediction nudges (never decides) the order in which a librarian
sees room requests. Everything degrades safely: with the AI service down or never deployed, detection,
points, notices and disputes all still work and the nudge is simply zero.

## 2. Goals, non-goals, anti-goals

**Goals**
- Detect unattended bookings with an idempotent sweep that also sends a "starts soon" reminder.
- A no-show lowers reliability by a fixed amount (a flagged placeholder), recoverable by on-time check-ins.
- A student can dispute a no-show once, within 7 days; a librarian overturns or upholds it from the queue.
- An XGBoost model, trained reproducibly on a synthetic simulator, predicts no-show probability for each
  new booking; a bounded penalty reorders room requests only.
- In-app notices plus email (slice 6's Brevo mailer) for a recorded no-show, its dispute outcome and a
  room booking's reminder.
- Every figure the model reports is reproducible from the repo: fixed seeds, metrics file, tests.

**Non-goals**
- The hybrid book recommender, and any ranking of the book waitlist or the loan cascade.
- Fines for no-shows (the `no_show` fine reason stays unused), push notifications, a new job runner (the
  existing 60-second timer gains one more call, section 4), retraining on real production rows (the rows are
  logged so it can come later), deploying the AI service (an owner step; section 9), a Dashboard no-show metric.
- Auto-declining, blocking or hiding anyone's booking or request because of a prediction.

**Anti-goals (a failure even if every test passes)**
- A student who attended being penalized with no way back; a penalty that cannot be earned back.
- A student sunk in the queue indefinitely, or a request invisible or declined because of a score.
- Old unattended bookings from before this slice suddenly turning into penalties.
- A booking, check-in or approval failing or slowing noticeably because the AI service is slow or down.
- Email or notices flooding a student (one reminder per booking at most; reminders never email seats).

## 3. Approaches considered (decided with the owner on 2026-11-24)

How a missed booking gets noticed, given no job scheduler exists and Render's free web service sleeps when idle:

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | One idempotent `sweepBookings(now)`, called by a scheduled GitHub Actions workflow every few minutes and also (throttled, in the background) before pages that read bookings; it additionally rides the server's existing 60-second timer (a call added by the controller, not part of the owner's choice) so detection is about a minute behind while the instance is awake | Works while Render sleeps; testable with a fake clock; the owner adds two repo secrets and enables a workflow; GitHub's schedule can lag 10 to 15 minutes |
| B | Only the timer inside the Node server | No outside setup, but it only ticks while the instance is awake: unreliable on the free plan |
| C | Lazy only, on read | Nothing to set up, but an unviewed missed seat is never recorded and a reminder cannot exist |

Cost of a no-show (chosen): **reliability points only**; no fine, no first-miss warning. Priority (chosen):
**the librarian's room-request queue only**; the book waitlist is untouched. Notifications (chosen):
**in-app notices plus email**, no push.

## 4. The sweep (backend)

`sweepBookings(now = new Date())` in `src/services/noShowService.ts`, safe to run any number of times,
at the same instant, from two places. Each action is a conditional update on the status just read, one
transaction per booking, so one failing row never blocks the rest and a race with a check-in has exactly one
winner.

1. **Detect.** Bookings with status `booked` whose grace period ended strictly before `now` (the existing
   rule: `startTime + gracePeriodMinutes < now`) **and ended no more than `SWEEP_LOOKBACK_HOURS` (24) ago**.
   For each: `UPDATE ... SET status='no_show' WHERE id=$1 AND status='booked'`; if it changed a row, in the
   same transaction upsert the `NoShowEvent` (`actualNoShow = true`; `predictedProbability` stays as scored, or
   null when the booking was never scored: the column becomes nullable, a relaxing change), apply
   `-RELIABILITY_NOSHOW_PENALTY` through `applyReliabilityDelta` (reason `No-show: <resource name>`), record the
   applied (clamped) amount on the event (`reliabilityDelta`), and create the `no_show` notice (linked to the
   booking). After commit, once each: `deliverNotice`, then the events (`booking.changed`, `student.changed`).
2. **Remind.** Bookings with status `booked` (an unapproved room request is `requested` and is never reminded),
   `reminderSentAt` null, starting within `REMINDER_LEAD_MINUTES` (30) and not yet started (`startTime > now`:
   once the slot has started it is about to be released and "starts soon" would be wrong), and made
   early enough: `COALESCE(decidedAt, requestedAt) <= startTime - REMINDER_LEAD_MINUTES` (a room approved ten
   minutes before it starts has just been told so; a seat booked inside the window knows). Conditional update
   setting `reminderSentAt`, and a `booking_reminder` notice in the same transaction; email only when the
   resource is a room.
3. **Limits.** At most `SWEEP_BATCH` (200) bookings per action per call; the rest wait for the next call.
   The result `{ noShows, reminders, remaining }` is returned and logged as counts only (no names).

Callers, three, all calling the same function:
- `POST /internal/sweep` (header `x-sweep-token` compared in constant time with `SWEEP_TOKEN`; 404 when
  `SWEEP_TOKEN` is unset, 401 on a wrong token) for the workflow. It awaits the sweep and answers the counts.
  The workflow file `.github/workflows/sweep.yml` in `backend/` runs on `schedule` (every 10 minutes) and
  `workflow_dispatch`, with `curl --max-time 120 --retry 1` against `SWEEP_URL` (a cold Render instance can
  take a minute to wake); both secrets are the owner's step.
- The existing 60-second timer in `requestHolds.ts` (`startExpirySweep`) also calls it, so while the instance is
  awake detection is about a minute behind. Not started under test, like the timer it rides on.
- `sweepIfDue()` (at most once per 60 s per process): called at the start of `listMyBookings`, `checkInBooking`,
  `cancelBooking` and the admin Bookings list, **in the background** (`void ... .catch(log)`), never awaited by
  the request: a sweep may email up to 200 people at 5 s each and must never slow a student. The first read
  after a grace period therefore still shows the booking as released (the same face it shows today); the next
  read shows the recorded no-show. Disabled under test unless a test turns it on.

**A cancel after the grace period.** `cancelBooking` today only checks `status === 'booked'`, so a student could
cancel a booking whose grace had passed and dodge the sweep. A student's cancel once the grace period has ended
is refused with 409 "This booking has already been released." (the wording the librarian's cancel already uses
for the same case); a cancel before it ends, even after the start, is still allowed and costs nothing.

**Legacy rows.** The migration persists every past `booked` row whose grace already passed as `released`
(what every screen already shows for it), with no penalty and no notice: nobody was told they could be
penalized, and the sweep's 24-hour look-back means nothing older is ever swept.

**Statuses afterwards.** `no_show` (the flag; frees the slot, since the exclusion constraint covers only
`requested`, `booked`, `checked_in`) and `released` (grace passed with no penalty: the transient state before a
sweep, and the state of an overturned no-show). The student check-in on a `no_show` booking answers 409.

**Reporting a seat or room after a miss.** Slice 6 let a never-checked-in booking entitle a student to report its
resource ("the student who finds the seat broken and leaves"), relying on the status staying `booked`. The sweep
now turns exactly those bookings into `no_show` within minutes, so `no_show` and `released` join `booked`,
`checked_in` and `completed` in `REPORTABLE_BOOKING_STATUSES` (`reportService.ts`) with the same time window; the
tests that pinned them as not reportable change. A report still never charges or penalizes anyone.

## 5. Reliability, bounded

- `RELIABILITY_NOSHOW_PENALTY = 10` (**[ARBITRARY — flagged]**, like the +2 bonus). Clamped to [0, 100] by
  `applyReliabilityDelta`; five on-time check-ins earn a miss back.
- The applied (post-clamp) delta is stored on the `NoShowEvent` (`reliabilityDelta`) so an overturn restores
  exactly what was taken, not 10.
- A first no-show is not special: no warning tier (decided).

## 6. Prediction and bounded priority

**Contract change.** `POST /predict/no-show` currently takes `{user_id, resource_booking_id}`, which would force
the AI service to reach the database. It stays stateless instead: the Node backend sends the features and gets
the probability back.

```
POST /predict/no-show
{ "hour_of_day": 0-23, "day_of_week": 0-6, "duration_minutes": int, "lead_time_hours": float,
  "resource_type": "seat" | "room", "past_attendance_ratio": 0-1, "consecutive_attended_count": int,
  "recent_noshows_count": int, "reliability_score": 0-100, "bookings_last_30d": int }
-> { "predicted_probability": 0-1, "penalty_factor": 0-MAX_PENALTY_CAP, "model_version": "..." }
```
The service answers 503 `model_unavailable` when no artifact is loaded. Invalid input is 422.

**When it runs.** After a booking or room request is created and committed, off the request path
(`void scoreBooking(id).catch(log)`), with a 2-second timeout. It builds the features from the database,
calls the service, then writes `NoShowEvent.predictedProbability` (created at that moment, `actualNoShow` null)
and `ResourceBooking.priorityScore = 1 - clamp(penalty_factor, 0, MAX_PENALTY_CAP)`. Any failure leaves
`priorityScore` null, which every reader treats as 1.0 (no nudge). The sweep and check-in later set
`actualNoShow` (true on a no-show, false on a check-in), which is the labelled record a later retraining uses.
When it writes a score for a room request it publishes one `request.scored` event on the `requests` topic, so an
open Requests page refetches and shows the suggested order (the create event fires before the score exists).

**Feature definitions** (identical in the Node builder and the simulator; a shared fixture of about ten
history-to-features cases, checked into both repos' tests, keeps them in step). History is the student's
bookings in the last 90 days that were `checked_in`, `completed` or `no_show`; a booking whose no-show was
overturned counts as **attended** (they were there), and legacy `released` rows and cancelled, declined or
expired ones are ignored.
- `past_attendance_ratio` = attended / (attended + missed), or the prior 0.85 when there is no history.
- `consecutive_attended_count` = attended bookings since the most recent miss (all of them when there is no miss), at most 20.
- `recent_noshows_count` = no-shows in the last 30 days, at most 10.
- `bookings_last_30d` = bookings made in the last 30 days (any status but cancelled, declined, expired), at most 30.
- `reliability_score` as stored; `lead_time_hours` = start minus `requestedAt`; `hour_of_day` and `day_of_week` in
  the library's time zone (`NEXT_PUBLIC_LIBRARY_TIMEZONE` on the console, the server's `TZ` here), Monday = 0.

**Bounds (fairness).** `MAX_PENALTY_CAP = 0.2` (the AI service converts `penalty_factor = min(P * ALPHA, cap)`,
`ALPHA = 0.5`, and the Node side clamps again: it never trusts the number). The queue key is
`requestedAt + (1 - priorityScore) * PRIORITY_WINDOW_HOURS` with `PRIORITY_WINDOW_HOURS = 6`: the worst case is
a request that waits 72 minutes longer in the librarian's list than its time says. Nothing is hidden, declined
or re-labelled; the librarian can still sort by request time. The penalty is recomputed from current history for
each new request, so recovering reliability shows on the very next one.

**Where it shows (admin).** The Requests page orders room requests by the queue key (borrow requests keep their
request time) and, when a request sits lower than its time alone would put it, shows a small neutral note
"Suggested order: <n> min later (predicted no-show risk <p>%)". A "By request time" toggle restores plain order.

## 7. No-show disputes, notices and email

**Student.** `POST /bookings/:id/dispute` `{ reason }` (trimmed, 1 to 300 characters): own booking only (another
student's id is 404), status `no_show`, within `NO_SHOW_DISPUTE_DAYS` (7) of the booking's grace end (computed,
so a late sweep does not move it and no new column is needed), one per booking (409 "You've already disputed
this no-show."), 409 when the booking is not a no-show or the window has passed. 201 `{ id, status }`.
`BookingDto` gains `noShow` (`null` or `{ canDispute, dispute }` with the dispute's status and note), additive
only. **`frontendStatus` stays `'released'` for a `no_show` booking**: a new value would decode to `unknown` in
every installed app and show "Update the app to see this item's status." (the binding rule: older apps keep
working). The new app reads `noShow` to tell a recorded no-show from a plain release; an old app shows the
existing "released after the grace period" text.

**Librarian.** The queue gains kind `no_show_dispute` (counts gain `no_show_dispute`; a chip "No-show disputes"):
a card with the student, the booking ("<Resource> · <day> · <time>"), the student's words in full, and how long it
has waited. `POST /admin/no-show-disputes/:id/overturn` `{ reason }` (required, 1 to 300) and
`POST /admin/no-show-disputes/:id/uphold` `{ note? }`. Overturn, in one transaction with conditional updates
(`open` to `overturned`; the booking `no_show` to `released`; the event `actualNoShow=false`) restores exactly
`reliabilityDelta` points (reason `No-show overturned: <resource>`), writes the notice; uphold closes the
dispute and writes the notice. A dispute already answered is 409 "This dispute was already resolved." and a
refusal writes, sends and publishes nothing. Locks: the booking row, then the dispute row. Events: `booking.changed`,
`student.changed`, `attention.changed`, once, after the notice's email outcome is written.

**Notices (new kinds `booking_reminder`, `no_show`, `no_show_outcome`; same 7 days, 20 shown).** Copy:

- `booking_reminder` — "Your booking starts soon" / "<Resource>, <time>. Check in within 15 minutes of the start or the slot is released." Hidden from the list once the booking is checked in, cancelled or past its grace end.
- `no_show` — "Missed booking" / "You didn't check in to <Resource> (<day>, <time>), so the slot was released and a no-show was recorded. Your reliability score went from <a> to <b>. If this is wrong, you can dispute it from My Bookings within 7 days."
- `no_show_outcome`, overturned — "No-show removed" / "The library removed the no-show for <Resource> (<day>) and restored your reliability score to <n>.\n\nNote from the library: <reason>"
- `no_show_outcome`, upheld — "No-show stands" / "The library kept the no-show for <Resource> (<day>).\n\nNote from the library: <note>" (no suffix without a note).

A booking notice links to its booking (`Notice.bookingId`, nullable, `ON DELETE SET NULL` like `loanId` and
`fineId`; `createNotice`'s input and `resetSeedData`'s notice cleanup change with it). The reminder is hidden from
`GET /notices/me` when its booking is no longer `booked` or its grace has ended (a filter through that link, no
extra column).

Email (slice 6's mailer and every rule that comes with it: off unless configured, demo addresses skipped,
`MAIL_ALLOWED_DOMAINS`, never fails an action): the `no_show` notice, both outcomes, and the reminder **for rooms
only** (a library's seat bookings would burn a free Brevo plan's roughly 300 emails a day). The reminder is not
sent for a booking made inside the reminder window.

## 7a. What the console and the app show

**Admin Bookings page.** `no_show` rows are listed (the status filter, the zod enum in `schemas/adminBookings.ts`
and `admin/lib/bookings.ts` gain `no_show`, labelled "No-show", the canvas's option); `released` stays
"Released (grace period)". Neither can be cancelled or moved: the same refusal as for a released booking ("This
booking has already been released."), and `canManage` is false for both. The slice 5 note that there is no
No-show filter until detection exists is superseded.

**Student app.** My Bookings shows a recorded no-show as "Missed. A no-show was recorded." with a **Dispute**
button (the shared `NoteField`, UTF-16 counting, a refusal keeps the text), then "Under review" and the outcome;
a plain release keeps today's text. Booking notices (`booking_reminder`, `no_show`, `no_show_outcome`) appear in a
Library notices section at the top of **My Bookings** (the same per-user controller and rules as My Loans'
section, filtered by kind), and My Loans keeps showing the loan and fine kinds; an older app shows every kind
on My Loans, as it does today. Seats get no reminder email, so this section is their only reminder channel.

## 8. The model (ai-backend)

- `app/ml/noshow/simulate.py`: a seeded synthetic generator (`numpy.random.default_rng(seed)`): students with a
  latent reliability, bookings with lead time, hour, weekday, duration and seat or room; attendance drawn from a
  logistic of those; realistic base no-show rate (about 12 to 18 percent) with exam-hour and long-lead effects.
- `features.py`: the ten features in a fixed order (section 6) and a `from_request` helper.
- `train.py` (`python -m app.ml.noshow.train --seed 42`): generate, split by student (not by row: no leakage),
  `XGBClassifier` as in the ml-pipeline skill (150 trees, depth 4, learning rate 0.05), probability calibration,
  write `app/ml/artifacts/noshow-<version>.joblib` and `metrics.json` (ROC AUC, Brier score, log loss, calibration
  bins, feature importances, the seed, row counts, library versions). The artifact and metrics are committed so a
  deploy needs no training; `model_version` = `noshow-<date>-<hash8>`.
- `model.py`: loads the newest artifact once, `predict(features) -> (probability, penalty_factor, version)`.
- Tests (pytest, a new `requirements-dev.txt`): the simulator is deterministic for a seed and has the intended
  base rate; training twice with one seed gives identical metrics; holdout AUC at least 0.70 and Brier score below
  the base-rate predictor's; probabilities are monotone in `recent_noshows_count` on average; `penalty_factor` is
  never above the cap and never negative for any input in range; the endpoint contract (200, 422 on a missing or
  out-of-range field, 503 without an artifact); the schema matches `backend/src/lib/aiClient.ts`.

## 9. Owner steps and deployment

- Backend and console first (a migration adds a table and nullable columns, makes
  `NoShowEvent.predictedProbability` nullable, extends two enums; the legacy `released` backfill runs in it);
  then the app. Back up the database first.
- Sweep: set `SWEEP_TOKEN` (a long random string) on Render and as the repo secret `SWEEP_TOKEN`, add the secret
  `SWEEP_URL` (`https://<api host>/internal/sweep`), enable the workflow. Note GitHub pauses scheduled
  workflows in a repository with no activity for 60 days. Without them the lazy sweep still runs when anyone opens
  My Bookings or the console's Bookings page.
- AI service: `AI_BACKEND_URL` is unset in production today (the README says the service is not deployed), so the
  priority nudge stays zero there until the owner deploys `ai-backend/` (a second Render web service) and sets the
  variable. Everything else in this slice works without it.

## 10. Constraints that bind every task

- Additive migrations only; the hand-written constraints (`no_overlapping_bookings`,
  `BorrowRequest_one_pending_per_title`, the `IssueReport` CHECK and its two partial unique indexes) are never
  dropped. New enum values are added with `ALTER TYPE ... ADD VALUE`. `resetSeedData` is extended in the same task
  as each new table (disputes before bookings; no-show events before bookings and users).
- Status changes are conditional updates with specific 409s; events publish once, after commit and after the email
  outcome; a refusal publishes nothing. Raw SQL against a plain `timestamp(3)` column casts `${now}::timestamp`;
  booking times are `timestamptz`.
- The AI call is never inside a transaction and never on the request's critical path.
- Notes and reasons are trimmed, at most 300 characters; tests derive dates from `new Date()`.
- Admin: writes through `useWriteAction`, dialogs through `components/Dialog.tsx` with `useDialogSubmit`, lists
  refetch with `useLiveRefresh`. Student app: per-user controllers follow slice 5's rules, every call through
  `guardApi`, notes counted in UTF-16 units with the shared `NoteField`.

## 11. Seed and history

Every seeded booking whose grace period has already ended when the seed runs is written in its final state, so
the first sweep finds nothing old to penalize: the history generator's unattended bookings (and any
"taken"-slot booking in `seedData.ts` whose start is already past) become `no_show` with a `NoShowEvent`
(`actualNoShow = true`, a plausible predicted probability) and **no** reliability log, notice or email (backstory,
not events); the "taken" slots that have already started become `checked_in`; future ones stay `booked` and may
be swept like any real booking. Two seeded open no-show disputes (on seed students' recent no-shows) give the
queue data, as slice 6 did for fines. The re-seed deletes them with the seed students and never touches a librarian-made
row. The simulator in `ai-backend/` is separate from the seed's generator.

## 12. What is left to the builder

Exact SQL and index names, the file split inside `noShowService.ts`, the Requests page's visual treatment of the
suggested-order note, the check-in `actualNoShow = false` write, the exact queue-card wording where the canvas
gives none, how the lazy sweep is switched off under test, and the details of the simulator's distributions,
within the rules above.

## 13. Test and review focus

1. A check-in and the sweep landing together: exactly one wins; a checked-in student is never penalized.
2. A sweep run twice, or two sweeps at once: one no-show, one penalty, one notice, one email.
3. The first sweep after deploy on a database full of old `booked` rows: nothing penalized.
4. The AI service down, slow (over 2 s) or returning garbage: bookings, check-in, approval and the sweep unaffected;
   priority 1.0.
5. An overturn when the score had been clamped at 0 or 100: restores exactly what was taken, never above 100.
6. A student disputing twice, another student's booking, a booking that is not a no-show, after 7 days.
7. A reminder for a booking checked in, cancelled or moved before it is sent; a room approved inside the
   reminder window gets none.
8. A student cancelling just after the grace period ended (refused) and just before it (allowed, no penalty).
9. A student who found the seat broken, left, was swept as a no-show and then reports the seat: the report is
   accepted; and the same student disputing the no-show.
10. An old app against the new server: a missed booking shows the existing released text, never "Update the app".
11. An overturned no-show counts as attended in every later feature calculation, in Node and in the simulator
    (the shared fixture), and a student with no history gets the 0.85 prior.
