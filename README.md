# SmartLib — Admin Console

The librarian console for SmartLib: log in with an admin account, approve or
decline the borrow and room requests students send, manage the study-space
resources and the bookings on them, manage the catalogue's books and copies,
settle fines, open any student's record, and see live utilisation, circulation,
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

## Fines

The Fines page lists every fine and every overdue book still out, newest first,
25 to a page with Previous and Next. Overdue books still out show as **Accruing**
rows: read-only, with the amount owed so far (₹10 for each whole day, the same
figure the student's app shows on the loan), as of the last fetch, since it grows
at midnight with no event. Two filters narrow the list, and changing either goes
back to page 1:

- search, for a student's name or email (sent after a short pause in typing);
- status: Accruing, Outstanding, Adjusted, Paid or Waived.

A fine that was ever lowered shows "₹50 (was ₹150)", and under its status the
librarian's reason (with who recorded it, "the library" when no one, for an
adjusted or waived one). A librarian can, on an outstanding or adjusted row:

- **Mark paid**, once the student has paid at the desk. The confirmation shows
  the amount, and it is sent with the request: if a colleague lowered the fine
  meanwhile the server refuses and a toast says so, rather than recording the
  payment against the new amount;
- **Waive / adjust**: a new amount in whole rupees below the current one (0
  waives it) and a required reason (up to 300 characters). The student sees the
  reason as the library's note in the app.

Accruing, paid and waived rows have no actions. If the fine was settled or
changed first, a toast gives the server's reason and the list refreshes. A
student's name opens their page.

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
not waived.

## Student page

A student's name on the Bookings, Fines and Requests pages, and a borrower's on a
catalogue copy, opens `/students/<id>?from=<section>`. The top bar reads
"Fines / Aditi Sharma" and the sidebar keeps that section highlighted; opened
directly, the page falls back to "Dashboard". It shows:

- the header: initials, name, roll and email, the reliability tier (the
  server's own: Good standing, Building back up, Needs improvement or At risk)
  and **Adjust reliability**;
- the reliability card: the score ring, a line through the history, and the
  dated list with each change's reason (a manual one names the librarian);
- loan, booking and fine history, newest first, up to 50 each, read-only (a fine
  is settled on the Fines page, a booking managed on the Bookings page).

**Adjust reliability** moves the score by −10 to +10 (never 0) with a required
reason of up to 300 characters. The student's reliability card in the app shows a
drop as `Library adjustment: <reason>` (a rise shows as an on-time dot). It is
refused with a toast when the score is already at 100 or 0. An id that is not a
student (an admin account's included) shows "Student not found".

## Live updates

The console keeps one Server-Sent Events connection to `GET /admin/events`
(`lib/live.ts`). Events only say what changed; the views refetch, a second
after the last event. On every reconnect, and every 5 minutes, everything
refetches, so a dropped connection loses nothing. The top bar shows
`● Live` or `○ Reconnecting…`.

Each event names the topics it affects, and a view refetches on its own:

- `requests`: the Requests page and the sidebar count, and the Catalogue (a
  pending borrow request holds a copy) and student pages;
- `metrics`: the dashboard;
- `bookings`: the Bookings page (a seat booked, a check-in, a cancel or a move)
  and the student page;
- `resources`: the Resources page (one added, edited, taken offline or brought
  back);
- `fines`: the Fines page and the student page (a fine marked paid, adjusted or
  waived, or written when a late loan is returned or renewed);
- `catalogue`: the Catalogue page and the student page (a book or copy changed,
  a loan returned, a copy lost on loan);
- `students`: the student page (a manual reliability adjustment).

## Design

The specs and plans for each slice are in `docs/`. Every section of the sidebar
is built: Bookings and Resources (slice 4), then Fines, Catalogue and the student
page (slice 5). The librarian's "Needs attention" queue, with student disputes, is
the next slice and has no sidebar entry yet.
