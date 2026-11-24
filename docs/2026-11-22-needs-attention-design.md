# SmartLib Admin Console — Slice 6: Needs Attention, Disputes, Problem Reports and Email

**Status:** draft for approval (2026-11-22). Slice 6 closes the console: after it every section of
the design canvas is built except no-show handling, which waits for no-show detection (the ML work
that follows this slice).

**Repos touched:** `backend/` (schema, services, routes, events, a mailer), `admin/` (one page, a
sidebar badge, the Dashboard's Overdue card, small Fines changes), `frontend/` (dispute a fine,
report a problem, library notices). Run scripts inside each package; commit prefixes `backend:`,
`admin:`, `frontend:`; the owner commits, never the assistant.

## 1. Intent

A librarian should see, in one place, only the few things that need a human: a book that is badly
overdue, a fine a student says is wrong, a copy or a seat a student says is broken. Students raise
the last two from the app; the first is read from the loans the library already holds. The librarian
settles each with tools the console already has (waive or adjust a fine, put a copy in maintenance,
take a resource offline) and the student is told the outcome, in the app and, when the library has
switched it on, by email. This is the canvas's "Needs attention" section
(`docs/superpowers/assets/admin-console/canvas-source.dc.html`, search `onRequests`, `requestsList`,
`REQ_TYPE_LABEL`), which is the visual authority for the page and its dialogs; this spec says how it
is fed, what the canvas leaves out, and what students see.

The Requests page (slice 2) already uses the canvas's card layout for borrow and room approvals.
Needs attention is a second, separate page for exceptions.

## 2. Goals, non-goals, anti-goals

**Goals**
- A **Needs attention** page: filter chips with counts, one card per item, two actions each, with the
  canvas's loading, error and empty states; a sidebar entry with a live count badge; live updates.
- **Overdue follow-ups**: every loan a whole day or more overdue appears; the librarian can send a
  reminder or escalate to a formal notice.
- **Fine disputes**: a student disputes an outstanding or adjusted fine once, with a reason; the
  librarian waives or adjusts it (the existing dialog) or upholds it; the student sees the answer.
- **Problem reports**: a student reports a damaged copy **when they return it**, or a seat or room
  they booked; the librarian confirms (copy to maintenance or lost, resource offline) or dismisses;
  the student sees the answer.
- **Library notices** on My Loans for 7 days, and the same text by **email** when the library has
  configured a sender, for this slice's events only.
- The Dashboard's "Overdue materials" card links to the overdue follow-ups.
- Every change reaches open consoles through the live event bus.

**Non-goals**
- No-show disputes, "Overturn no-show" and the canvas's No-show chip: nothing records no-shows yet.
  The queue is built so that kind can be added later.
- Automatic or scheduled reminders (there is no scheduler), email for anything outside section 5.2
  (request decisions, booking cancels and moves, fine waives made outside a dispute), push
  notifications, per-student email preferences, unsubscribe links.
- Blocking borrowing after an escalation, changing the ₹10/day rate, refunds, photos on reports, a
  second dispute on the same fine, reports about a resource the student never booked, and a report on
  a copy the student still holds (a copy is reported when it is returned, so it is back on the shelf
  when the librarian sees the report).
- A page that lists every notice or dispute ever made (the queue shows what is open; history lives
  on the student page and the Fines page).

**Anti-goals** (failure even if the code works)
- Money recorded wrongly around a dispute: a fine marked paid while it is disputed, a dispute and a
  payment (or a waive) racing so both land, a waive that leaves the dispute open, or a dispute closed
  as "waived" without the waive.
- A student never told the outcome of their dispute or report, or told twice.
- An email problem hurting a librarian's action: a slow or failing provider blocking, failing or
  half-applying it; an email for an action that was refused or rolled back; the same email sent twice
  for one click; a click storm sending ten reminders.
- A secret or a student's message leaking: the API key or an email body in a log; a message to the
  wrong address; a student seeing or acting on another student's fine, loan or notice.
- The seed (which also runs against production) sending any email, or deleting a librarian's work, or
  leaving a dispute or report without its fine, copy or resource.
- Email sending from tests or a developer's machine unless it was switched on on purpose; emailing
  the placeholder demo addresses (they bounce and hurt the sender's reputation).

## 3. Approaches considered

**Build order**
1. **Kind by kind, foundation first (chosen by the owner).** (a) Notices, the mailer, the queue page
   and overdue follow-ups, which need no student-app change, so the whole loop from a click to a
   notice and an email on My Loans is checkable first; (b) fine disputes end to end; (c) problem
   reports end to end; (d) Dashboard link, docs, final reviews and a live check. Each step is checked
   live before the next, as in slices 4 and 5. Cost: the queue endpoint grows as kinds are added.
2. **Layer by layer** (all backend, then console, then app): fewer context switches, but nothing runs
   end to end until late, and cross-layer defects have been the common kind in this project.
3. **Queue first, student side later**: smallest first step, but disputes and reports are the point
   of the page and the owner asked for them in this slice.

**Storage** (the builder's decision unless the owner objects; this is the call I made)
1. **One table per kind plus a derived overdue list (chosen):** `FineDispute`, `IssueReport` and
   `Notice`, with overdue follow-ups read live from `Loan`. Each table carries the constraints that
   matter (one dispute per fine, a report names exactly one target) and its own lifecycle.
2. One generic `AttentionCase` table with a kind column and a JSON payload: one queue query, but the
   constraints above become application code and the kinds' lifecycles are tangled together.

**Email transport**
1. **Brevo's HTTPS API, behind a thin interface (chosen).** Render's free plan blocks outbound SMTP
   (ports 25, 465, 587), so the transport must be an HTTPS API. Brevo's free plan allows 300 emails a
   day and can send without a domain, though a Gmail-style "from" address is rewritten and may land in
   spam, so the owner should authenticate a domain they control before relying on it.
2. Resend: a cleaner API and 100 free emails a day, but it only sends to the account owner's own
   address until a domain the owner controls is verified.
3. SMTP through Gmail or another relay: blocked on Render's free plan; works only on a paid instance.

Owner decisions taken in brainstorming: reminders are an in-app notice for 7 days (the pattern slices
2 and 4 use) **and** an email; email is for this slice's events only; the build order is kind by
kind; a damaged copy is reported at return (the canvas's "reported by a student at return"), not
while the student still holds it.

## 4. Data model

Additive migrations, safe on live data (the Render build runs `prisma migrate deploy`); one per build
step. Column and enum names are the builder's call; the behavior is not. Raw SQL against a plain
`timestamp(3)` column casts a bound date `::timestamp` and against a `timestamptz` column compares
without shifting by the session's zone; a test under a non-UTC session proves each new query, as in
slice 5.

- **`Notice`**: one library message to one student. The student, a kind (`overdue_reminder`,
  `overdue_escalation`, `dispute_outcome`, `report_outcome`), a short title, a body, an optional loan
  and fine it concerns, the librarian who caused it (cleared if that account is removed), when it was
  created, and the email outcome: `sent`, `failed` or `skipped`, with the time it was attempted.
  Students see a notice for 7 days (`REQUEST_OUTCOME_VISIBLE_DAYS`) and at most the 20 newest.
- **`FineDispute`**: the fine, the student, the student's reason (at most 300 characters), a status
  (`open`, `waived`, `adjusted`, `upheld`), the librarian's resolution note (at most 300), who
  resolved it and when. **At most one dispute per fine, ever**, enforced by a unique constraint.
  The fine row itself records that a dispute is open (for example a nullable "disputed at" column
  set on opening and cleared on resolution), so that paying, adjusting and disputing are all
  conditional updates on the same row (section 6.3).
- **`IssueReport`**: the reporting student; exactly one target, a book copy or a resource (a check
  constraint; a copy report is created together with the return that carries it, a resource report by
  `POST /reports`); a category (`damaged`, `missing_pages`, `not_working`, `dirty`, `other`, validated
  per target kind in the service); a note (at most 300; required when the category is `other`); a
  status (`open`, `confirmed`, `dismissed`); resolution note, resolver and time. **At most one open
  report per student and target**, by a partial unique index in the migration SQL.
- **Overdue follow-ups are not stored.** An item is an active loan whose whole days overdue is at
  least 1 (the same `overdueFineAmount` rule as the Fines page, so the amount shown always equals the
  student's own loan line). The newest `overdue_*` notice for the loan supplies "Reminded 2 days ago"
  or "Escalated".

## 5. Email

### 5.1 The mailer

A small module (`src/lib/mailer.ts`) with one function: send a plain-text message to one address and
answer `sent`, `failed` or `skipped`. It never throws and never logs a body or the key.
- **Configured** when `BREVO_API_KEY` and `MAIL_FROM` are set (`MAIL_FROM_NAME` optional, default
  "SmartLib"); otherwise it answers `skipped` without any network call.
- It calls Brevo's transactional email API over HTTPS with Node's built-in `fetch` (no new
  dependency), with a 5-second timeout and no retry. A non-2xx answer, a network error or a timeout is
  `failed`. The builder checks Brevo's current API documentation before writing the call.
- **Placeholder addresses are skipped:** the demo accounts the seed creates
  (`aditi.sharma@thapar.edu`, `seed.student<n>@thapar.edu`; one shared pattern constant in
  `config/constants.ts`) never receive mail.
- **Allowed domains (optional):** when `MAIL_ALLOWED_DOMAINS` is set (comma-separated, for example
  `thapar.edu`), only addresses at those domains receive mail; any other address is `skipped`.
  Registration accepts any well-formed address and never verifies it, so this keeps a student's book
  title and fine from going to a mistyped or made-up address, and keeps bounces off the sender. Unset
  means every address except the placeholders.
- Tests inject a fake transport. With no injected transport and `NODE_ENV=test` the mailer is
  `skipped`, so a stray key in a developer's environment cannot send from a test run.

### 5.2 When email is sent

Exactly these events, each creating a `Notice` and then an email with the same title and body (the
subject is "SmartLib: " + the title; a short footer says why the message was sent):
- A librarian sends an overdue **reminder** or an **escalation**.
- A fine dispute is **resolved** (waived, adjusted or upheld), whether from the queue or by adjusting
  the disputed fine on the Fines page.
- A problem report is **resolved** (confirmed or dismissed).

The notice row is written in the same transaction as the action, so it is committed or rolled back
with it. The email is attempted **after the commit**, awaited with the mailer's 5-second bound, and
its outcome written to the notice; the response to the librarian does not depend on the email's
success. A refused action sends nothing. A repeated click sends nothing extra (section 6.1). The live
event is published once the email outcome has been written, so a console refetch shows the true
"emailed" or "not emailed".

### 5.3 Copy (my wording; the owner may change it)

| Notice | Title | Body |
|---|---|---|
| Reminder | Overdue book reminder | "Your copy of <title> was due on <date> and is <n> days overdue. The fine is ₹<amount> so far and grows by ₹10 a day. Please return it to the library." |
| Escalation | Formal overdue notice | "<title> is now <n> days overdue (₹<amount> so far). The library needs it back now." plus the librarian's note when given |
| Dispute waived | Your fine was waived | "The library waived the ₹<amount> fine for <item>." plus the note |
| Dispute adjusted | Your fine was reduced | "The library reduced your fine for <item> to ₹<new> (it was ₹<old>)." plus the note |
| Dispute upheld | Your fine stands | "The library kept your ₹<amount> fine for <item>." plus the note |
| Report confirmed | Thanks for the report | "Thanks for reporting a problem with <target>. The library has taken it out of use for now." plus the note |
| Report dismissed | About your report | "The library looked at your report about <target> and no action was needed." plus the note |

## 6. Backend

All `/admin` routes sit behind the existing guard (401 without a token, 403 for a student), with zod
validation like the existing routes. Notes and reasons are trimmed, at most 300 characters. A
**live event** `attention.changed` on a new topic `attention` is published once, after commit (and after
any email outcome is written), by every write below, and the loan, fine and catalogue events that can add or remove a queue item carry
`attention` as well (a late return or renewal, a loan marked lost, a fine paid or adjusted). A refused
write publishes nothing.

### 6.1 The queue and overdue follow-ups

| Method and path | Purpose |
|---|---|
| `GET /admin/attention?kind=` | `kind` is `overdue`, `fine_dispute` or `report` (omitted: all). Returns `{ items, counts: { all, overdue, fine_dispute, report }, emailEnabled }`, oldest waiting first |
| `POST /admin/loans/:id/remind` | Sends a reminder |
| `POST /admin/loans/:id/escalate` | `{ note? }`: sends a formal notice |

- **Item shape.** Every item has an id, a kind, the student (id, name, email), `waitingSince`, and a
  kind-specific part: an overdue item carries the loan id, the title, the due date, whole days
  overdue, the amount so far, whether the loan was ever escalated (a reminder may follow an
  escalation, so the newest notice alone cannot say) and the newest notice (kind, time, email
  status); a dispute carries the
  fine (id, item, reason, amount, original amount, status) and the student's reason; a report
  carries the target (copy with barcode and book title, or resource name), category and note.
  `waitingSince` is the due date, the dispute's creation or the report's creation.
- **Remind and escalate** run in one transaction that locks the loan row (`FOR NO KEY UPDATE`),
  re-checks it is still active and a whole day overdue, applies the rules below, and inserts the
  notice. A loan that was returned, renewed or lost a moment earlier answers 409 "This loan is no
  longer overdue." and nothing is written.
  - A reminder is refused with 409 "A reminder was sent <n> hours ago." within 24 hours of the last
    reminder for that loan (n = 0 reads "less than an hour ago" and n = 1 "1 hour ago"; only reminders
    start the clock, an escalation neither resets it nor blocks a reminder).
  - An escalation happens once per loan; a second answers 409 "This loan was already escalated."
  - An escalation does not change any amount; the fine keeps growing at ₹10 a day and becomes a
    stored fine when the book is returned or marked lost.
- Unknown loan id: 404 `Loan not found`. A loan that exists but is no longer active or no longer a whole
  day overdue (returned, renewed, lost, or under a day late) is the 409 "This loan is no longer
  overdue." above, so a console page left open sees why its card went stale.

### 6.2 Fine disputes

| Method and path | Purpose |
|---|---|
| `POST /fines/:id/dispute` | Student auth. `{ reason }` (required, trimmed, 1–300). 201 |
| `POST /admin/disputes/:id/uphold` | `{ note? }`: closes the dispute, the fine stands |

- **A student may dispute** only their own fine, only while it is outstanding or adjusted, and only
  once. Another student's fine is 404. Paid or waived is 409 "This fine can't be disputed because it
  is already paid or waived." A second dispute on the same fine, in any state, is 409 "You've already
  disputed this fine."
- **Waive or adjust** uses the existing `POST /admin/fines/:id/adjust`, which now also closes an open
  dispute in the same transaction: `waived` when the new amount is 0, otherwise `adjusted`, with the
  adjustment's reason as the resolution note, and creates the outcome notice. The queue's "Waive /
  adjust" button opens the Fines page's adjust dialog; adjusting the fine from the Fines page has the
  same effect.
  - **The request names the dispute the librarian saw.** The adjust body gains `disputeId` (the id of
    the open dispute shown with the fine, or absent when the fine showed none), the way mark-paid
    carries the amount. If a dispute is open and the request does not name it, 409 "This fine was just
    disputed. Read the dispute before changing the fine." and nothing changes; if the request names a
    dispute that is no longer open, 409 "This dispute was already resolved." So a librarian working
    from a page loaded before the dispute existed can never close it unread, or send a student
    "Your fine was reduced" in reply to a reason nobody read.
  - **Any other path that waives a fine closes its dispute too:** restoring a copy with the
    replacement charge waived (slice 5) closes an open dispute on that fine as `waived`, with the
    restore's reason as the note, and sends the same notice.
- **Uphold** is a conditional update on the dispute's `open` status, clearing the fine's disputed
  marker and creating the notice. A second uphold, or an uphold of a dispute already closed by an
  adjustment, answers 409 "This dispute was already resolved."
- **Paying a disputed fine is refused**: `POST /admin/fines/:id/paid` answers 409 "This fine is being
  disputed. Resolve the dispute first." (after the paid and waived refusals, before the
  changed-amount refusal).

### 6.3 The races around a dispute

Opening a dispute, marking the fine paid and adjusting it are all conditional updates on the same fine
row: the dispute sets the marker with `WHERE status IN (outstanding, adjusted) AND marker IS NULL`;
payment gains `AND marker IS NULL`; adjustment keeps its slice 5 conditions and the `disputeId` rule
above. Whichever statement commits first wins and the other gets its specific 409. What "one winner"
means for each pair:
- **Dispute versus pay:** exactly one. A paid fine cannot be disputed and a disputed fine cannot be
  paid.
- **Dispute versus a waive (adjust to ₹0):** exactly one. A waived fine cannot be disputed; a waive
  that did not name the dispute is refused.
- **Dispute versus a partial adjust:** a librarian never closes a dispute unseen (above). If the
  adjust lands first, the student may still dispute the now-lower fine (it is still owed, and it is
  their one dispute); if the dispute lands first, the adjust is refused until the librarian has seen
  it.
- **Pay versus adjust:** slice 5's rules (one winner, by the amount the payer saw).
This is pinned by tests that hold the row lock the way slice 5's race tests do, for every pair.

### 6.4 Problem reports

| Method and path | Purpose |
|---|---|
| `POST /loans/:id/return` | The existing student return gains an optional body `{ report: { category, note? } }` (a copy report, below) |
| `POST /reports` | Student auth. A resource report: `{ resourceId, category, note? }`. 201 |
| `POST /admin/reports/:id/confirm` | A copy: `{ outcome: 'maintenance' \| 'lost', note? }`. A resource: `{ note? }` |
| `POST /admin/reports/:id/dismiss` | `{ note? }` |

- **A copy is reported when it is returned.** `POST /loans/:id/return` takes an optional `report`
  (`damaged`, `missing_pages` or `other`, with an optional note, required for `other`). The report row
  is created in the same transaction as the return, so the two succeed or fail together: a student
  never returns a book and loses the report, or the reverse. The return's own rules (race-safe,
  conditional on the loan being active) are unchanged, and a refused return creates no report. There
  is no other way to report a copy: the student's copy has to be back on the shelf before the
  librarian can act on it.
- **A resource is reported with `POST /reports`**, by a student who has a booking on it with a raw
  status of `booked`, `checked_in` or `completed` that started within the last 7 days or starts
  within the next 24 hours. A booking the student never checked into counts (a student who finds the
  seat broken and leaves is the likely case, and the status is still `booked` in the database); a
  cancelled booking, a request, or a booking made for later than tomorrow does not. Otherwise 403
  "You can only report a seat or room you have booked." Categories: `not_working`, `dirty` or
  `other` (note required for `other`); anything else is 400.
- **One open report per student and target:** a second answers 409 "You already reported this. The
  library is looking into it."
- **Confirm** performs the action with the existing service (a copy to maintenance, or to lost from
  the shelf, from slice 5; a resource taken offline from slice 4, with the report's text as the note),
  then closes the report with a conditional update on `open` and creates the notice. **A report never
  charges anyone:** confirming a copy as lost works only for a copy on the shelf and never takes the
  on-loan path with a replacement charge; a copy that has been lent again is refused ("This copy is
  now on loan.") and the librarian uses the Catalogue if it is really lost. If the action is refused
  ("This copy is now on loan.", "This copy is set aside for a student on the waitlist.", "This
  resource is already offline."), the refusal is returned and the report stays open for the
  librarian to dismiss or handle in the Catalogue. Confirm is idempotent on the target's state: a copy
  already in maintenance, or a resource already offline, closes the report without error. Dismiss
  closes with the note.
- A report already closed answers 409 "This report was already resolved."

### 6.5 Notices and the student's fines

- `GET /notices/me` (student auth): `{ id, kind, title, body, createdAt }`, newest first, the last 7
  days, at most 20. A kind the app does not know still carries its title and body.
- `GET /fines/me` rows gain one additive field, `dispute: { status, note } | null` (the student's
  dispute, open or resolved). `status` keeps its four values; the older app ignores the new key.
- `AdminFineDto` gains `disputed` as a derived status (an open dispute) and a `dispute` object (the
  dispute's id, the student's reason and when it was opened, or null); the Fines page's status filter
  gains Disputed and `canSettle` stays true (waive or adjust) while `Mark paid` is unavailable. The
  adjust dialog sends `dispute.id` as the `disputeId` of section 6.2.
- `GET /bookings/me` rows gain two additive fields: `canReport` (the booking meets the resource
  report rule of section 6.4 and has no open report) and `reportOpen` (the student has an open report
  on the resource). The older app ignores them.
- **Notice and report foreign keys do not block a re-seed:** a notice's loan and fine links are
  cleared when the loan or fine is deleted (the rendered text stays); see section 9 for the rows a
  re-seed deletes.

## 7. Console

- **Sidebar:** a **Needs attention** entry after Requests, with its own live count badge
  (`counts.all`), from an `AttentionProvider` like `RequestsProvider`. Route `/attention`; its page
  title "Needs attention"; `/attention?type=overdue|fine_dispute|report` selects a chip (the
  Dashboard's Overdue card links to `?type=overdue`).
- **Page** (canvas): chips All, Overdue follow-ups, Fine disputes, Maintenance flags, each with its
  count (no No-show chip); a card per item: a type tag (Overdue follow-up, Fine dispute, Maintenance
  flag), the student as a `StudentLink` (`from=attention`), "waiting 3 days", a summary line and a
  detail line, two buttons. Loading skeleton, error "Couldn't load the queue" with Retry. Empty state
  "You're all caught up" with the canvas's wording changed where it no longer holds: "Nothing needs
  attention right now. Overdue loans, fine disputes and problem reports will show up here."
- **Overdue card:** summary "<title> — <n> days overdue", detail "<fine so far>. <last notice line>"
  (for example "Reminded 2 days ago · emailed", "· not emailed", "Escalated 1 day ago"). Buttons
  **Send reminder** and **Escalate**. The reminder dialog says whether an email goes too (from
  `emailEnabled`): "…gets a notice in the app and an email about <title>." or "…gets a notice in the
  app about <title>. Email isn't set up." The escalation dialog adds an optional note and says the
  fine keeps growing until the book is back.
- **Fine dispute card:** summary "Disputes ₹<amount> <reason> fine on <item>", detail the student's
  words. **Waive / adjust** opens the Fines page's adjust dialog (reused, not copied, and sending the
  dispute's id); **Uphold fine** confirms with an optional note.
- **Maintenance flag card:** a copy report reads "Copy <barcode> of <title>, reported at return:
  <category>" with the student's note as the detail; **Confirm & flag copy** opens the canvas's
  reason select (Damaged and Missing pages mean maintenance, Lost means lost) with an optional note,
  and says a confirmation never charges the student; a resource report reads "<resource> —
  <category>" and offers **Take offline** (the slice 4 dialog, note prefilled); both have **Dismiss**
  (confirm, optional note). A refusal (the copy was lent again, a waitlisted student needs it) shows
  as a toast and the card stays.
- **Behavior:** every write goes through `useWriteAction` and `useDialogSubmit`, so a refusal toasts
  the server's message and keeps the dialog and its text; buttons stay disabled until the list has
  refetched. The page refetches on `attention` (and the badge likewise); never polls.
- **Fines page:** the Disputed filter option and tag return (canvas wording); a disputed row shows
  the student's reason as a muted line and hides Mark paid, keeping Waive / adjust.
- **Student page:** `StudentFrom` gains `attention`, so the breadcrumb reads "Needs attention /
  <student>".
- **Dashboard:** the Overdue materials card becomes a link (slice 1 left it unlinked because this
  queue did not exist).

## 8. Student app

- **Dispute a fine.** Each fine in My Loans' Fines section that is outstanding or adjusted and has no
  dispute shows a **Dispute** button. It opens a dialog, "Dispute this fine", with one required field
  ("Why do you think this fine is wrong?", at most 300 characters) and Send. After it, the card shows
  "Under review" in place of the button. A resolved dispute shows its outcome under the card: waived
  and adjusted already read from the fine itself (status and "Library note"); upheld reads "The
  library kept this fine." plus the note. The button never returns after a dispute.
- **Library notices.** A **Library notices** section at the top of My Loans (hidden when empty), from
  `GET /notices/me`: each notice's title in bold, its body and its date; escalations in the accent
  colour. It loads with the screen and refetches each time My Loans opens, like the loans and fines
  (slice 5's rules: keyed on the user, joins a fetch in flight, never shows a previous user's value
  during an account switch).
- **Report a problem with a book: at return.** The Return confirmation gains an optional "Report a
  problem with this copy" choice (Damaged, Missing pages, Other) with an optional note (required for
  Other); the choice and the return are sent together (`POST /loans/:id/return` with `report`), so a
  report is never lost if the return succeeds. There is no report button on the On-loan card.
- **Report a problem with a seat or room.** A **Report a problem** button on each My Bookings card the
  server marks `canReport`; a dialog with category options (Not working, Dirty, Other) and an
  optional note (required for Other). After sending, the card shows "Reported" (`reportOpen`).
- Either report's outcome arrives as a library notice (and an email when configured).
- **Older apps** keep working: the new key on a fine is ignored, notices are simply not shown, and
  email reaches every student whatever app version they run.
- Fixtures are captured from a real backend (extend `tool/capture_fixtures.dart`: open a dispute,
  have the admin remind a loan and resolve a report), as in earlier slices.

## 9. Seed

- A few open items so the queue has data on a fresh seed: the demo and seed students' overdue loans
  already supply overdue follow-ups; the seed adds two open fine disputes (on outstanding seed fines),
  one open copy report and one open resource report, with no librarian named. A disputed seed fine
  carries the fine's disputed marker, so it behaves like a real one (Mark paid refused).
- The seed never sends email and never creates notices.
- **Re-seeding** resets these rows with the rest, deleted before the rows they point at: disputes on
  any fine the re-seed deletes (including other students' fines on demo books, so no dispute is left
  without its fine), disputes and reports by seed users, reports on the demo books' copies and on the
  seed resources, and notices for seed users. A notice for another student that points at a demo-book
  loan or fine survives with those links cleared (its text is already rendered). Disputes, reports and
  notices for books and resources the librarians added are never touched. A re-seed after any console
  use must still succeed.

## 10. Verification

- **Backend** (Vitest, real database; fake mail transport): every route's 401, 403, 404 and
  validation; the queue's derivation and ordering, including the boundary (a loan 23 hours overdue is
  absent, a day overdue is present and its amount equals the loan's own line); each refusal message;
  the 24-hour reminder rule and once-only escalation; the notice and the action committing or rolling
  back together; **email**: exactly one send per action, after commit, none on a refusal or a repeat
  click, `failed` on an error or a timeout with the action unaffected, `skipped` when unconfigured, for
  a placeholder address or outside `MAIL_ALLOWED_DOMAINS`, nothing logged, the event published after
  the email outcome is written; **disputes**: ownership and eligibility, adjust closing the dispute
  (waived or adjusted) with its notice, adjust refused when it does not name an open dispute (and when
  it names a closed one), a restore-waive closing the dispute, uphold, double resolution, Mark paid
  refused while open, and the race pairs of section 6.3 each with the outcome stated there;
  **reports**: a copy report created with the return and rolled back with a refused one, resource
  eligibility (including a never-checked-in booking, excluding a cancelled one and one for later than
  tomorrow), one open per target, confirm for each outcome (never charging), a refusal leaving the
  report open, idempotent confirm, dismiss, the `canReport` and `reportOpen` flags; the 7-day notice
  window; events published once after commit and none on refusal; the seed's open items and the
  re-seed rules (a re-seed after a librarian-made dispute keeps it).
- **Console** (Vitest + Testing Library): the page's four states and chips, each action and dialog and
  its copy, a refusal keeping the dialog, busy handling, the badge, the Dashboard link, the Fines
  page's Disputed filter and hidden Mark paid, the breadcrumb, live refetch from a scripted stream.
- **Flutter:** model parsing from captured fixtures, the Dispute dialog and its states, the notices
  section, both report dialogs, per-user guards, an unknown notice kind rendering its title and body.
- **Live check** (all three apps; the owner types the admin password; Brevo configured only if the
  owner has set it up, otherwise the email path is checked with the fake transport and the console
  copy "Email isn't set up"): remind an overdue loan and see the notice in the app; dispute a fine
  from the app, see it in the queue and on the Fines page, waive it and see the outcome; return a
  book with a damage report and report a seat from the app, confirm one and dismiss the other; a
  second console updating without a reload; re-seed with an open dispute. Screenshots if the browser
  works. Sending real email needs a student account whose address the owner chooses (every seeded
  student uses a placeholder address, which never receives mail).
- **Docs:** README and CLAUDE.md in each package (routes, topic, mailer settings, the dispute rule);
  copy this spec and its plan to `admin/docs/` as before.

## 11. Constraints

Node 22 (built-in `fetch`, no new dependency), Express 5, Prisma 7 (never edit
`backend/src/generated/**`; check every generated migration for a `DROP` of
`no_overlapping_bookings` or `BorrowRequest_one_pending_per_title`), PostgreSQL with `btree_gist`.
`BREVO_API_KEY` is a secret: it is set only as an environment variable (never committed, printed or
logged) and documented in `.env.example` and the README's Render settings next to `MAIL_FROM` and
`MAIL_FROM_NAME`. The console keeps its token in `localStorage` and sends it only in the
`Authorization` header; times are stored in UTC and shown in library time. Older student APKs must
keep working. The deployed API lags the code; this slice is verified locally first.

## 12. Left to the builder, owner actions, and calls I made

Left to the builder: migration, column and enum names; how the fine row records an open dispute; the
queue's SQL (one query or a merge in the service); the `AttentionProvider` and component layout; the
exact Brevo request fields; copy the canvas and this spec do not give (error strings follow the
existing pattern: specific, never "Something went wrong" when the server gave a reason).

**Owner actions before email works in production:** create a Brevo account; authenticate a sender
address or, better, a domain you control (DNS records); set `BREVO_API_KEY` and `MAIL_FROM` on Render,
and consider `MAIL_ALLOWED_DOMAINS=thapar.edu` so only university addresses are emailed. Until then
notices work and emails are recorded as skipped. Also: Render is still not deploying the backend
(slices 2–5 are not live), which must be fixed for any of this to reach students.

Calls I made (not stated by the owner; correct any):
- A reminder at most every 24 hours per loan; an escalation once per loan; neither changes any amount
  and "Escalate & fine" in the canvas becomes "Escalate".
- Overdue items appear from one whole day overdue.
- A fine can be disputed once, only while outstanding or adjusted; a disputed fine cannot be paid.
- A copy is reported only when returned (the owner's choice); a seat or room by a student with a
  booking that started within 7 days or starts within 24 hours, checked in or not; one open report per
  student and target; no photos.
- A report never charges anyone; a confirmed copy "Lost" is only for a copy on the shelf.
- Adjusting a disputed fine must name the dispute (so no dispute is closed unread); a student may
  still dispute a fine a librarian has just lowered.
- A waive by restore also closes a dispute on that fine.
- Email is optionally limited to `MAIL_ALLOWED_DOMAINS`.
- Notices last 7 days, at most 20 shown; there is no "mark as read".
- Brevo is the provider; email is skipped, not failed, when unconfigured; demo placeholder addresses
  never receive mail; the email send is awaited for at most 5 seconds and never fails the action.
- The empty-state wording is changed from the canvas because borrows and bookings are no longer
  handled automatically.
- No-show disputes and the No-show chip wait for no-show detection.
