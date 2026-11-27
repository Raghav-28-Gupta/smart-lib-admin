# SmartLib — Admin Console

The librarian console for SmartLib: log in with an admin account, approve or
decline the borrow and room requests students send, manage the study-space
resources and the bookings on them, manage the catalogue's books and copies,
settle fines, work through the Needs attention queue (overdue loans, disputed
fines, problem reports, disputed no-shows), open any student's record, and see live utilisation,
circulation, overdue and demand metrics. Everything updates live, without
reloading. Built
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

## Requests

The Requests page lists the pending borrow and room requests, with **Approve** and
**Decline** (an optional reason the student sees). Room requests are listed in the
server's **suggested order**: a request the no-show model scored as likely to be
missed sits up to 72 minutes later than its request time says (never hidden,
declined or relabelled), and its card carries a small neutral second line,
"Suggested order: 18 min later (predicted no-show risk 22%)", only when the delay is
above zero. A request that was never scored (the AI service was asleep, down or not
set up when it was made) is placed by its request time and has no note. The
**By request time** checkbox at the end of the chip row restores plain request-time
order (`GET /admin/requests?order=request`) and hides the note; the page puts the
suggested order back when you leave it. Borrow requests always keep request time,
the counts and the sidebar badge do not change with the order, and the Dashboard's
waiting panel sorts its first three by request time itself. A newly scored request
arrives with a `request.scored` event, so an open page reorders by itself.

## Resources

The Resources page lists every seat and room by name, with its location,
position, capacity and status; a type filter narrows it to seats or rooms. A
librarian can:

- add a resource: type, name, location and a capacity from 1 to 100;
- edit its name, location and capacity (the type is fixed once it exists);
- place a seat on the student app's seat map with **Row** and **Column** on the
  seat form (shown for seats only; whole numbers from 1 to 50);
- take it offline, with an optional note (up to 300 characters) that shows on
  its row, or bring it back online;
- set the front of each zone in the **Seat map zones** box under the table.

A seat's place is both a row and a column, or neither (both empty keeps the seat
off the map), and a seat on the map needs a location, which is its zone. Two
seats in one zone cannot share a spot, and an offline seat still holds its spot.
The form checks all of this as it is filled in, and names the seat that holds a
taken spot; the server's own refusal, which only a race reaches, shows as the
usual toast. The **Position** column reads "Row 2 · Col 5" for a seat on the map,
"Not on map" for one that is not, and "—" for a room.

A zone is a distinct seat location, written exactly (so "Reading room A" is a
zone of its own beside "Reading Room A"), and a new one appears as soon as a seat
is given that location. The Seat map zones box has a line for each, with how many
seats it has and how many are on the map ("48 seats, 46 on the map"), and a
**Front of room** box with Save: a label of up to 40 characters that the student
app prints along the top of that zone's map, such as "Windows". Saving it blank
clears it. The box refetches with the page on a `resources` event.

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
- status: Booked, Checked in, Completed, No-show, Cancelled or Released (grace period).

A **No-show** row is a booking nobody checked into that the server recorded as
missed (the sweep writes it within minutes of the grace period ending, and the
student's reliability drops). **Released (grace period)** is a booking past its
grace period that nothing has penalized: the minutes before the sweep reaches it, an
older booking from before no-shows were recorded, or a no-show a librarian
overturned. Neither can be cancelled or moved.

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

## Fines

The Fines page lists every fine and every overdue book still out, newest first,
25 to a page with Previous and Next. Overdue books still out show as **Accruing**
rows: read-only, with the amount owed so far (₹10 for each whole day, the same
figure the student's app shows on the loan), as of the last fetch, since it grows
at midnight with no event. Two filters narrow the list, and changing either goes
back to page 1:

- search, for a student's name or email (sent after a short pause in typing);
- status: Accruing, Outstanding, Disputed, Adjusted, Paid or Waived.

A fine that was ever lowered shows "₹50 (was ₹150)", and under its status the
librarian's reason (with who recorded it, "the library" when no one, for an
adjusted or waived one). A fine its student has disputed shows a **Disputed**
tag in place of Outstanding or Adjusted, with the student's words under it
(cut at two lines, all of it on hover). A librarian can, on an outstanding or
adjusted row:

- **Mark paid**, once the student has paid at the desk. The confirmation shows
  the amount, and it is sent with the request: if a colleague lowered the fine
  meanwhile the server refuses and a toast says so, rather than recording the
  payment against the new amount. A disputed row has no Mark paid: the server
  takes no payment while a dispute is open;
- **Waive / adjust**: a new amount in whole rupees below the current one (0
  waives it) and a required reason (up to 300 characters). The student sees the
  reason as the library's note in the app. On a disputed row the request names
  the dispute the row showed, so the server closes it with the adjustment
  (waived at ₹0, otherwise adjusted) and tells the student. If the student
  disputed the fine after the page loaded, the server refuses ("This fine was
  just disputed. Read the dispute before changing the fine.") and the row
  refetches showing the dispute.

Accruing, paid and waived rows have no actions. If the fine was settled or
changed first, a toast gives the server's reason and the list refreshes. A
student's name opens their page. A dispute can also be settled from Needs
attention, which can leave the fine as it is (Uphold fine).

## Catalogue

The Catalogue page lists books in title order, 25 to a page, one card each: title,
author, genre, "n of m available" (m leaves out lost copies, as students see it),
**Edit**, **+ Copies**, and a chip for every copy with its barcode, status tag and
actions. A search box (sent after a short pause) matches title, author, ISBN or
a copy's barcode. A librarian can:

- **Add book**: ISBN (unique), title, author, genre (typed, with the genres in
  use as suggestions), an optional description and published year, and 1 to 20
  copies; **Edit** changes the same fields;
- **+ Copies**: add 1 to 20 available copies; a student waiting for the title
  gets a claim on them first;
- move a single copy: **Maintenance** or **Lost** on an available one, **Lost**
  on one on loan, **Restore** on one in maintenance or lost. A held copy (kept
  for a pending borrow request) has no actions.

Barcodes (`SL-00001` and up) are given by the server and cannot be edited. The
dialogs keep what was typed when the server refuses, and a toast gives its
reason (for example the ISBN already exists, or "This copy is set aside for a
student on the waitlist."). Restore also runs the waitlist hand-off, so a
waiting student gets the copy first.

An on-loan chip names the borrower, who links to their page, and the due date.
Marking an on-loan copy **Lost** asks for a replacement charge (₹0 to ₹10,000)
and says whose loan closes: the loan ends as lost, the overdue amount so far is
charged, and the charge becomes a Lost book fine the student can see. **Restore**
on a copy lost that way, with its replacement charge still owed, offers a ticked
box to waive that charge (for a student who found the book and brought it back);
the loan stays closed as lost and its overdue fine stands. If the charge was
paid (or waived) a moment earlier the copy is restored and a toast says it was
not waived. A waived charge the student had disputed closes that dispute as
waived, and they are told.

## Student page

A student's name on the Bookings, Fines, Requests and Needs attention pages, and a
borrower's on a catalogue copy, opens `/students/<id>?from=<section>`. The top bar reads
"Fines / Aditi Sharma" and the sidebar keeps that section highlighted; opened
directly, the page falls back to "Dashboard". It shows:

- the header: initials, name, roll and email, the reliability tier (the
  server's own: Good standing, Building back up, Needs improvement or At risk)
  and **Adjust reliability**;
- the reliability card: the score ring, a line through the history, and the
  dated list with each change's reason (a manual one names the librarian; a
  recorded no-show reads `No-show: <resource>` and an overturned one's points come
  back as `No-show overturned: <resource>`);
- loan, booking and fine history, newest first, up to 50 each, read-only (a fine
  is settled on the Fines page, a booking managed on the Bookings page; a
  disputed fine shows the Fines page's Disputed tag and the student's words).

**Adjust reliability** moves the score by −10 to +10 (never 0) with a required
reason of up to 300 characters. The student's reliability card in the app shows a
drop as `Library adjustment: <reason>` (a rise shows as an on-time dot). It is
refused with a toast when the score is already at 100 or 0. An id that is not a
student (an admin account's included) shows "Student not found".

## Needs attention

The Needs attention page has its own sidebar entry, after Requests, with a badge
counting everything waiting (hidden at 0). It lists only what needs a librarian,
oldest wait first, one card each: a type tag, the student (a link to their page,
which leads back here), "waiting 3 days", a summary, a detail line and two
actions. Chips filter it: All, Overdue follow-ups, Fine disputes, No-show disputes
and Maintenance flags, each with its count. `/attention?type=overdue`,
`fine_dispute`, `no_show_dispute` or `report` opens with a chip selected (the
Dashboard's Overdue materials card links to `?type=overdue`); clicking a chip
does not change the address. The console fetches the whole queue in one request
(the API's `?kind=` filter is not used), so the chips and the badge always agree.
An item of a kind this console does not know (a newer server's) is left out of
the list, though the counts still include it. An empty queue reads "You're all
caught up".

| Card | Shown when | Actions |
|---|---|---|
| Overdue follow-up | a loan is a whole day or more overdue; the detail line gives the fine so far (₹10 a day, as on the Fines page) and the last notice | **Send reminder**, **Escalate** |
| Fine dispute | a student disputed an outstanding or adjusted fine (one dispute per fine, ever); the detail line is their reason, in full (never cut: the dispute is decided on it, and a fine is disputed once) | **Waive / adjust**, **Uphold fine** |
| No-show dispute | a student disputed a booking recorded as a no-show (one dispute per booking, within 7 days); the card names the resource, the booking ("Thu, Oct 22, 2–4 PM", library time) and gives the student's words in full with their line breaks | **Overturn no-show**, **Uphold flag** |
| Maintenance flag | a student reported a copy when returning it, or a seat or room they booked, with a category and a note (the card cuts a long note at two lines, all of it on hover; the Confirm and Dismiss dialogs show it whole) | **Confirm & flag copy** (a copy) or **Take offline** (a seat or room), and **Dismiss** |

- **Send reminder**: at most one a day for a loan (an escalation neither starts
  nor blocks that clock).
- **Escalate**: a formal notice, with an optional note, once per loan. The card
  then carries an Escalated tag and loses the button; a reminder can still
  follow. It changes no amount: the fine keeps growing until the book is back.
- **Waive / adjust**: the Fines page's dialog (₹0 waives; a reason is required),
  with the student's reason shown under its text (only here: the Fines page's own
  dialog is unchanged), and its request names the dispute, so the server closes
  the dispute with it.
- **Uphold fine**: closes the dispute with the fine standing; optional note. The
  dialog repeats the student's reason.
- **Overturn no-show**: removes the flag and restores the reliability points the
  no-show took; a reason is required (up to 300 characters, off until it holds
  something besides spaces) and goes in the student's notice. The dialog shows the
  student's words above the reason field.
- **Uphold flag**: closes the dispute with the flag standing; optional note. The
  dialog repeats the student's words. Either one answered meanwhile by someone else
  is refused with "This dispute was already resolved." and the dialog keeps what
  was typed.
- **Confirm & flag copy**: Damaged and Missing pages send the copy to
  maintenance, Lost marks it lost (only a copy on the shelf); optional note.
  Confirming never charges the student. A copy lent out again, or set aside for
  a waitlisted student, is refused and the report stays open for Dismiss.
- **Take offline**: the Resources page's dialog, its note started with the
  student's words; one request takes the resource offline and closes the report.
  A resource that is already offline just closes the report.
- **Dismiss**: closes the report with no action ("<report> will be cleared from the
  queue with no further action"); optional note.

**What the student is told.** Every action on this page writes a notice on the
student's My Loans, or My Bookings for a no-show (kept for 7 days, the 20 newest)
and, when the library has set up email, sends the same text by email: "Overdue
book reminder", "Formal overdue notice", "Your fine was waived", "Your fine was
reduced", "Your fine stands", "Thanks for the report" (the library has taken it
out of use), "About your report" (no action was needed), "No-show removed" and
"No-show stands". A note you add (for a waive or adjustment, or the required
reason for overturning a no-show) follows the text as "Note from the library: …". The reminder
dialog says which applies: "…gets a notice in the app and an email about <title>"
or "…Email isn't set up." The overdue card's last-notice line ("Reminded 2 days
ago · emailed") says "emailed" only when the email went out; "not emailed" covers
email that is not set up, a demo account's placeholder address, an address
outside the server's `MAIL_ALLOWED_DOMAINS` and a provider failure, and the
notice in the app is there in every case. Email is set up on the backend
(`../backend/README.md`), never here.

Every write goes through the shared write action: one at a time, and when the
server refuses ("A reminder was sent 3 hours ago.", "This dispute was already
resolved.", "This copy is now on loan.") a toast gives its reason, the dialog
keeps what was typed and the queue refetches. The buttons stay off until it has.

## Live updates

The console keeps one Server-Sent Events connection to `GET /admin/events`
(`lib/live.ts`). Events only say what changed; the views refetch, a second
after the last event. On every reconnect, and every 5 minutes, everything
refetches, so a dropped connection loses nothing. The top bar shows
`● Live` or `○ Reconnecting…`.

Each event names the topics it affects, and a view refetches on its own:

- `requests`: the Requests page and the sidebar count, and the Catalogue (a
  pending borrow request holds a copy) and student pages (`request.scored`, a
  room request the model has just scored, is one of these events);
- `metrics`: the dashboard;
- `bookings`: the Bookings page (a seat booked, a check-in, a cancel or a move, a
  no-show recorded or overturned) and the student page;
- `resources`: the Resources page and its Seat map zones box (one added, edited,
  moved on the map, taken offline or brought back, or a zone's front label
  saved);
- `fines`: the Fines page and the student page (a fine marked paid, adjusted or
  waived, disputed, or written when a late loan is returned or renewed);
- `catalogue`: the Catalogue page and the student page (a book or copy changed,
  a loan returned, a copy lost on loan);
- `students`: the student page (a manual reliability adjustment, a no-show
  recorded or overturned);
- `attention`: the Needs attention page and its sidebar badge
  (`attention.changed`: a reminder or escalation sent, a dispute (a fine's or a
  no-show's) or problem report filed or settled; a late return or renewal, or a
  copy lost on loan, carries it too, since the overdue card leaves the queue).

## Design

The specs and plans for each slice are in `docs/`. Every section of the sidebar
is built: Bookings and Resources (slice 4), then Fines, Catalogue and the student
page (slice 5), then Needs attention with fine disputes and problem reports
(slice 6, `docs/2026-11-22-needs-attention-design.md`), then no-show handling
(slice 7, `docs/2026-11-24-no-show-handling-design.md`): the Bookings No-show
filter, no-show disputes in Needs attention and the Requests page's suggested
order. The canvas's no-show pieces that were waiting (the No-show option, the
No-show disputes chip and the Overturn and Uphold dialogs) are built. Detection,
the sweep and the reliability rule live in the backend (`../backend/README.md`,
*No-shows*).
