# SmartLib Admin Console — Slice 4: Bookings and Resources

**Status:** draft for approval (2026-11-21). Slices 4 (this one), 5 (Catalogue, Fines, student
drawer) and 6 (the "Needs attention" moderation queue) are agreed in that order; each gets its own
spec, plan and live check. ML work follows slice 6.

**Repos touched:** `backend/` (schema, services, routes, events), `admin/` (two pages), `frontend/`
(one new booking state). Run scripts inside each package; commit prefixes `backend:`, `admin:`,
`frontend:`; the owner commits, never the assistant.

## 1. Intent

The console can approve requests and show metrics, but a librarian still cannot see who has booked
what, take a seat out of service, move a booking, or cancel one. This slice adds the two sections
that run the study-space side of the library: a **Bookings** page (see, cancel, reassign) and a
**Resources** page (list, add, edit, take offline and back). Students must always be able to tell
what a librarian did to their booking, and other consoles must see changes without a reload.

The design canvas (`docs/superpowers/assets/admin-console/canvas-source.dc.html`) is the visual
authority for both pages, their loading/empty/error states and their dialogs; this spec says how
they are fed and what the student app shows.

## 2. Goals, non-goals, anti-goals

**Goals**
- Bookings page and Resources page as designed in the canvas, on real data.
- Cancel and reassign a booking; add, edit, take offline and bring online a resource.
- A student sees a librarian's cancel (with its reason) or move on their own booking for 7 days.
- Every change to a booking or resource reaches open consoles through the live event bus.

**Non-goals**
- No-show detection and the "No-show" status: nothing records no-shows yet, so the filter option
  stays out of the Bookings page until the detection job exists (a later piece of the ML work).
- The student drawer: a student's name is plain text in slice 4 and becomes a link in slice 5.
- Deleting resources, changing a resource's type, editing booking times, bulk actions, CSV export.
- Cancelling a checked-in or finished booking, or reassigning one.
- Push or email notifications (students see the notice when they open My Bookings).
- Room requests: they stay on the Requests page and never appear in the Bookings list.

**Anti-goals** (failure even if the code works)
- A librarian action that leaves a student able to do something the server then refuses (for
  example, checking in to a booking the library just cancelled) without a clear message.
- A cancel or reassign that can race with a student's own action and silently win or lose.
- Any change that lowers a student's reliability score for something the library did.

## 3. Approaches considered

1. **One page at a time, top to bottom (chosen).** Resources first, then Bookings; each page is
   backend + console + student-app effect + tests + a live check before the next. Resources goes
   first because "offline" changes what students can book. Shared pieces (table, filter bar, pager,
   dialog) are extracted when Bookings needs what Resources built, not before. Matches slices 1 and
   2, and surfaces integration bugs page by page.
2. **Layer by layer** (all endpoints, then both pages, then Flutter): fewer context switches, but
   nothing runs end to end until late, and the 14 defects in the report were mostly cross-layer.
3. **Shared admin kit first**: helps slice 5, but delays anything visible and risks an abstraction
   shaped before the second page exists.

The user chose approach 1, and chose to show students a visible 7-day notice of library cancels and
moves (over a silent change or a notice with push).

## 4. Data model (one migration, e.g. `console_resources_bookings`)

- `enum ResourceStatus { available, offline }`; `Resource.status` default `available`;
  `Resource.statusNote String?` (the optional note given when taking a resource offline).
- On `ResourceBooking`: who/when/why a librarian cancelled (`cancelledById` -> User,
  `cancelledAt`, `cancelReason`), and a reassign note (`movedFromName`, `movedAt`). A student's own
  cancel leaves these null; **a booking is "library-cancelled" exactly when `cancelledById` is set.**
  Column names are the builder's call; behavior is not.
- The `no_overlapping_bookings` constraint is unchanged (`WHERE status IN ('requested','booked',
  'checked_in')`). A cancel frees the slot by leaving that set; a reassign is an UPDATE of
  `resourceId` that may raise SQLSTATE 23P01.
- The seed sets every resource `available`.

## 5. Backend

All routes sit behind the existing `/admin` guard (401 without a token, 403 for a student), with
zod validation like the existing routes. Reasons and notes are trimmed, optional, at most 300
characters; names and locations at most 100; capacity an integer from 1 to 100.

| Method and path | Purpose |
|---|---|
| `GET /admin/resources?type=seat\|room` | All resources (name order) with `status`, `statusNote`, and `upcomingBookings` (holding bookings starting from now) |
| `POST /admin/resources` | Create `{type, name, location, capacity}` (201) |
| `PATCH /admin/resources/:id` | Edit name, location, capacity. Type is locked after creation |
| `POST /admin/resources/:id/offline` | `{note?}`; already offline answers a specific 409 |
| `POST /admin/resources/:id/online` | Back to available; already available answers a specific 409 |
| `GET /admin/bookings` | `search` (student name/email or resource name), `status`, `page`, `pageSize` (default 25, max 100). Newest start time first. Returns `{bookings, total, page, pageSize}` |
| `POST /admin/bookings/:id/cancel` | `{reason?}`; frees the slot; records who and why |
| `GET /admin/bookings/:id/reassign-options` | Online resources of the same type, other than the current one, free for this booking's time |
| `POST /admin/bookings/:id/reassign` | `{resourceId}`; records the old resource's name and the time |

**Offline means "no new bookings".** `getAvailability` leaves offline resources out; `createBooking`
refuses an offline resource with a clear 409; conflict alternatives never suggest one; bookings that
already exist stay and are shown in the resource's `upcomingBookings` so the librarian knows. (The
canvas words it as "hidden from the student booking calendar".)

**Bookings list.** Excludes `requested`, `declined` and `expired` rows. Status shown is derived at
read time with the same rules the student app uses: `booked` before its grace ends -> *Booked*;
`booked` after -> *Released*; `checked_in` before its end -> *Checked in*; after -> *Completed*;
`cancelled` -> *Cancelled* (labelled library or student). The status filter works on these derived
statuses, so it cannot be a plain column match: the builder will need a time-aware query (raw SQL
for `startTime + gracePeriodMinutes` is acceptable, as the sweep already does). Search must not
scan unbounded: it is paged and indexed enough for the seed's ~900 rows and a few thousand more.

**Cancel and reassign are conditional updates**, like request decisions: `WHERE id AND status =
'booked'` and the grace period not yet over. If a student checked in, cancelled, or the booking was
released a moment earlier, the librarian gets a specific 409 ("The student already checked in",
"Already cancelled", "This booking has already been released") and the list refetches. Reassign
follows the per-resource advisory-lock convention `createBooking` already uses (to avoid deadlocks),
re-checks the target is online and free, and maps an exclusion violation to a clean 409 ("That
resource is taken at this time"). Neither action changes a reliability score.

**Student-facing DTO** (`GET /bookings/me`): new `frontendStatus` value `cancelledByLibrary`;
`cancelReason` (null if none); `movedFrom` (the old resource's name, only within 7 days of the
move). Library-cancelled bookings are listed for 7 days after `cancelledAt` (the existing
`REQUEST_OUTCOME_VISIBLE_DAYS`), then drop off like declined requests. `checkInBooking` and the
student's cancel already refuse non-`booked` rows, so a cancelled booking cannot be checked in.

**Live events.** Add topics `bookings` and `resources`. Any change to a booking row (student create,
check-in, cancel; librarian cancel or reassign; a room request's approval creating a booked slot)
publishes with topics `['bookings','metrics']`; any resource change publishes `['resources',
'metrics']`. Today those actions call `publishActivity()` (metrics only); they gain the new topic.
Events still carry no state: views refetch.

## 6. Console (Next.js)

Both pages follow the canvas: header filters, table, loading skeleton, empty ("No bookings match
these filters" / "No resources match this filter"), error with Retry, and the dialogs described
below. They use `useLiveRefresh(['bookings'], ...)` and `useLiveRefresh(['resources'], ...)`, never
polling. `apiRequest` gains `PATCH`. The sidebar enables **Bookings** and **Resources**; Catalogue
and Fines stay "Coming soon".

- **Resources:** type filter, Add resource (name, type, location, capacity), Edit (type disabled),
  "Take offline" with an optional note and a line saying how many upcoming bookings stay, "Bring
  online". An offline row shows the Offline tag and the note.
- **Bookings:** search (debounced), status select (Released, Booked, Checked in, Completed,
  Cancelled — no No-show), pager (25 per page, "x–y of N"). Row actions Cancel (optional reason,
  dialog says the slot reopens at once) and Reassign (select from the server's free options, none ->
  the dialog says so). Buttons stay disabled until the list has refetched, as on the Requests page.
- Extract the shared table, pager and dialog pieces when Bookings reuses what Resources built.

## 7. Student app (Flutter)

Add `BookingStatus.cancelledByLibrary` (the existing `unknown` fallback already protects older
installs: they show "Update the app to see this item's status."). My Bookings shows "Cancelled by
the library" or "Cancelled by the library — reason", with no action buttons; a moved booking shows
an extra line "Moved from <resource> by the library". Home's "Upcoming bookings" already lists only
live statuses, so the cancelled row never appears there. No other student screen changes; offline
resources simply stop appearing in the picker. The notice arrives when My Bookings is opened or
refetched; real notifications are a later item.

## 8. Verification

- **Backend** (Vitest, real database): every route 401/403/validation; cancel and reassign happy
  paths and every refusal; races (cancel vs student check-in, cancel vs student cancel, two
  reassigns to one target) with exactly one winner; offline blocks `createBooking`, availability and
  alternatives; list filters and paging; DTO fields; events published once after commit and none on a
  refused action. Fixed-date test pitfall: derive dates from now (the existing 2027-01-10 problem).
- **Console** (Vitest + Testing Library): each page's four states, filters, dialogs, busy/disabled
  handling, live refetch with a scripted stream.
- **Flutter:** model parsing against a captured fixture (extend `tool/capture_fixtures.dart`),
  My Bookings lines for the new state and the moved note, unknown-status fallback.
- **Live check** (all three apps, owner types the admin password): take a seat offline and see it
  vanish from the student picker within a refetch; cancel a booking with a reason and see it on My
  Bookings; reassign and see the move line; confirm a second console updates without reload; stop
  and restart the API and see the console recover. Screenshots for the report.
- **Docs:** README/CLAUDE.md updates in each package; copy this spec and its plan to `admin/docs/`
  as slice 2 did.

## 9. Constraints

Node 22, Express 5, Prisma 7 (never edit `backend/src/generated/**`), PostgreSQL with
`btree_gist`; the console keeps its token in `localStorage` and sends it only in the
`Authorization` header; times are stored in UTC and shown in the library's time zone
(`NEXT_PUBLIC_LIBRARY_TIMEZONE`). The deployed API currently lags the code (Render has not picked up
slice 2); this slice is verified locally first and does not depend on that being fixed.

## 10. Left to the builder, and calls I made

Left to the builder: migration and column names, the exact time-aware SQL for the derived status
filter, query indexes, component file layout, copy that the canvas does not give (error strings
follow the existing pattern: specific, never "Something went wrong" when the server gave a reason).

Calls I made (not stated by the owner; correct any):
- Offline blocks new bookings only; existing bookings stay and are counted for the librarian.
- Resource type is locked after creation; no resource deletion.
- Only `booked` bookings that are not yet released can be cancelled or reassigned.
- The Bookings list excludes room requests and has no "No-show" filter until detection exists.
- Library cancels and moves never touch the reliability score.
- Page size 25; newest first.
