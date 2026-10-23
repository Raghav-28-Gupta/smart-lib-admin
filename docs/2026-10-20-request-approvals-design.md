# SmartLib — Slice 2: Request Approvals and the Live Console

**Status:** approved in brainstorming on 2026-10-20; awaiting written-spec review.
**Scope:** slice 2. It replaces the earlier slice 2 plan, which moves later:

| Slice | Content |
|---|---|
| 1 (shipped) | Admin login, console shell, analytics Dashboard |
| **2 (this spec)** | Borrow and room requests that a librarian approves, live in the console |
| 3 | Android push notifications for request decisions (Firebase Cloud Messaging) |
| 4 | Bookings and Resources management (was slice 2) |
| 5 | Catalogue, Fines and the student drawer (was slice 3) |

The "Needs attention" moderation queue stays deferred with no slice.

## 1. Goal

Borrowing a book and booking a group room stop taking effect on their own. A student's
borrow or room booking becomes a request that holds the copy or the slot; a librarian
approves or declines it in the admin console, which shows every request and every
student action live, without a reload. Seats, renewals, returns, check-ins,
cancellations and the waitlist keep working instantly.

Success means:

- A student requests a book or a room in the app, and the request appears in the
  console's Requests page, Dashboard panel, sidebar badge and tab title within
  2 seconds, on a console that was already open.
- Approving starts the loan (or confirms the booking); declining or letting it lapse
  frees the copy or slot, and the student sees the outcome in the app within
  30 seconds while the relevant screen is open.
- Dashboard numbers change within 2 seconds of any student action that moves them.
- Nobody can take a held copy or slot, and two librarians can never both decide the
  same request.
- A console that loses its connection reconnects by itself and shows correct data
  afterwards.

## 2. Decisions

| Topic | Decision |
|---|---|
| Meaning of "requests reach the admin" | Approval: borrows and room bookings wait for a librarian |
| What needs approval | Borrowing a book; booking a room. Not seats, not renewals |
| While waiting | The copy or slot is held; nobody else can take it |
| Lapsing | A borrow request lapses 24 h after it is made; a room request lapses when the slot's 15-minute grace period ends |
| Declining | An optional reason, shown to the student; without one the student sees "Declined by the library" |
| Student learns the outcome | In-app status, re-checked every 30 s while a request is pending and its screen is open. Android push follows in slice 3 |
| Live channel | Server-Sent Events from the backend to the console; events name what changed and the console refetches |
| Console layout | The canvas's "Needs attention" card layout, used as the Requests queue; its "handled automatically" copy no longer applies |
| Compatibility | Old student app versions must update; the API change cannot be hidden from them |

## 3. Request lifecycle and data model

### 3.1 Room requests

A room request is a `ResourceBooking` row, because the database's no-overlap rule has
to see a held slot.

- `BookingStatus` gains `requested`, `declined` and `expired`.
- Booking a **room** creates the row as `requested`. Booking a **seat** creates it as
  `booked`, exactly as today.
- Transitions out of `requested`: approve → `booked`; decline → `declined`; lapse →
  `expired`; the student withdraws → `cancelled`. Nothing else leaves `requested`.
- New columns on `ResourceBooking`:
  - `requestedAt` timestamptz, not null, default `now()`. Rows that exist before the
    migration get the migration time; the value is accurate from this release on.
  - `decidedAt` timestamptz, null: when the row left `requested` (approved, declined,
    expired or withdrawn).
  - `decidedById` text, null, references `User`: the librarian who approved or declined.
  - `declineReason` text, null.
- The `no_overlapping_bookings` exclusion constraint is recreated with
  `WHERE (status IN ('requested', 'booked', 'checked_in'))`, so a pending request holds
  its slot and a declined, expired or cancelled one frees it.
- Every query that treats a slot as taken uses the same three statuses: the student
  availability endpoint and the conflict alternatives in `bookingService.ts`.
- A room request's deadline is `startTime + gracePeriodMinutes`.

### 3.2 Borrow requests

A borrow request is a row in a new `BorrowRequest` table. A `Loan` stays a real loan
with a due date, so no loan, fine or metric code changes.

| Column | Type | Notes |
|---|---|---|
| `id` | text (uuid) | |
| `userId` | text → `User` | the student |
| `bookId` | text → `Book` | |
| `bookCopyId` | text → `BookCopy` | the held copy |
| `status` | `BorrowRequestStatus` | `pending`, `approved`, `declined`, `expired`, `cancelled` |
| `requestedAt` | timestamptz | default `now()` |
| `expiresAt` | timestamptz | `requestedAt + 24 h` |
| `decidedAt` | timestamptz, null | when it left `pending` |
| `decidedById` | text → `User`, null | the librarian who approved or declined |
| `declineReason` | text, null | |
| `loanId` | text → `Loan`, null, unique | set on approval |

- `CopyStatus` gains `requested`: the copy is set aside for a pending request and does
  not count as available.
- **Request:** the same checks as borrowing today, in this order: the student does not
  already have an active loan of the title; does not already have a pending request
  for it; at least one copy is available; and the available copies are not all
  claimed by other waitlisted students. Then one available copy is claimed with the
  same race-safe conditional update `borrowBook` uses, and set to `requested`. If the
  student held a waitlist claim for the title, the claim is consumed (the request
  replaces it).
- **Approve:** in one transaction, the request becomes `approved`, a `Loan` is created
  with `borrowedAt = now` and `dueAt = now + 14 days`, the copy becomes `borrowed`,
  and `loanId` is set.
- **Decline, lapse or withdraw:** the request becomes `declined`, `expired` or
  `cancelled`, the copy goes back to `available`, and the waitlist cascade runs for the
  book (the next waiting student receives a 48-hour claim).
- The existing `POST /loans` no longer creates loans (§4.1).

### 3.3 Lapsing

- `expireStaleRequests(now)` expires every pending borrow request whose `expiresAt` has
  passed and every `requested` booking whose deadline has passed, applying §3.2's
  effects and setting `decidedAt` to the time of the sweep. It publishes one
  `request.expired` event when it expired at least one row.
- It runs when the server starts, every 60 seconds while the server is running, and at
  the start of: creating a borrow request, `GET /borrow-requests/me`, `GET /bookings/me`
  and `GET /admin/requests`. A lapsed request is therefore never shown as pending.
- The 60-second sweep is started by the server entrypoint (`src/index.ts`), not by the
  Express app, so tests never run it implicitly; it stops on shutdown.
- Book availability counts (search and detail) can lag a lapse by up to 60 seconds.

### 3.4 What students see

- `GET /borrow-requests/me` and `GET /bookings/me` show pending requests, plus declined
  and expired requests whose `decidedAt` is within the last 7 days. `GET /bookings/me`
  otherwise lists bookings exactly as today (everything except `cancelled`).
- Approved borrow requests are not listed: the loan appears in My Loans.
- Withdrawn requests are not listed.

### 3.5 Slice 1 metric fix

Utilisation and demand (`adminMetricsService.ts`) count a booking as booked when its
status is `booked` or `checked_in`, instead of "not cancelled". Requests, declines and
lapses do not inflate utilisation. A no-show is still `booked` and still counts, as the
slice 1 spec decided. Circulation and overdue read only `Loan` and are unaffected.

### 3.6 Migration

Two migrations, because Postgres cannot use an enum value in the transaction that adds
it:

1. Add the enum values: `BookingStatus` `requested`, `declined`, `expired`; `CopyStatus`
   `requested`.
2. Create `BorrowRequestStatus` and `BorrowRequest`; add the four `ResourceBooking`
   columns; drop and recreate `no_overlapping_bookings` with the new `WHERE`; add
   indexes on `BorrowRequest(status, expiresAt)` and `ResourceBooking(status, startTime)`;
   and add a hand-written partial unique index on `BorrowRequest(userId, bookId)
   WHERE status = 'pending'`, so two quick requests from one student cannot hold two
   copies of a title. A violation of it answers the same 409 as the application check:
   `You've already requested this book.`

## 4. Backend API

### 4.1 Student endpoints

**`POST /borrow-requests`** `{ bookId }` → 201 `BorrowRequestDto`.

| Case | Status | Message |
|---|---|---|
| Unknown book | 404 | `Book not found` |
| Active loan of this title | 409 | `You already have this book borrowed.` |
| Pending request for this title | 409 | `You've already requested this book.` |
| No copy available | 409 | `No available copies right now.` |
| Available copies all claimed by others | 409 | `All available copies are reserved for waitlisted students right now.` |

**`GET /borrow-requests/me`** → 200 `BorrowRequestDto[]`, newest first (§3.4).

**`POST /borrow-requests/:id/cancel`** → 200 `BorrowRequestDto`.

| Case | Status | Message |
|---|---|---|
| Unknown id | 404 | `Borrow request not found` |
| Another student's | 403 | `This request belongs to another user.` |
| Not pending | 409 | `This request is no longer pending.` |

```ts
interface BorrowRequestDto {
  id: string
  bookId: string
  bookTitle: string
  status: 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled'
  requestedAt: string   // ISO, UTC
  expiresAt: string
  decidedAt: string | null
  declineReason: string | null
}
```

**`POST /loans`** → 409 `Borrowing now needs a librarian's approval. Update the SmartLib app to send a request.`
Older app versions show this as their error toast. The route keeps its validation, so
a malformed body still gets 400.

**`POST /bookings`**: unchanged for seats. For a room it creates the `requested` row
and returns 201 with the booking (below). A conflict still returns 409
`This resource is already booked for that time.` with alternatives; held slots count
as taken.

**`GET /bookings/me`**: also lists room requests (§3.4).

**`POST /bookings/:id/cancel`**: also withdraws a `requested` booking (→ `cancelled`).
Its other rules are unchanged; check-in still requires `booked`.

`BookingDto` keeps every existing field. Its raw `status` can now also be `requested`,
`declined` or `expired`; its `frontendStatus` gains the same three values (a requested,
declined or expired booking always reports that value, never a time-window one); and it
gains two fields:

```ts
expiresAt: string | null      // requested only: startTime + grace period
declineReason: string | null  // declined only; null when declined without a reason
```

### 4.2 Admin endpoints

All under the existing `/admin` guard (valid token, stored role `admin`).

**`GET /admin/requests`** → 200, pending requests of both kinds, oldest first:

```ts
interface AdminRequestsResponse {
  requests: AdminRequestDto[]
  counts: { all: number; borrow: number; room: number }
}

interface AdminRequestDto {
  id: string
  kind: 'borrow' | 'room'
  student: { id: string; name: string; email: string }
  requestedAt: string
  expiresAt: string
  book?: { id: string; title: string; author: string; availableCopies: number; totalCopies: number }
  room?: { resourceId: string; name: string; location: string | null; startTime: string; endTime: string }
}
```

`availableCopies` is the count of copies still `available`, which excludes the copy
held for this request.

**`POST /admin/requests/:kind/:id/approve`** and
**`POST /admin/requests/:kind/:id/decline`** `{ reason?: string }` → 200
`{ id, kind, status, decidedAt }`. `kind` is `borrow` or `room`; `reason` is trimmed,
at most 300 characters, and an empty string counts as no reason.

The decision is a conditional update on the pending status, so the first decision wins.

| Case | Status | Message |
|---|---|---|
| `kind` other than `borrow` or `room` | 400 | from request validation |
| Unknown id | 404 | `Request not found` |
| Approved by someone already | 409 | `Already approved by {name}.` |
| Declined by someone already | 409 | `Already declined by {name}.` |
| Lapsed (including at the moment of approving) | 409 | `This request expired.` |
| Withdrawn by the student | 409 | `The student withdrew this request.` |
| Reason longer than 300 characters | 400 | from request validation |

Approving a request whose deadline has passed expires it first, then answers 409.

**`GET /admin/events`**: the live stream (§5.2).

## 5. Live events

### 5.1 Event bus

`src/lib/events.ts` holds an in-process publish/subscribe bus. Services publish after
their database write has committed.

```ts
type LiveTopic = 'requests' | 'metrics'
interface LiveEvent {
  type: 'request.created' | 'request.decided' | 'request.expired' | 'request.cancelled' | 'activity'
  topics: LiveTopic[]
  kind?: 'borrow' | 'room'
  summary?: string   // request.created only
}
```

| Student or librarian action | Event | Topics |
|---|---|---|
| Borrow request created | `request.created`, summary `{student} wants to borrow {title}` | requests |
| Room request created | `request.created`, summary `{student} wants {room} · {Thu, Oct 22} · {2–3 PM}` | requests |
| Borrow or room request withdrawn | `request.cancelled` | requests |
| Requests lapsed (one event per sweep) | `request.expired` | requests |
| Request approved | `request.decided` | requests, metrics |
| Request declined | `request.decided` | requests |
| Seat booked; check-in; booking cancelled; loan renewed; loan returned; waitlist joined or left | `activity` | metrics |

Dates and times in summaries use the server's time zone (`TZ`), like every other
library time.

There is one Render instance, so the in-process bus reaches every connected console.
Running several instances would need a shared bus (Redis pub/sub); this is documented
in the backend README, not built.

### 5.2 `GET /admin/events`

- Behind the `/admin` guard. A missing, invalid or non-admin token gets the usual JSON
  401 or 403 before any streaming starts.
- Response headers: `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
  `X-Accel-Buffering: no`. Headers are flushed immediately.
- On open it writes `retry: 5000`, then `event: ready` with `data: {}`.
- Each event is written as `event: {type}` followed by one `data:` line holding the
  event as JSON without its `type`, omitting absent fields, e.g.
  `data: {"topics":["requests"],"kind":"borrow","summary":"Aditi Sharma wants to borrow Clean Code"}`.
- A comment line `: ping` every 25 seconds.
- The server ends each stream after 15 minutes. The console reconnects at once, which
  re-checks the token and the stored role.
- The subscription is removed when the client disconnects.
- On shutdown (SIGTERM) the server ends every open stream before closing, because an
  open stream would otherwise hold the HTTP server open until its 15 minutes are up and
  Render would kill the process mid-shutdown.

### 5.3 Console live client

- `lib/live.ts` opens the stream with `fetch` (the token in the `Authorization` header),
  reads the body as a stream and parses events, including events split across chunks.
  It does not use the 60-second timeout of `apiRequest`.
- Status: `connecting`, then `live` after `ready`, `reconnecting` after a failure.
- Reconnect delays: 1, 2, 5, 10, then 30 seconds for every later attempt; the sequence
  restarts after a `ready`. A stream the server closes normally reconnects after 1 second.
- No bytes for 60 seconds (heartbeats included) counts as a dead connection: abort and
  reconnect.
- A 401 or 403 ends the session through the same path as `apiRequest`: clear the token
  and dispatch `SESSION_ENDED_EVENT` with `expired` or `not-admin`.
- `LiveProvider` (inside `ConsoleGuard`, mounted only for a signed-in admin) exposes the
  status and topic subscriptions. On every `ready` and every 5 minutes it sends a
  `resync` to every subscriber, so views refetch after a disconnect and the requests
  keep Render awake while the console is open.
- Views refetch on their topics with a 1-second trailing debounce, so a burst of events
  causes one refetch.

## 6. Admin console

### 6.1 Shared request state

`RequestsProvider` (inside `LiveProvider`) holds the pending requests: it fetches
`GET /admin/requests` on mount, on the `requests` topic, on every resync, and right
after each decision this console makes (so the list is current even while the stream
is reconnecting). The
sidebar badge, tab title, Dashboard panel and Requests page all read from it.

### 6.2 Sidebar and tab title

- A **Requests** item directly below Dashboard, linking to `/requests`, with a count
  badge when the count is above zero. Bookings, Catalogue, Resources and Fines stay
  disabled with "Coming soon".
- The document title is `({n}) SmartLib Admin` while requests are waiting, otherwise
  `SmartLib Admin`.
- The top bar's page title is `Requests` on `/requests`.

### 6.3 Requests page (`/requests`)

The canvas's "Needs attention" layout.

- Filter chips: `All ({n})`, `Borrows ({n})`, `Rooms ({n})`.
- One card per request, oldest first:
  - Tag: `Borrow request` (`tag-accent`) or `Room request` (`tag-accent-2`); the
    student's name; `waiting {duration}`.
  - Summary: `{title} — {author}`, or the room's name.
  - Detail: `{availableCopies} of {totalCopies} copies left · expires in {duration}`, or
    `{Thu, Oct 22} · {2–3 PM} · slot held until {2:15 PM}`.
  - Buttons: **Approve** (`btn-primary`), **Decline** (`btn-ghost`).
- Durations: under a minute `less than a minute`; under an hour `{n} min`; under a day
  `{n} h`; otherwise `{n} d`. Dates and times use `NEXT_PUBLIC_LIBRARY_TIMEZONE`.
- **Approve** sends the request at once, then shows a toast:
  `Approved. {student}'s loan of {title} starts now.` or `Approved. {room} is booked for {student}.`
- **Decline** opens the canvas dialog:
  - Title `Decline this request?`
  - Body `{student} — {summary}. The {copy|slot} goes back to other students.`
  - Field `Reason (optional)`, placeholder `Shown to the student, e.g. the room is reserved for an event`.
  - Buttons `Cancel` and `Decline request`.
  - Then a toast: `Declined. {student} will see it in the app.`
- While a decision is in flight its buttons are disabled; a second click sends nothing.
- A 409 shows the server's message as a toast, and the list refetches.
- States:
  - Loading: three skeleton cards.
  - Error: `Couldn't load requests` with **Retry**.
  - Empty: title `You're all caught up`, text
    `No requests waiting. New borrow and room requests appear here the moment students send them.`
  - Empty filter: `No borrow requests waiting.` or `No room requests waiting.`

### 6.4 Dashboard

- A **Waiting for approval ({n})** card above the KPI row, with a `View all` link to
  `/requests`. It lists the three oldest requests in one line each:
  `Borrow` or `Room` tag, `{student} · {title}` or `{student} · {room} · {2–3 PM}`,
  the waiting time, and Approve and Decline (same behaviour and dialog as §6.3).
  With none waiting it shows the single line `No requests waiting.` While loading it
  shows one skeleton line; on error, `Couldn't load requests.` with **Retry**.
- The four metrics refetch on the `metrics` topic and on resync, without showing the
  loading skeleton again; the previous numbers stay until the new ones arrive.

### 6.5 Live indicator and toasts

- Beside the date in the top bar: `● Live` while the stream is live, `○ Connecting…`
  before the first `ready`, `○ Reconnecting…` after a failure.
- A toast for each `request.created`: title `New borrow request` or `New room request`,
  the event's summary, and a `Review` link to `/requests`. At most three are visible;
  each hides after 6 seconds. Decision toasts (§6.3) use the same component.

## 7. Student app

### 7.1 Book detail

- **Request to borrow** replaces **Borrow this copy**, both for an open copy and for a
  copy held for the student from the waitlist. After sending: toast
  `Request sent. A librarian will review it soon.`
- With a pending request: `Requested — waiting for a librarian. Expires {when}.` and a
  **Cancel request** text button (toast `Request cancelled.`).
- With a declined request: `Your request was declined: {reason}` or
  `Your request was declined by the library.`, followed by the usual borrow,
  waitlist or unavailable controls, where **Request to borrow** reads **Request again**.
- With an expired request: `Your request expired before a librarian approved it.`,
  then the same controls with **Request again**.
- `{when}` uses the existing `dayTimeLabel`.

### 7.2 My Loans

- A **Requests** section above **Waitlist**, one row per request with the book's title:
  - Pending: `Waiting for a librarian · expires {when}` and **Cancel request**.
  - Declined: `Declined — {reason}` or `Declined by the library`.
  - Expired: `Expired — no librarian approved it in time`.
- The full-screen empty state shows only when there are no loans, no waitlist entries
  and no requests.

### 7.3 Booking a room

Rooms only; the seat flow does not change.

- The confirm step's heading is `Confirm your request`, its text
  `A librarian approves room bookings. If none does before your 15-minute grace period ends, the request expires.`,
  and its button **Send request**.
- The success step's title is `Request sent`, followed by the room and slot line and
  `We'll hold the slot until {time}. Check My Bookings for the librarian's answer.`,
  with **View My Bookings**.

### 7.4 My Bookings

- Requested: `Waiting for a librarian · held until {time}` and **Cancel** (withdraws it).
- Declined: `Declined — {reason}` or `Declined by the library`.
- Expired: `Expired — no librarian approved it in time`.

### 7.5 Re-checking while pending

While at least one request is pending and My Loans, My Bookings or a book's detail page
is showing, the app refetches that screen's data every 30 seconds. The timer stops when
nothing is pending or the screen closes, and is cancelled on dispose.

### 7.6 Models and repositories

- New `BorrowRequest` model, `BorrowRequestRepository` (HTTP and mock) and controller.
- `BookingStatus` gains `requested`, `declined` and `expired`; `ResourceBooking` gains
  `expiresAt` and `declineReason`.
- `BookingStatus`, `LoanStatus`, `ReservationStatus` and `BorrowRequestStatus` each gain
  an `unknown` value used as the decoding fallback
  (`@JsonKey(unknownEnumValue: X.unknown)`), so a status a future server sends never
  fails a whole list. A row with `unknown` shows its title and
  `Update the app to see this item's status.`, with no buttons.
- The mock repositories mirror the new behaviour; `mock_overrides.dart` gains the new
  repository.
- Fixtures are recaptured from a real server: a pending and a declined borrow request;
  a requested, a declined and an expired room booking; and the `POST /loans` 409. A
  dev admin account makes the decisions during capture. An expired borrow request is
  derived in the model test from the captured pending one, because the server only
  lets a borrow request lapse after 24 hours.

## 8. Rollout and compatibility

- Backend, web app and console are deployed together, then a new APK is released.
- On an old APK, **Borrow** shows the 409 message asking the student to update. Its
  My Bookings fails to load once it contains a room request, and its room booking
  reports an error although the request was created. Students must update.
- No new environment variables.

## 9. Testing

**Backend** (Vitest against real Postgres):

- Borrow requests: create (each 409), approve, decline (with and without reason),
  withdraw, lapse; the copy's status after each; the waitlist cascade after a decline
  and a lapse; a held waitlist claim turning into a request.
- Room requests: create as `requested`; a second student's request for the same slot
  gets 409 with alternatives; approve, decline, withdraw, lapse; the slot is free
  after decline, lapse and withdrawal; seats still book instantly.
- Two approvals at once: exactly one succeeds; the other gets `Already approved by {name}.`
- Approving after the deadline answers `This request expired.`
- `expireStaleRequests` alone, and its runs before the four read and write paths.
- The 7-day visibility window for students.
- `POST /loans` returns the 409.
- Metrics count only `booked` and `checked_in`.
- Events: each action in §5.1 publishes its event once, after commit, and a failed
  action publishes nothing.
- The stream: 401 without a token, 403 for a student, headers, the `ready` event,
  delivery of a published event, heartbeat and close after 15 minutes (fake timers),
  and unsubscribe on disconnect.

**Console** (Vitest + Testing Library, `fetch` mocked):

- Stream parsing across chunk boundaries, comments and multi-line data.
- Reconnect delays, dead-connection detection, resync on `ready` and every 5 minutes,
  and session end on 401 and 403 (fake timers).
- Requests page: every state; Approve and Decline with and without a reason; a 409
  toast; one request per double click; filter chips.
- Dashboard panel and live metric refresh; sidebar badge; tab title; live indicator;
  the new-request toast.

**Student app** (Flutter):

- Parsing every fixture, including an unknown status falling back.
- Book detail, My Loans, the room booking flow and My Bookings in each new state.
- The 30-second re-check starts only while something is pending and is disposed with
  the screen.

**Live check:** the student web app and the console in two browser windows. A student's
borrow and room requests appear in the console within 2 seconds; approving and
declining reach the student within 30 seconds; Dashboard numbers move after a seat
booking; stopping and restarting the backend shows `Reconnecting…` and then correct data.

## 10. Out of scope

- Android push notifications (slice 3).
- Bookings and Resources management (slice 4); Catalogue, Fines and the student drawer
  (slice 5).
- Approval for seats and renewals.
- A history of decided requests in the console.
- The "Needs attention" moderation queue.
- A shared event bus for several backend instances.
- A live stream in the student app; notifications to librarians outside the console.
- Limits on pending requests beyond one per title.

## 11. Actions for the project owner

1. Push the backend, frontend and admin repositories together when the build is done.
2. Release a new APK and ask testers to update.
3. Optional, for slice 3: create a Firebase project and register the Android app
   `io.github.raghav28gupta.smartlib`.
