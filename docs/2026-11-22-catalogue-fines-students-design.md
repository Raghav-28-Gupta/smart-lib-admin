# SmartLib Admin Console — Slice 5: Fines, Catalogue and the Student Page

**Status:** draft for approval (2026-11-22). Slices 4 (done), 5 (this one) and 6 (the "Needs
attention" queue, which brings student disputes) are agreed in that order; ML work follows slice 6.

**Repos touched:** `backend/` (schema, services, routes, events, seed), `admin/` (three pages and
student-name links), `frontend/` (a Fines section on My Loans). Run scripts inside each package;
commit prefixes `backend:`, `admin:`, `frontend:`; the owner commits, never the assistant.

## 1. Intent

After slice 4 the console runs the study-space side of the library, but a librarian still cannot
manage books and copies, see or settle fines, or look at one student's record. This slice adds the
last three sections of the design canvas (`docs/superpowers/assets/admin-console/canvas-source.dc.html`):
**Fines**, **Catalogue** and the **student page**, on real data, so the console covers everything
the canvas shows except the moderation queue. The canvas is the visual authority for layouts, states
and dialogs; this spec says how they are fed, what the canvas leaves out, and what students see.

Today fines barely exist: a `Fine` row is written only when a student returns or renews late;
nothing marks a fine paid; after a return the student cannot see the fine anywhere; and an overdue
book still out shows "₹X and counting" in the app but appears nowhere else. This slice makes fines a
complete, visible record on both sides.

## 2. Goals, non-goals, anti-goals

**Goals**
- Fines page: every fine and every overdue book still out, searchable and filterable; a librarian
  marks a fine paid, or waives or lowers it with a reason.
- Students see their fines in the app, including the librarian's reason for a waive or adjustment.
- Catalogue page: search, add and edit books, add copies, and move a single copy (by barcode)
  between available, maintenance and lost — including a copy a student has on loan and lost.
- Every copy has a unique barcode, including the copies already in production.
- Student page: profile, reliability score and history, loan, booking and fine history, and a
  manual reliability adjustment with a reason. Student names across the console link to it.
- Every change reaches open consoles through the live event bus.

**Non-goals**
- Disputes and the "Disputed" status (slice 6). The canvas's Disputed filter option stays hidden.
- No-show fines: nothing creates them until no-show detection exists (ML work). The Reason column
  and the student list still handle the `no_show` value.
- Online payment, refunds, raising a fine's amount, changing the ₹10/day placeholder rate.
- Deleting books or copies, editing or printing barcodes, bulk import or export.
- A list or search of all students (the canvas has none; students are reached by name links).
- Emails, push notifications, overdue reminders and escalations (the queue's actions, slice 6).
- The canvas's "New" reliability tag and its 75-point tier boundary (see 7.3).

**Anti-goals** (failure even if the code works)
- A student charged, or a fine changed, without the student being able to see it and why.
- Money recorded wrongly: a fine paid twice, a waive and a payment racing so one silently wins, or
  an accruing amount on the console that differs from the student app's "and counting" line.
- A waitlisted student promised a copy that no longer exists because a librarian took it out of
  service.
- A student-facing "x of y copies available" that disagrees with the shelf after a copy action.
- Re-running the seed (it also runs against production) crashing, touching a book a librarian
  added, or leaving a fine behind with no item (see section 9 for what a re-seed resets).
- Any change that lowers a reliability score for something the library did, other than an explicit,
  reasoned manual adjustment.

## 3. Approaches considered

1. **Page by page, Fines first (chosen by the owner).** Fines (backend, console page, student-app
   list), then Catalogue (barcodes, copy actions, the lost-on-loan flow), then the student page;
   each page is finished end to end and checked live before the next. Fines goes first because the
   lost-on-loan flow creates fines and the student page shows them, so each later page plugs into
   something already working. Same shape as slice 4.
2. **Page by page in the canvas's order** (Catalogue, Fines, student page): the lost-book flow would
   pull part of Fines forward into the Catalogue work, and the rest of Fines would fit around it.
3. **Two smaller slices** (5a Fines + student page, 5b Catalogue): ships half sooner, costs an extra
   design, plan and final review, and the student page would briefly link to a missing Catalogue.

Owner decisions taken in brainstorming: a librarian marks fines paid (payment happens at the desk);
students get a Fines list in the app; overdue books still out show on the Fines page as read-only
"Accruing" rows; marking an on-loan copy lost closes the loan and charges a replacement fine;
restoring such a copy offers to waive that replacement fine; the console uses the app's reliability
tiers (one server rule for both); a re-seed resets the demo books fully and never touches books a
librarian added.

## 4. Data model

One migration per page, each additive and safe on live data (the Render build runs
`prisma migrate deploy`). Column and enum names are the builder's call; behavior is not.

**Fines (page 1)**
- A fine can be **outstanding** (owed, never adjusted), **adjusted** (owed, amount lowered by a
  librarian), **paid** or **waived**. The existing `pending` value is outstanding; renaming it is the
  builder's call, but the API speaks `outstanding`.
- A fine records its **original amount**, and for an adjustment or waive: who, when, and the reason.
  For a payment: who recorded it and when. "Who" may be empty (seeded examples, or a librarian
  account later removed); the console and app then say "the library".
- `FineReason` gains **`lost`** (a replacement charge for a lost book).
- A fine names what it is for: overdue and lost fines through their loan (book title), no-show
  fines through their booking (resource name).

**Catalogue (page 2)**
- `BookCopy` gains a **barcode**: unique, required, shaped `SL-00001` (prefix and five digits, the
  number growing by one for each new copy). The migration assigns barcodes to every existing copy,
  ordered by book title then copy id, then makes the column required.
- A loan can end as **lost**, with the time it was marked. A lost loan is closed: it is not active,
  not returned, and not overdue from that moment.

**Student page (page 3)**
- A reliability log entry can record the **librarian** who made a manual adjustment (null for
  automatic changes).

## 5. Fines

### 5.1 Backend

| Method and path | Purpose |
|---|---|
| `GET /admin/fines` | `search` (student name or email), `status` (`accruing`, `outstanding`, `adjusted`, `paid`, `waived`), `page`, `pageSize` (default 25, max 100). Newest first. Returns `{fines, total, page, pageSize}` |
| `POST /admin/fines/:id/paid` | Records payment of an outstanding or adjusted fine |
| `POST /admin/fines/:id/adjust` | `{amount, reason}`: lowers the amount; `0` waives it |
| `GET /fines/me` | The student's own fines (student auth) |

- **Rows.** Each fine row carries: student (id, name, email), reason (`overdue`, `no_show`, `lost`),
  item (book title or resource name), amount, original amount, status, date (when the fine was
  created), and for adjusted or waived fines the reason and the librarian's name.
- **Accruing rows** are computed, not stored: one per active loan past its due date, with amount =
  whole days overdue × ₹10, **the exact function the student app's loan line uses**, and date = the
  due date. They have no id usable by the paid/adjust routes. They appear in "All statuses" and under
  the `accruing` filter, merged with fine rows into one newest-first, paged list (raw SQL with a
  UNION is acceptable). When the book is returned or renewed late, the existing code writes the
  fine and the accruing row disappears.
- **Mark paid** and **adjust** are conditional updates, like slice 4's cancel: they apply only if
  the fine is still outstanding or adjusted. Otherwise a specific 409 ("This fine is already paid",
  "This fine was waived"), and the console refetches. A payment and an adjustment racing on one fine
  produce exactly one winner.
- **Adjust rules.** `amount` is a whole number of rupees, at least 0 and **lower than the current
  amount** (else 400 "The new amount must be lower than ₹X"). `reason` is required, trimmed, at most
  300 characters. `0` sets the fine **waived**; anything else sets it **adjusted** with the new
  amount. An adjusted fine can be adjusted again (lower still) or paid; the original amount is kept
  from the first adjustment, and the latest reason and librarian are shown.
- **Student list** (`GET /fines/me`): the student's fines, newest first, at most 50, each with
  item, reason, amount, original amount, status, date, and the librarian's reason when waived or
  adjusted; plus `outstandingTotal` (sum of outstanding and adjusted amounts). Accruing amounts are
  not included; the student already sees them on each overdue loan.
- **Paging and search** must stay fast for a few thousand fines and loans.

### 5.2 Console

The **Fines** sidebar item is enabled. The page follows the canvas: student search (debounced),
status select (**All statuses, Accruing, Outstanding, Adjusted, Paid, Waived**), count, table
(Student, Reason, Item, Amount, Status, Date, actions), pager ("x–y of N", 25 per page), loading
skeleton, empty ("No fines match these filters" with Clear filters), error with Retry.

- **Status tags:** Accruing and Outstanding use the canvas's accent tag; Adjusted, Paid and Waived
  the accent-2 tag. An adjusted amount shows as "₹50 (was ₹150)".
- **Actions** on outstanding and adjusted rows: **Mark paid** (confirm dialog: "Mark this fine as
  paid? <student> — <item>, ₹<amount>. Record this once the student has paid at the desk.") and
  **Waive / adjust** (the canvas dialog: new amount, required reason; Save disabled until the reason
  is filled and the amount is valid). Accruing, paid and waived rows have no actions.
- The student name is a link to the student page (section 7).
- Buttons stay disabled while a write is in flight and until the list has refetched, as on the
  Bookings page (`useWriteAction`).

### 5.3 Student app

My Loans gains a **Fines** section below the loans: a header "Outstanding: ₹X" (hidden when 0), then
one card per fine: item, reason label (Overdue, No-show, Lost book), amount (adjusted shows
"₹50, was ₹150"), status (Outstanding, Adjusted, Paid, Waived), date, and for a waive or adjustment
"Library note: <reason>". Empty state: "No fines." A status this version does not know uses the
existing unknown-status fallback ("Update the app to see this item's status."), so a later
"Disputed" never breaks the list.

**Refresh on open.** Today My Loans fetches once per login (it refetches only after a 409, while a
borrow request is pending, or from book detail), and the app has no pull-to-refresh. So that a
payment, waive, adjustment or lost loan shows up, My Loans (loans and the Fines section) refetches
quietly each time it is opened, the way slice 4 made My Bookings do (`_refreshOnOpen`), keeping
what it shows while the fetch runs.

## 6. Catalogue

### 6.1 Backend

| Method and path | Purpose |
|---|---|
| `GET /admin/books` | `search` (title, author, ISBN or barcode), `page`, `pageSize` (default 25, max 100). Title order. Each book with its copies; also returns the list of genres in use |
| `POST /admin/books` | `{isbn, title, author, genre, description?, publishedYear?, copies}` (201) |
| `PATCH /admin/books/:id` | Edit the same fields except copies |
| `POST /admin/books/:id/copies` | `{count}`: adds that many available copies |
| `POST /admin/copies/:id/maintenance` | Shelf copy to maintenance |
| `POST /admin/copies/:id/lost` | Shelf or on-loan copy to lost; `{replacementCharge}` required when on loan |
| `POST /admin/copies/:id/restore` | Maintenance or lost copy back to available; `{waiveReplacementCharge?}` for a copy lost on loan |

- **Copy row:** id, barcode, status (`available`, `on_loan`, `held` for a pending borrow request,
  `maintenance`, `lost`), and when on loan the borrower (id, name) and due date. A copy marked
  borrowed with no open loan (seed data has some) shows as on loan with no borrower.
- **Validation:** ISBN required, trimmed, at most 20 characters, unique (409 "A book with this ISBN
  is already in the catalogue"); no checksum check, because the seed's ISBNs are placeholders. Title
  and author required, at most 200; genre required on create, at most 50; description at most 2000;
  published year 1450 to the current year; copies and count 1 to 20.
- **Counts the student sees:** a book's total is its copies that are not lost; available is its
  copies with status available (unchanged). However the total is computed or stored, every copy
  action and every added copy keeps it right in the same transaction.
- **Copy actions are conditional updates** on the copy's current status, with specific 409s when it
  changed underneath ("This copy is now on loan", "This copy is already in maintenance").
  - **Maintenance:** only from available.
  - **Lost from the shelf:** from available or maintenance.
  - **Out of service and the waitlist:** taking an available copy out of service is refused (409
    "This copy is set aside for a student on the waitlist.") when it would leave fewer available
    copies than live waitlist claims for the book.
  - **Restore:** from maintenance or lost back to available, then the same waitlist hand-off a
    return runs (`onBookReturned`), so a waiting student gets it first.
  - **Restoring a copy that was lost on loan** (owner decision: the student found the book and
    brought it back). The loan stays closed as lost and its overdue fine stands. If the loan's
    replacement fine is still owed (outstanding or adjusted), the request may carry
    `{waiveReplacementCharge: true}`; the same transaction then waives it, recorded with the
    librarian and the reason "Book returned after it was marked lost". A paid replacement fine is
    not refunded. If the fine changed underneath (paid a moment earlier), the restore still happens
    and the response says the fine was not waived.
  - **Held copies** (a pending borrow request) accept no action.
- **Lost while on loan** (owner decision) happens in one transaction, conditional on the loan still
  being active and the copy still borrowed: the loan ends as lost; any overdue amount so far becomes
  an overdue fine (same rule as a late return); a `lost` fine is created for the replacement charge
  (whole rupees, 0 to 10,000; `0` creates no lost fine); the copy becomes lost. A student who returns
  or renews at the same moment gets a clean 409, and exactly one side wins. After it, the loan leaves
  the student's My Loans, the fines appear in their Fines list, the student's return and renew
  routes answer 409 "This loan was closed because the copy was marked lost.", and the Dashboard's
  overdue count and circulation stop counting the loan (it is not a return).

### 6.2 Console

The **Catalogue** sidebar item is enabled. The page follows the canvas: search (debounced), count,
**Add book**, one card per book (title, author, genre tag, "n of m available", Edit, **+ Copies**),
a chip per copy (barcode, status tag, actions), pager, loading skeleton, empty ("No books match your
search" with Clear search), error with Retry.

- **Copy chip actions:** available: Maintenance, Lost; on loan: Lost; maintenance or lost: Restore;
  held: none. An on-loan chip's tooltip or line names the borrower and due date.
- **Dialogs:** the canvas's copy-status confirmations; **Lost while on loan** says whose loan closes
  ("<student> has this copy, due <date>. Their loan closes, any overdue fine so far is charged, and
  the replacement charge becomes a Lost book fine they can see.") with a required replacement charge
  field; **Restore** of a copy lost on loan whose replacement fine is still owed shows that fine with
  a box, ticked by default, "Waive <student>'s ₹X replacement charge"; **Add book** and **Edit book** with ISBN, title, author, genre (typed, with suggestions from
  the genres in use), description, published year, and on Add the number of copies; **Add copies**
  with a count.
- Book cards link nowhere; the borrower's name on an on-loan copy links to the student page.

### 6.3 Student app

No code change. Added books and copies, and copies taken out of service or restored, show in search
and book detail on the next fetch; the lost-on-loan flow shows through My Loans and the Fines
section. Barcodes are not shown to students.

## 7. Student page

### 7.1 Backend

| Method and path | Purpose |
|---|---|
| `GET /admin/students/:id` | Profile, reliability, and the three histories (404 for an unknown id or an admin account) |
| `POST /admin/students/:id/reliability` | `{delta, reason}`: manual adjustment |

- **Profile:** name, email, roll (`'Pending'` when null, as the app shows it), score, tier (the same
  function `/profile/reliability` uses), and the reliability history: the score log, newest first,
  at most 50 entries, each with date, score, change, reason and, for manual entries, the librarian.
- **Histories,** newest first, at most 50 each: loans (title, borrowed, due, returned or lost date,
  status: active, overdue, returned, lost); bookings (resource, date, time, status derived with the
  same rules as the Bookings page, room requests included with Requested, Declined or Expired); fines
  (as in 5.1, plus the student's accruing rows).
- **Adjust:** `delta` an integer from −10 to 10, not 0; `reason` required, at most 300. It is stored
  with reason "Library adjustment: <reason>" and the librarian, through the existing clamp to 0–100.
  If the clamp would leave the score unchanged, 409 ("The score is already at 100." / "... at 0.").
  The update must not lose a concurrent automatic change (a check-in bonus landing at the same moment
  must survive): a row lock or an atomic update, the builder's call.
- **What the student sees:** no app change. The reliability card already shows the newest drop's
  reason ("Your reliability score recently dropped: Library adjustment: <reason>") and the history
  dots; a positive adjustment shows as an on-time dot.

### 7.2 Console

- **Route** `/students/<id>`, with the section it was opened from carried in the URL
  (`?from=fines` and so on). The top bar shows the canvas's breadcrumb ("Fines / Aditi Sharma") and
  the sidebar keeps that section highlighted; opened directly, it falls back to "Dashboard".
- **Content** follows the canvas: header (initials, name, roll · email, tier tag, **Adjust
  reliability**), reliability card (ring, line chart, dated history list), loan, booking and fine
  history tables with their empty lines, loading skeleton, error with Retry, and "Student not found"
  for a 404.
- **Adjust reliability** dialog: the canvas's −10 to +10 slider and required reason; Apply disabled
  at 0 or with no reason; after success the page refetches.
- **Links:** student names on the Bookings, Fines and Requests pages, and borrower names on
  catalogue copies, link here.

### 7.3 Tiers

One rule, the server's existing one: Good standing (80 and up), Building back up (50 and up), Needs
improvement (25 and up), At risk (below 25). The console shows the tier string the server sends; the
canvas's 75 boundary and "New" tag are dropped. Tag style: Good standing uses accent-2, the others
accent.

## 8. Live events

New topics **`fines`**, **`catalogue`** and **`students`**, published after commit like the
existing ones; events still carry no state.

| Change | Topics |
|---|---|
| A fine created on a late return or renewal (in addition to what those already publish) | `fines` |
| Fine marked paid, adjusted or waived | `fines` |
| Book added or edited; copies added; copy to maintenance, lost or restored | `catalogue` |
| Copy lost while on loan | `catalogue`, `fines`, `metrics` |
| Copy restored with its replacement fine waived | `catalogue`, `fines` |
| Manual reliability adjustment | `students` |

The Fines page listens to `fines` (and refetches when a loan event could change accruing rows: a
return, a renewal, or an approval that starts a loan, which already publish `metrics` or
`requests`); the Catalogue to `catalogue` and to events that change copy status (borrow request
created, decided or lapsed; a return); the student page to every topic that could change what it
shows. Accruing amounts change at midnight with no event; the page shows the amount as of its last
fetch.

## 9. Seed

- Every seeded copy gets a barcode from the same sequence as any other copy (not fixed numbers).
- The generated history's late returns create overdue fines; the seed marks a few paid and adjusts
  and waives a few, with no librarian named, so every filter has data. The demo student's account
  stays as the app's fixtures expect.
- **What a re-seed resets** (owner decision): the demo books and their copies go back to their demo
  state, which undoes console edits to them and removes copies librarians added to them; every loan,
  borrow request, waitlist entry and fine tied to a demo book is deleted, including other students'
  (as loans are today), so no fine is left without its item. The seed students' own history is reset
  wherever it points, including loans, requests and fines on books librarians added.
- **What a re-seed never touches:** books librarians added, their copies, and other students' rows on
  them. A re-seed after any console use must succeed. This closes the slice 4 deferred item about the
  seed breaking once books can be added.

## 10. Verification

- **Backend** (Vitest, real database): every new route's 401, 403 and validation; each action's
  happy path and every refusal; races with exactly one winner (paid vs adjust; lost vs student
  return; lost vs student renew; manual adjust vs check-in bonus keeps both changes); the waitlist
  refusal and the restore hand-off; restore with and without the replacement waive, and with the
  fine paid a moment earlier; a re-seed after console use (an added book with a loan and a fine, an
  added copy on a demo book) succeeds and keeps the added book; the student-visible total and available counts after every copy
  action; accruing amounts equal the loan DTO's `fineAmount`; the lost loan leaves `/loans/me` and
  the overdue metric; the migration's barcode backfill on existing copies; events published once
  after commit and none on a refused action. Dates derived from now, never fixed.
- **Console** (Vitest + Testing Library): each page's four states, filters, pager, dialogs and their
  validation, busy and disabled handling, breadcrumb and highlight on the student page, links from
  the other pages, live refetch with a scripted stream.
- **Flutter:** fine model parsing against a captured fixture (extend `tool/capture_fixtures.dart`),
  the Fines section's states, adjusted and waived lines, unknown-status fallback, and My Loans
  refetching when opened.
- **Live check per page** (all three apps; the owner types the admin password): Fines: return a
  book late and see the accruing row become an outstanding fine; mark one paid; waive one and see
  the note in the student app. Catalogue: add a book with two copies and find it in the student app;
  put a copy in maintenance and see the available count drop; restore it to a waitlisted title and
  see the claim; mark an on-loan copy lost and see the loan leave My Loans and two fines appear;
  restore it with the waive ticked and see the replacement fine turn Waived in the app.
  Student page: open it from each page's link, adjust reliability and see it in the app's card.
  A second console updates without reload throughout. Screenshots for the report.
- **Docs:** README and CLAUDE.md in each package (routes, topics, the lost rule, barcodes); copy
  this spec and its plan to `admin/docs/` as before.

## 11. Constraints

Node 22, Express 5, Prisma 7 (never edit `backend/src/generated/**`; check every generated
migration for a `DROP` of `no_overlapping_bookings` or `BorrowRequest_one_pending_per_title`),
PostgreSQL with `btree_gist`. Amounts are whole rupees. The console keeps its token in
`localStorage` and sends it only in the `Authorization` header; times are stored in UTC and shown in
library time (`NEXT_PUBLIC_LIBRARY_TIMEZONE`). Older student APKs must keep working: new statuses
reach them only through fields that already have an unknown fallback, and lost loans are simply
absent from their lists. The deployed API lags the code; this slice is verified locally first.

## 12. Left to the builder, and calls I made

Left to the builder: migration, column and enum names; how the student-visible total is kept right
(computed or a maintained column); the SQL that merges accruing rows into the fines list; how the
reliability update avoids a lost update; indexes; component file layout; copy the canvas does not
give (specific error strings, never "Something went wrong" when the server gave a reason).

Calls I made (not stated by the owner; correct any):
- "Adjusted" is an owed state, not a final one: an adjusted fine can be paid or lowered again. Only
  lowering is allowed; a paid or waived fine cannot be changed.
- The Disputed filter is hidden until slice 6; an "Accruing" filter is added.
- Fines list, catalogue and student histories page or cap at 25 / 25 / 50, newest first (catalogue
  in title order).
- Barcodes are generated (`SL-00001`), never typed or edited, and not shown to students.
- ISBN is required and unique but not checksum-validated; genre is typed with suggestions; books
  and copies cannot be deleted.
- Maintenance only from the shelf; lost from the shelf, maintenance or a loan; restore runs the
  waitlist hand-off; a copy held for a borrow request has no actions; taking a copy out of service
  that a waitlist claim depends on is refused.
- A lost copy stops counting toward the student-visible total; the replacement charge is entered by
  the librarian (0 means no charge).
- The student's Fines list shows recorded fines only (accruing amounts stay on the loan cards).
- Manual reliability changes are shown to the student as "Library adjustment: <reason>"; no-op
  adjustments at 0 or 100 are refused.
- No list of all students; the student page refuses admin accounts.
- My Loans refetches each time it is opened (no pull-to-refresh), as My Bookings does since slice 4.
- "Recorded by" on payments, waives and adjustments may be empty and then reads "the library"; the
  seed's paid, adjusted and waived examples name no librarian.
- Seeded copies take barcodes from the shared sequence, so their numbers change on each re-seed.
