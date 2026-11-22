# Admin Console Slice 5 (Fines, Catalogue, Student Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give librarians a Fines page (see, mark paid, waive or lower fines, with overdue books still out shown as accruing), a Catalogue page (books, barcoded copies, maintenance, lost and restore, including a copy lost on loan) and a student page (record plus manual reliability adjustment), with students seeing their fines in the app and every change reaching open consoles live.

**Architecture:** Page by page, Fines first, then Catalogue, then the student page; each page is backend, console and student-app effect plus a live checkpoint before the next. New admin services and routes sit behind the existing `/admin` guard; three new live topics (`fines`, `catalogue`, `students`) and one new event (`loan.changed`). Writes are conditional updates with specific 409s, as in slice 4.

**Tech Stack:** Node 22, Express 5, Prisma 7, PostgreSQL (`btree_gist`), Zod, Vitest + Supertest (backend); Next.js, React, Vitest + Testing Library (admin); Flutter, Riverpod 3, Dio, `json_serializable` (frontend).

**Spec:** `docs/superpowers/specs/2026-11-22-catalogue-fines-students-design.md` (read it first). The design canvas `docs/superpowers/assets/admin-console/canvas-source.dc.html` is the visual authority for the three pages, their states and dialogs (search it for `onFines`, `onCatalog`, `onStudent` and the dialog `case`s).

## Global Constraints

- Run package scripts from inside that package (`cd backend && ...`, `cd admin && ...`, `cd frontend && ...`). Run Vitest (backend and admin) and `flutter test` from PowerShell with `C:\` paths: from Git Bash the lowercase `c:` drive makes Vitest load twice and every suite fails at collection.
- **Never run `git add`, `git commit`, `git push` or any state-changing git.** Each task ends with the exact commit commands for the owner, prefixed `backend:`, `admin:` or `frontend:`, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never edit `backend/src/generated/**` (regenerate with `npx prisma generate`), `frontend/**/*.g.dart` (regenerate with `dart run build_runner build`), `build/`, `.dart_tool/`, `node_modules/`. Never read `backend/.env`. Never print or read the dev admin password file; pass it only as a file path to a script.
- Migrations: `npx prisma migrate dev --name <name> --create-only`, read the SQL, confirm it is additive and has no `DROP` of `no_overlapping_bookings` or `BorrowRequest_one_pending_per_title`, then `npx prisma migrate dev`, `node scripts/migrate-test-db.mjs`, `npx prisma generate`. Render runs `prisma migrate deploy` on live data.
- Amounts are whole rupees. The overdue rate stays `FINE_PER_DAY_INR` (₹10/day, `src/config/constants.ts`).
- Reasons: trimmed, at most 300 characters; required where this plan says so.
- Every new `/admin` route is tested for 401 without a token and 403 for a student.
- Status changes are conditional updates (`updateMany` / `UPDATE ... WHERE <current status>`); a lost race gets a specific 409 and the console refetches. Events are published after commit, once; a refused write publishes nothing.
- Lists: page size 25 by default, at most 100; search trimmed, at most 100 characters, matched with ILIKE where `%`, `_` and `\` are literal (move `escapeLike` out of `adminBookingService.ts` into `src/lib/like.ts` and share it).
- Tests derive dates from `new Date()`, never fixed calendar dates.
- Copy: user-facing strings are exactly as this plan or the canvas gives them; error strings are specific, never "Something went wrong" when the server gave a reason.
- Times are stored in UTC and shown in library time (`LIBRARY_TIMEZONE` in `admin/lib/format.ts`).
- Older student APKs must keep working: no existing student field changes meaning; new values reach them only where an unknown fallback exists, and lost loans are simply absent from `/loans/me`.
- Admin is "not the Next.js you know": read the relevant guide in `admin/node_modules/next/dist/docs/` before using a routing API (dynamic segments, `useParams`, `useSearchParams`). `npm run build` must pass after every admin task.

## Review Focus

Inputs the spec implies but its feature tests would not otherwise exercise, most likely first. Each has an owning task.

1. A student whose only record is a fine (no loans, requests or waitlist) opens My Loans: the Fines section shows instead of the "No active loans" empty state (Task 6).
2. A copy lost on loan, restored, borrowed by someone else and lost again: the restore offers to waive only the latest loss's replacement fine (Task 11).
3. A loan overdue by less than a day: one accruing row at ₹0, the same amount as the app's "Fine: ₹0 and counting"; a loan exactly at its due time is not accruing (Task 2).
4. Search text with `%`, `_`, a quote or only spaces on Fines and Catalogue: no error, no wrong rows (Tasks 2, 9).
5. Adding copies to, or restoring a copy of, a title with a waitlist: the waiting student gets the claim first (Tasks 9, 10).

---

## Page 1: Fines

### Task 1: Fine schema, fine rules and fine events (backend)

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/lib/events.ts`, `backend/src/services/loanService.ts`
- Create: migration `console_fines` (`--create-only`), `backend/src/services/fineRules.ts`, `backend/src/lib/like.ts` (move `escapeLike` here; `adminBookingService.ts` imports it)
- Test: `backend/test/lib/events.test.ts`, `backend/test/routes/loans.test.ts`, `backend/test/services/fineRules.test.ts`

**Interfaces:**
- Produces (schema): `enum FineStatus { pending paid waived adjusted }` (keep `pending` in the database; the API calls it `outstanding`); `enum FineReason { overdue no_show lost }`; on `Fine`: `originalAmount Float?` (set by the first adjustment; null means never adjusted), `adjustedAt DateTime?`, `adjustedById String?` (relation `"FineAdjuster"` to `User`, `onDelete: SetNull`), `adjustReason String?`, `paidAt DateTime?`, `paidRecordedById String?` (relation `"FinePaymentRecorder"`, `onDelete: SetNull`), `@@index([createdAt])`. Back-relations on `User`.
- Produces (`fineRules.ts`): `overdueFineAmount(dueAt: Date, at: Date): number` (whole days past due × `FINE_PER_DAY_INR`; 0 when not past due; moved from `loanService`'s `daysOverdue`/`computeFineAmount`, which now call it) and `accruingAmountSql(now: Date, dueAtColumn: Prisma.Sql): Prisma.Sql` (the same rule in SQL: `floor(extract(epoch from (now - dueAt)) / 86400) * rate`, as a bound-parameter expression).
- Produces (events): `LiveTopic` gains `'fines' | 'catalogue' | 'students'`; `LiveEventType` gains `'fine.changed' | 'catalogue.changed' | 'student.changed' | 'loan.changed'`; `publishFineChange()` publishes `{ type: 'fine.changed', topics: ['fines'] }`; `publishCatalogueChange(extra: LiveTopic[] = [])` publishes `{ type: 'catalogue.changed', topics: ['catalogue', ...extra] }`; `publishStudentChange()` publishes `{ type: 'student.changed', topics: ['students'] }`; `publishLoanChange(pastDue: boolean)` publishes `{ type: 'loan.changed', topics: pastDue ? ['metrics', 'catalogue', 'fines'] : ['metrics', 'catalogue'] }`.
- Produces (behavior): `returnLoan` replaces `publishActivity()` with `publishLoanChange(wasPastDue)`; `renewLoan` keeps `publishActivity()` and adds `publishFineChange()` when the loan was past due.

- [ ] **Step 1: Write failing tests.** `events.test.ts`: one test per new helper asserting type and topics (use `recordEvents()`). `fineRules.test.ts`: `0 before and exactly at the due time`, `0 for 23h59m late`, `10 for exactly one day late`, `30 for 3 days and 5 hours late`, `accruingAmountSql agrees with overdueFineAmount` (select it against a few `dueAt` values with `$queryRaw` and compare). `loans.test.ts`: `returning an on-time loan publishes loan.changed on metrics and catalogue`, `returning a past-due loan publishes loan.changed with fines too and writes the fine`, `renewing a past-due loan publishes fine.changed`.
- [ ] **Step 2: Run** `npx vitest run test/lib/events.test.ts test/services/fineRules.test.ts test/routes/loans.test.ts`; confirm the new tests fail for the stated reasons.
- [ ] **Step 3: Edit the schema, create and review the migration (enum `ADD VALUE`s, nullable columns, foreign keys with `ON DELETE SET NULL`, the index), apply it to dev and the test database, regenerate the client.**
- [ ] **Step 4: Implement `fineRules.ts`, `lib/like.ts`, the event helpers and the two publisher changes.**
- [ ] **Step 5: Run the three files, then `npm test` and `npm run typecheck`.** Fix any existing assertion that expected `activity` from a return.
- [ ] **Step 6: Report the commit commands** (`git add prisma src test` / `backend: add fine adjustment and payment columns, fine rules and fine, catalogue and student live topics`).

### Task 2: Admin fines list with accruing rows (backend)

**Files:**
- Create: `backend/src/services/adminFineService.ts`, `backend/src/schemas/adminFines.ts`
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminFines.test.ts`

**Interfaces:**
- Consumes: `accruingAmountSql`, `escapeLike` (Task 1).
- Produces:
  ```ts
  type AdminFineStatus = 'accruing' | 'outstanding' | 'adjusted' | 'paid' | 'waived'
  interface AdminFineDto {
    id: string                 // the fine's id; for an accruing row, the loan's id
    kind: 'fine' | 'accruing'
    student: { id: string; name: string; email: string }
    reason: 'overdue' | 'no_show' | 'lost'
    item: string               // book title (overdue, lost) or resource name (no_show)
    amount: number
    originalAmount: number     // originalAmount ?? amount
    status: AdminFineStatus
    date: Date                 // createdAt; an accruing row's due date
    note: string | null        // adjustReason, for adjusted and waived fines
    recordedBy: string | null  // adjuster's name (adjusted, waived) or payment recorder's (paid); null when none or removed
    canSettle: boolean         // status is outstanding or adjusted
  }
  type AdminFineListQuery = { search?: string; status?: AdminFineStatus; page: number; pageSize: number }
  listFines(q: AdminFineListQuery, now?: Date): Promise<{ fines: AdminFineDto[]; total: number; page: number; pageSize: number }>
  listFinesForStudent(userId: string, limit: number, now?: Date): Promise<AdminFineDto[]>   // for Task 16
  ```
  Route `GET /admin/fines?search=&status=&page=&pageSize=`. One `$queryRaw`: a `UNION ALL` of stored fines (status `pending` shown as `outstanding`) and accruing rows (loans with `status = 'active'` and `dueAt < now`, reason `overdue`, amount from `accruingAmountSql`), joined to student, book (through copy) or resource; filtered by derived status, search (student name or email) and, for `listFinesForStudent`, user; ordered by `date` descending then `id`; `count(*) OVER()` for the total. Same shape as `adminBookingService.filteredBookings`.

- [ ] **Step 1: Write failing tests** (seed users, books, copies, loans and fines with Prisma): `is for admins only`; `lists stored fines with student, reason, item and amount`; `a pending fine is outstanding`; `an overdue loan still out is an accruing row whose amount equals that loan's fineAmount on /loans/me`; `a loan overdue by under a day is accruing at ₹0`; `a loan exactly at its due time is not listed`; `a returned loan is not accruing`; `the status filter works for each status, including accruing`; `search matches student name and email, ignoring case`; `search treats % and _ literally` and `a quote is safe`; `a search of only spaces is ignored`; `pages, and a page past the end returns no rows with the right total`; `pageSize 101 is 400`; `newest first, with accruing rows ordered by due date`; `a no-show fine names its resource`; `an adjusted fine shows originalAmount, note and the librarian's name`; `canSettle only for outstanding and adjusted`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminFines.test.ts`; expect failures.
- [ ] **Step 3: Implement the schema (`status` enum of the five values, search max 100, page and pageSize as in `adminBookings.ts`), the service and the route.** Fetch student, item and librarian names in the same query, never per row.
- [ ] **Step 4: Run the file, `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add the admin fines list with accruing overdue loans`).

### Task 3: Mark paid, waive or adjust, and the student's fines (backend)

**Files:**
- Modify: `backend/src/services/adminFineService.ts`, `backend/src/schemas/adminFines.ts`, `backend/src/routes/admin.ts`, `backend/src/app.ts`
- Create: `backend/src/services/fineService.ts`, `backend/src/routes/fines.ts`
- Test: `backend/test/routes/adminFines.test.ts` (extend), `backend/test/routes/fines.test.ts`, `backend/test/services/fineRaces.test.ts`

**Interfaces:**
- Consumes: `publishFineChange()` (Task 1); `AdminFineDto` and the list SQL (Task 2, with an `id` filter for re-reading one row).
- Produces:
  ```ts
  markFinePaid(fineId: string, adminId: string, now?: Date): Promise<AdminFineDto>
  adjustFine(fineId: string, adminId: string, amount: number, reason: string, now?: Date): Promise<AdminFineDto>
  interface StudentFineDto { id: string; reason: 'overdue' | 'no_show' | 'lost'; item: string; amount: number; originalAmount: number;
    status: 'outstanding' | 'adjusted' | 'paid' | 'waived'; date: Date; note: string | null }
  listMyFines(userId: string): Promise<{ fines: StudentFineDto[]; outstandingTotal: number }>
  ```
  Routes: `POST /admin/fines/:id/paid` (no body); `POST /admin/fines/:id/adjust` body `{ amount: integer >= 0, reason: string trimmed 1..300 }`; `GET /fines/me` (student auth, `requireAuth`).
- Rules: paid applies only to `pending` or `adjusted` (sets `paid`, `paidAt`, `paidRecordedById`). Adjust is one `UPDATE "Fine" SET "originalAmount" = COALESCE("originalAmount", amount), amount = $new, status = ($new = 0 ? 'waived' : 'adjusted'), "adjustedAt", "adjustedById", "adjustReason" WHERE id = $id AND status IN ('pending','adjusted') AND amount > $new`. When nothing was updated, re-read and answer: unknown id 404 `Fine not found`; paid 409 `"This fine is already paid."`; waived 409 `"This fine was waived."`; otherwise 400 `"The new amount must be lower than ₹<current>."`. An accruing row's loan id is not a fine id (404). `listMyFines`: newest 50, `outstandingTotal` = sum of `pending` and `adjusted` amounts over all the student's fines; accruing amounts are not included.

- [ ] **Step 1: Write failing tests.** `adminFines.test.ts`: `401/403 on both routes`; `marks an outstanding fine paid and records who and when`; `marks an adjusted fine paid`; `paying a paid fine is 409 "This fine is already paid."`; `paying a waived fine is 409 "This fine was waived."`; `adjust to a lower amount sets adjusted, keeps originalAmount, note and librarian`; `adjust to 0 waives`; `a second adjust keeps the first originalAmount`; `adjust to the same or a higher amount is 400 "The new amount must be lower than ₹150."`; `adjust without a reason, with a blank reason, a 301-character reason, a negative or a fractional amount is 400`; `an accruing row's id answers 404`; `each success publishes fine.changed once, refusals publish nothing`. `fines.test.ts`: `401 without a token`; `lists only my fines, newest first, with item, reason, status and note`; `outstandingTotal counts outstanding and adjusted, not paid or waived`; `caps the list at 50 but totals all`. `fineRaces.test.ts`: `paid and adjust at once: exactly one wins and the loser gets a specific message`; `two adjusts at once: one wins, the fine is never raised` (run with `Promise.all`, several times).
- [ ] **Step 2: Run the three files;** expect failures.
- [ ] **Step 3: Implement the service functions, schemas, both routes (`finesRouter` registered in `app.ts` before `adminRouter`).**
- [ ] **Step 4: Run the three files three times, then `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: let librarians mark fines paid or waive and adjust them, and list a student's fines`).

### Task 4: Fines page: list, filters, paging (admin)

**Files:**
- Create: `admin/lib/fines.ts`, `admin/app/(console)/fines/page.tsx`, `admin/components/fines/FinesTable.tsx`, `admin/components/fines/FinesStates.tsx`, `admin/components/Pager.tsx` (moved from `components/bookings/Pager.tsx`; Bookings imports it from here)
- Modify: `admin/lib/live.ts` (topics and event types mirror Task 1), `admin/lib/format.ts` (`rupees`, `pageRange`), `admin/lib/bookings.ts` (`bookingsRange` delegates to `pageRange`), `admin/components/Sidebar.tsx` (Fines `href: '/fines'`), `admin/app/(console)/layout.tsx` (`'/fines': 'Fines'`)
- Test: `admin/test/app/fines.test.tsx`, `admin/test/lib/fines.test.ts`, `admin/test/lib/format.test.ts`, `admin/test/components/Sidebar.test.tsx`, existing `test/app/bookings.test.tsx` (must stay green)

**Interfaces:**
- Produces (`lib/format.ts`): `rupees(amount: number): string` (`₹150`); `pageRange(page: number, pageSize: number, total: number, noun: [singular: string, plural: string]): string` (`"1–25 of 60 fines"`, `"1 of 1 fine"`, `"0 fines"`).
- Produces (`lib/fines.ts`): `AdminFine` (Task 2's DTO with `date: string`), `FineStatus`, `FINES_PAGE_SIZE = 25`, `FINE_STATUS_FILTERS` = All statuses, Accruing, Outstanding, Adjusted, Paid, Waived (no Disputed), `fetchFines(q: { search: string; status: FineStatus | 'all'; page: number }): Promise<FinesPage>`.
- The page follows the canvas's Fines section: student search (300 ms debounce), status select, `pageRange` label, table Student / Reason / Item / Amount / Status / Date / actions, pager, loading skeleton, "No fines match these filters" with **Clear filters**, "Couldn't load fines" with **Retry**. Reason labels Overdue, No-show, Lost book. Status tags: Accruing and Outstanding `tag-accent`; Adjusted, Paid, Waived `tag-accent-2`. An adjusted or waived row shows `₹50 (was ₹150)` and, under the tag, "<note> — <recordedBy>" as muted text (`recordedBy` null reads "the library"). Student names are plain text until Task 18. `useLoader` + `useLiveRefresh(['fines'], ...)`; a filter change returns to page 1.

- [ ] **Step 1: Write failing tests** (`mockFetch` from `test/helpers.ts`): `shows the skeleton, then rows with reason labels, amounts and status tags`; `an adjusted row shows "₹50 (was ₹150)", its note and who recorded it, or "the library"`; `search waits 300 ms and sends one request`; `the status select offers no Disputed option`; `changing the status returns to page 1`; `the pager moves and disables at the ends`; `no match shows Clear filters, which resets both filters`; `error state and Retry`; `a live fines event refetches quietly`; `a quiet refetch that fails keeps the rows`; `Sidebar: Fines is a link, Catalogue still Coming soon`; format tests for `rupees` and `pageRange`; `fetchFines` URL carries `search`, `status`, `page`, `pageSize=25` and omits blanks.
- [ ] **Step 2: Run** `npx vitest run test/app/fines.test.tsx test/lib/fines.test.ts test/lib/format.test.ts test/components/Sidebar.test.tsx`; expect failures.
- [ ] **Step 3: Implement, reusing `StateBlocks`, `useLoader`, the moved `Pager`.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: add the Fines page`).

### Task 5: Fines page: mark paid, waive and adjust (admin)

**Files:**
- Create: `admin/components/fines/MarkPaidDialog.tsx`, `admin/components/fines/AdjustFineDialog.tsx`, `admin/components/fines/useFineActions.ts`
- Modify: `admin/lib/fines.ts`, `admin/components/fines/FinesTable.tsx`, `admin/app/(console)/fines/page.tsx`
- Test: `admin/test/app/fines.test.tsx` (extend)

**Interfaces:**
- Consumes: `Dialog`, `useWriteAction`, Task 3's routes.
- Produces (`lib/fines.ts`): `markFinePaid(id: string): Promise<unknown>`, `adjustFine(id: string, amount: number, reason: string): Promise<unknown>` (reason trimmed).
- Row actions only where `canSettle`: **Mark paid** and **Waive / adjust**.
- Mark paid dialog: title "Mark this fine as paid?", body "<student> — <item>, ₹<amount>. Record this once the student has paid at the desk.", confirm "Mark paid"; success toast "Fine marked as paid."
- Waive / adjust dialog (canvas): title "Waive or adjust this fine", body "<student> — <item>, currently ₹<amount>. Enter the new amount (₹0 fully waives it) and a reason; this is recorded on the student's fine history.", fields "New amount (₹)" (number, starts at the current amount) and "Reason (required)" (placeholder "Why is this fine being waived or adjusted?", max 300), confirm "Save", disabled until the reason is non-blank and the amount is a whole number from 0 to below the current amount; success toast "Fine waived." for 0, else "Fine adjusted."

- [ ] **Step 1: Write failing tests:** `actions show only on outstanding and adjusted rows`; `Mark paid posts and toasts, then refetches`; `Save stays disabled with a blank reason, an equal or higher amount, or a fraction`; `adjusting to 0 sends amount 0 and toasts "Fine waived."`; `adjusting lower toasts "Fine adjusted."`; `a 409 shows the server's message and refetches`; `buttons stay disabled until the refetch returns`; `a second click while in flight sends nothing`; `Escape closes either dialog and returns focus`.
- [ ] **Step 2: Run** `npx vitest run test/app/fines.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: mark fines paid and waive or adjust them`).

### Task 6: Fines in the student app, and My Loans refreshing on open (frontend)

**Files:**
- Create: `frontend/lib/models/fine.dart` (+ generated `fine.g.dart`), `frontend/lib/features/fines/fine_repository.dart`, `frontend/lib/features/fines/fines_controller.dart`, `frontend/lib/features/fines/fines_section.dart`, fixtures `frontend/test/fixtures/fines_me.json`, `fines_me_adjusted.json`, `fines_me_paid.json` (captured)
- Modify: `frontend/lib/features/loans/loans_screen.dart`, `frontend/lib/features/loans/loans_controller.dart`, `frontend/test/support/mock_overrides.dart` (`fines:` parameter), `frontend/tool/capture_fixtures.dart`, `frontend/README.md`, `frontend/CLAUDE.md`
- Test: `frontend/test/models/fine_json_test.dart`, `frontend/test/features/fines/http_fine_repository_test.dart`, `frontend/test/features/fines/fines_controller_test.dart`, `frontend/test/features/loans/loans_screen_test.dart` (extend)

**Interfaces:**
- Consumes: `GET /fines/me` (Task 3).
- Produces:
  ```dart
  enum FineStatus { outstanding, adjusted, paid, waived, unknown }     // unknownEnumValue: unknown
  enum FineReason { overdue, noShow /* 'no_show' */, lost, unknown }
  class Fine { String id; FineReason reason; String item; double amount; double originalAmount; FineStatus status;
    DateTime date /* localDateTime */; String? note; bool get wasAdjusted => originalAmount != amount; }
  class FinesSummary { List<Fine> fines; double outstandingTotal; }
  abstract class FineRepository { Future<FinesSummary> myFines(); }   // HttpFineRepository, MockFineRepository
  final fineRepositoryProvider; final finesControllerProvider   // AsyncNotifier<FinesSummary>, keyed on the user id
  FinesController.refreshQuietly()   // joins a fetch in flight, keeps data on failure
  ```
  `LoansController.refreshQuietly()` also joins a fetch in flight (`_refreshing ??= ...`, as `BookingsController`).
- **Fines section** at the bottom of My Loans' list: heading "Fines"; "Outstanding: ₹X" when the total is above 0; one card per fine with the item, the reason label (Overdue, No-show, Lost book), the amount (`₹50, was ₹150` when adjusted), the status (Outstanding, Adjusted, Paid, Waived), the date, and "Library note: <note>" when there is one; an unknown status shows "Update the app to see this item's status."; empty: "No fines." Whole rupees, no decimals. A student with fines but no loans, requests or waitlist sees the Fines section, not the "No active loans" empty state.
- **Refresh on open:** `LoansScreen` makes one `refreshQuietly()` on loans and fines after its first frame, skipped while either is still loading (same as `BookingsScreen._refreshOnOpen`).

- [ ] **Step 1: Extend `capture_fixtures.dart`:** after the existing steps, return the demo student's overdue loan (b4, ₹30), save `GET /fines/me` as `fines_me`; as admin adjust that fine to 20 with reason `Returned during exam week`, save as `fines_me_adjusted`; mark it paid, save as `fines_me_paid`. Do not run it yet.
- [ ] **Step 2: Write failing tests:** model: `parses an outstanding fine`, `parses the adjusted fine with its note and original amount`, `parses paid`, `an unknown status maps to unknown`, `no_show maps to noShow and lost to lost` (edit a copy of the fixture map for statuses and reasons not captured); repository: `GET /fines/me parses the summary`, `401 maps to UnauthorizedException`; controller: `refreshQuietly keeps the data on a network error`, `refreshQuietly joins a fetch in flight`; screen: `shows the Fines section with the outstanding total`, `shows "₹20, was ₹30" and the library note`, `shows "No fines." when there are none`, `a student with only fines sees the section, not the empty state`, `an unknown status shows the update notice`, `opening My Loans refetches loans and fines once`.
- [ ] **Step 3: Run** `flutter test test/models/fine_json_test.dart test/features/fines test/features/loans`; confirm the new tests fail.
- [ ] **Step 4: Capture the fixtures** against a freshly seeded local backend (Tasks 1–3 applied), admin password only through `SMARTLIB_ADMIN_PASSWORD_FILE`, re-seed afterwards; then implement the model (`build_runner`), repository, controller, section and screen changes.
- [ ] **Step 5: Run `flutter test` (all) and `flutter analyze`.**
- [ ] **Step 6: Docs:** README Known-limitations line (fines and their changes show when My Loans is opened; no push yet); CLAUDE.md: My Loans now refreshes on open like My Bookings, and the Fines section's unknown fallback.
- [ ] **Step 7: Report the commit commands** (`frontend: show students their fines and refresh My Loans when opened`).

### Task 7: Fines checkpoint (live)

**Files:** none (verification only; scratch files in the session scratchpad).

- [ ] **Step 1: Re-seed, create a throwaway dev admin (`npm run create-admin`) whose password goes only to a scratchpad file, start the backend, the console (:3001) and the student web app.** Follow the live-check procedure in `docs/superpowers/reports/2026-11-21-bookings-resources-rulings-and-deferred.md`.
- [ ] **Step 2: API smoke** (a scratch script reading the password file): the demo student's overdue loan appears as an accruing row with the same amount as `/loans/me`; return it as the student and the row becomes an outstanding fine; mark one fine paid, adjust another, waive a third (create them by renewing or returning seeded past-due loans if needed); a second paid on the same fine gets the 409; `GET /fines/me` shows the note and total; every write produced one event on `GET /admin/events`. Compare every response's keys with the TypeScript and Dart models (the static contract check from slice 4).
- [ ] **Step 3: Browser check if the browser can take screenshots:** the Fines page's filters, dialogs and live update in a second tab; the student app's Fines section after reopening My Loans. If screenshots time out, stop after two attempts and record that the browser part was not done.
- [ ] **Step 4: Stop only the processes you started (verify command lines first), delete the password file and scripts, re-seed, record the result in the ledger.** Report that nothing needs committing; anything found becomes a fix task before Task 8.

---

## Page 2: Catalogue

### Task 8: Barcodes, lost loans in the schema, and copy totals (backend)

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/services/bookService.ts`, `backend/src/services/adminRequestService.ts` (book totals)
- Create: migration `console_catalogue` (`--create-only`, then hand-edit the SQL as below)
- Test: `backend/test/routes/books.test.ts`, `backend/test/services/barcodes.test.ts`

**Interfaces:**
- Produces (schema): `BookCopy.barcode String @unique @default(dbgenerated("next_copy_barcode()"))`; `enum LoanStatus { active returned overdue lost }`; `Loan.lostAt DateTime?`.
- Migration SQL (hand-written into the draft): create sequence `"BookCopy_barcode_seq"`; create function `next_copy_barcode() RETURNS text` returning `'SL-' || lpad(n::text, 5, '0')` for `n < 100000`, else `'SL-' || n::text`, with `n = nextval('"BookCopy_barcode_seq"')`; add the nullable column; backfill existing copies with a `WITH ordered AS (SELECT c.id, row_number() OVER (ORDER BY b.title, c.id) AS n ...)` update (not `nextval` inside an `UPDATE ... FROM`, whose order is not guaranteed); `setval` the sequence past the highest number (or leave it at its start when there are no copies); set `NOT NULL`, the default and the unique index; `ALTER SEQUENCE ... OWNED BY "BookCopy"."barcode"` (so the tests' `TRUNCATE ... RESTART IDENTITY` resets it).
- Produces (behavior): `BookDto.totalCopies` and the Requests page's book total are the count of the book's copies whose status is not `lost`, computed in the existing `groupBy` batch; the `Book.totalCopies` column is no longer read (leave it; the seed still sets it).

- [ ] **Step 1: Write failing tests:** `barcodes.test.ts`: `a new copy gets SL-00001, the next SL-00002`, `barcodes are unique`; `books.test.ts`: `totalCopies counts copies that are not lost`, `a copy in maintenance counts toward the total but not as available`.
- [ ] **Step 2: Run both files;** expect failures.
- [ ] **Step 3: Write and review the migration, apply it to dev, then check the dev database: `SELECT count(*) FROM "BookCopy" WHERE barcode IS NULL` is 0, barcodes are distinct, and ordering by barcode follows book title.** Apply to the test database, regenerate the client.
- [ ] **Step 4: Implement the computed totals.**
- [ ] **Step 5: Run both files, `npm test`, `npm run typecheck`.**
- [ ] **Step 6: Report the commit commands** (`backend: give every copy a barcode, add lost loans, and count totals from copies`).

### Task 9: Admin books: list, add, edit, add copies (backend)

**Files:**
- Create: `backend/src/services/adminCatalogueService.ts`, `backend/src/schemas/adminCatalogue.ts`
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminCatalogue.test.ts`

**Interfaces:**
- Consumes: `publishCatalogueChange()` (Task 1), `escapeLike`, `onBookReturned` (`reservationService`).
- Produces:
  ```ts
  type AdminCopyStatus = 'available' | 'on_loan' | 'held' | 'maintenance' | 'lost'
  interface AdminCopyDto { id: string; barcode: string; status: AdminCopyStatus;
    borrower: { id: string; name: string } | null; dueAt: Date | null;          // the open loan, if any
    owedReplacement: { fineId: string; amount: number; student: { id: string; name: string } } | null }   // Task 11 fills it
  interface AdminBookDto { id: string; isbn: string; title: string; author: string; genre: string | null; description: string | null;
    publishedYear: number | null; totalCopies: number; availableCopies: number; copies: AdminCopyDto[] }   // copies in barcode order
  listBooks(q: { search?: string; page: number; pageSize: number }): Promise<{ books: AdminBookDto[]; total: number; page: number; pageSize: number; genres: string[] }>
  getAdminBook(id: string): Promise<AdminBookDto>
  createBook(input: BookInput & { copies: number }): Promise<AdminBookDto>
  updateBook(id: string, input: Partial<BookInput>): Promise<AdminBookDto>
  addCopies(bookId: string, count: number): Promise<AdminBookDto>
  type BookInput = { isbn: string; title: string; author: string; genre: string; description?: string | null; publishedYear?: number | null }
  ```
  Routes: `GET /admin/books?search=&page=&pageSize=`, `POST /admin/books` (201), `PATCH /admin/books/:id`, `POST /admin/books/:id/copies` body `{ count }`. Copy status mapping: `borrowed` → `on_loan`, `requested` → `held`. Search matches title, author, ISBN or any copy's barcode; title order; `genres` is every distinct non-null genre, sorted. Validation: ISBN trimmed 1–20, title and author trimmed 1–200, genre trimmed 1–50 (required on create; on edit it may not be blanked), description at most 2000 (`null` clears), publishedYear integer 1450 to the current year (`null` clears), copies and count integers 1–20; PATCH needs at least one field. Duplicate ISBN (create or edit) → 409 `"A book with this ISBN is already in the catalogue."` (catch Prisma `P2002` as well as pre-checking). Unknown id → 404 `Book not found`. Adding copies runs `onBookReturned(bookId)` after commit so a waitlisted student gets a claim.

- [ ] **Step 1: Write failing tests:** `is for admins only` (all four routes); `lists books in title order with copies, barcodes, statuses, borrower and due date`; `a requested copy is held and a borrowed copy without a loan is on loan with no borrower`; `search by title, author, ISBN and barcode`; `search treats % and _ literally`, `a quote is safe`, `only spaces is ignored`; `pages`; `genres lists each genre once, sorted`; `creates a book with three copies and barcodes` (201); `rejects a missing ISBN, a 21-character ISBN, a blank title, a missing genre on create, year 1449 and next year, 0 and 21 copies`; `a duplicate ISBN is 409 with the message, on create and on edit`; `edits fields and clears description and year with null`; `PATCH with no fields is 400`; `adds copies and the student-visible total grows`; `adding a copy to a waitlisted title gives the first waiting student a claim`; `unknown id is 404`; `each write publishes catalogue.changed once, refusals publish nothing`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminCatalogue.test.ts`; expect failures.
- [ ] **Step 3: Implement.** Batch copy, loan and fine lookups per page; no per-book queries.
- [ ] **Step 4: Run the file, `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add admin book list, add, edit and add copies`).

### Task 10: Copy actions: maintenance, lost from the shelf, restore (backend)

**Files:**
- Create: `backend/src/services/adminCopyService.ts`
- Modify: `backend/src/schemas/adminCatalogue.ts`, `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminCopies.test.ts`

**Interfaces:**
- Consumes: `getAdminBook` (Task 9), `publishCatalogueChange()`, `onBookReturned`.
- Produces:
  ```ts
  markCopyMaintenance(copyId: string, now?: Date): Promise<AdminBookDto>
  markCopyLost(copyId: string, replacementCharge: number | undefined, now?: Date): Promise<AdminBookDto>   // on-loan branch in Task 11
  restoreCopy(copyId: string, adminId: string, waiveReplacementCharge: boolean, now?: Date): Promise<{ book: AdminBookDto; replacementWaived: boolean }>   // waive branch in Task 11
  ```
  Routes: `POST /admin/copies/:id/maintenance`, `POST /admin/copies/:id/lost` body `{ replacementCharge?: integer 0..10000 }` (default `{}`), `POST /admin/copies/:id/restore` body `{ waiveReplacementCharge?: boolean }` (default `{}`).
- Rules (each a conditional update on the current status inside a transaction; 404 `Copy not found` for an unknown id):
  - Maintenance from `available` only. From `borrowed` 409 `"This copy is now on loan."`; from `maintenance` 409 `"This copy is already in maintenance."`; from `lost` 409 `"This copy is already lost."`; from `requested` 409 `"This copy is held for a borrow request."`
  - Lost from `available` or `maintenance` (from `lost` 409 `"This copy is already lost."`; from `requested` the held message). A `borrowed` copy with no open loan is marked lost with no fines. A `borrowed` copy with an open loan is Task 11 (until then, 409 `"This copy is now on loan."`).
  - Taking an `available` copy to maintenance or lost first expires stale claims (the existing claim rebalance), then refuses with 409 `"This copy is set aside for a student on the waitlist."` when the remaining available copies would be fewer than the book's live claims (`fulfilled` with `claimExpiresAt > now`).
  - Restore from `maintenance` or `lost` to `available`, then `onBookReturned(bookId)` after commit; from `available` 409 `"This copy is already available."`; from `borrowed` 409 `"This copy is on loan."`; from `requested` the held message.
  - Each success publishes `catalogue.changed` once.

- [ ] **Step 1: Write failing tests:** one test per transition and per refusal message above; `401/403 on all three routes`; `maintenance on the copy a live claim needs is refused with the waitlist message, and allowed when another copy is free`; `a stale claim does not block`; `restoring a copy of a waitlisted title gives the first waiting student a claim`; `the student-visible available and total counts after maintenance, lost and restore` (via `GET /books/:id`); `a borrowed copy with no loan can be marked lost`; `two librarians marking one copy at once: one wins, the other gets the specific 409`; `events: once per success, none on refusals`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminCopies.test.ts`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file twice, `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add copy maintenance, lost and restore`).

### Task 11: Lost while on loan, and restore with the replacement waived (backend)

**Files:**
- Modify: `backend/src/services/adminCopyService.ts`, `backend/src/services/adminCatalogueService.ts` (`owedReplacement`), `backend/src/services/loanService.ts`, `backend/src/services/adminMetrics.ts`, `backend/src/services/adminMetricsService.ts`
- Test: `backend/test/routes/adminCopies.test.ts` (extend), `backend/test/routes/loans.test.ts`, `backend/test/services/adminMetrics.test.ts`, `backend/test/services/lostLoanRaces.test.ts`

**Interfaces:**
- Consumes: `overdueFineAmount` (Task 1), Task 10's functions, `publishCatalogueChange(['fines', 'metrics'])`.
- Produces (behavior):
  - `markCopyLost` on a `borrowed` copy with an open loan requires `replacementCharge` (missing → 400 `"Enter a replacement charge for the copy on loan."`). One transaction: `loan.updateMany({ where: { id, status: 'active' }, data: { status: 'lost', lostAt: now } })` (0 rows → re-read and answer the specific 409, e.g. `"This copy is no longer on loan."`), copy `borrowed` → `lost`, an `overdue` fine of `overdueFineAmount(dueAt, now)` when above 0, a `lost` fine of `replacementCharge` when above 0, both owned by the borrower and related to the loan. Publishes `catalogue.changed` with topics `catalogue`, `fines`, `metrics`.
  - `restoreCopy` with `waiveReplacementCharge: true` on a copy whose **latest** lost loan has a `lost` fine still `pending` or `adjusted`: in the same transaction, waive it (`status: 'waived'`, `originalAmount` kept as in Task 3, `amount: 0`, `adjustedAt`, `adjustedById`, `adjustReason: 'Book returned after it was marked lost'`), conditional on its status. If the fine changed underneath, the restore still commits and `replacementWaived` is false. Topics `catalogue` and `fines` when waived.
  - `AdminCopyDto.owedReplacement` is set on a `lost` copy whose latest lost loan's `lost` fine is still owed.
  - Student side: `listMyLoans` leaves out `lost` loans. `returnLoan` and `renewLoan` refuse a lost loan with 409 `"This loan was closed because the copy was marked lost."`, and become race-safe: the loan update is conditional on `status: 'active'`, and the overdue fine is written in the same transaction only when that update won.
  - Metrics: `LoanRow` gains `lostAt`; a lost loan stops counting as overdue from `lostAt` (treat it like `returnedAt` in `overdueAt`) and is never counted as a return in circulation.

- [ ] **Step 1: Write failing tests:** `losing an on-loan copy closes the loan, writes an overdue fine and a lost fine, and marks the copy lost`; `a replacement charge of 0 writes no lost fine`; `an on-time loan writes no overdue fine`; `a missing replacement charge is 400 with the message`; `the lost loan leaves /loans/me and its fines appear on /fines/me`; `returning or renewing a lost loan is 409 with the message`; `owedReplacement is set on the lost copy and cleared once the fine is paid`; `restore with waive waives the owed replacement fine and records the reason`; `restore without waive leaves it owed`; `restore with waive when the fine was paid restores the copy and answers replacementWaived false`; `a copy lost, restored, lent to another student and lost again offers only the second fine`; `events carry catalogue, fines and metrics for a loss on loan, catalogue and fines for a waived restore`; metrics: `a lost loan is not overdue after lostAt but was overdue before it`, `a lost loan is not a return`. `lostLoanRaces.test.ts`: `lost and student return at once: exactly one wins, never both fines and a return`; `lost and student renew at once: exactly one wins` (several runs).
- [ ] **Step 2: Run the four files;** expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the four files three times, `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: close loans whose copy is lost with an overdue and a replacement fine, and waive it on restore`).

### Task 12: Catalogue page: list and book forms (admin)

**Files:**
- Create: `admin/lib/catalogue.ts`, `admin/app/(console)/catalogue/page.tsx`, `admin/components/catalogue/BookCard.tsx`, `admin/components/catalogue/CopyChip.tsx`, `admin/components/catalogue/CatalogueStates.tsx`, `admin/components/catalogue/BookFormDialog.tsx`, `admin/components/catalogue/AddCopiesDialog.tsx`, `admin/components/catalogue/useCatalogueActions.ts`
- Modify: `admin/components/Sidebar.tsx` (Catalogue `href: '/catalogue'`; no section is Coming soon any more), `admin/app/(console)/layout.tsx` (`'/catalogue': 'Catalogue'`), `admin/test/components/Sidebar.test.tsx`
- Test: `admin/test/app/catalogue.test.tsx`, `admin/test/lib/catalogue.test.ts`

**Interfaces:**
- Produces (`lib/catalogue.ts`): `AdminBook`, `AdminCopy`, `CopyStatus` (Task 9's DTOs, dates as strings), `CATALOGUE_PAGE_SIZE = 25`, `fetchBooks(q: { search: string; page: number }): Promise<BooksPage>` (`BooksPage` includes `genres`), `createBook(input: BookForm & { copies: number })`, `updateBook(id: string, input: BookForm)`, `addCopies(id: string, count: number)` where `BookForm = { isbn: string; title: string; author: string; genre: string; description: string; publishedYear: string }` (blank description and year send `null`).
- The page follows the canvas's Catalogue section: search (placeholder "Search title, author, ISBN or barcode", 300 ms debounce), `pageRange` label ("titles"), **Add book**, one card per book (title, author, genre tag, "n of m available", **Edit**, **+ Copies**), a chip per copy (barcode, status tag: Available `tag-accent-2`, On loan `tag-neutral`, Held `tag-neutral`, Maintenance and Lost `tag-accent`; an on-loan chip also shows "<borrower> · due <date>"), pager, loading skeleton, "No books match your search" with **Clear search**, "Couldn't load the catalogue" with **Retry**. Chip actions come in Task 13. `useLiveRefresh(['catalogue', 'requests'], ...)`.
- Book dialog: title "Add a book" (body "New title added to the catalogue with its copies.", confirm "Add book") or "Edit book details" (confirm "Save changes"); fields ISBN, Title, Author, Genre (text input with a `<datalist>` of `genres`), Description, Published year, and on Add "Copies" (1–20, default 1); confirm disabled until ISBN, title, author and genre are non-blank. Add copies dialog: title "Add copies of <title>", field "Copies" (1–20), confirm "Add copies". Toasts: "Book added.", "Book updated.", "1 copy added." / "<n> copies added."

- [ ] **Step 1: Write failing tests:** `shows the skeleton then book cards with copy chips and availability`; `an on-loan chip names the borrower and due date`; `search waits 300 ms`; `no match shows Clear search`; `error state and Retry`; `pager`; `Add book posts the form with copies and the list refetches`; `Add book is disabled until the required fields are filled`; `genre suggestions come from the server's genres`; `Edit pre-fills and sends PATCH, blank year sends null`; `a 409 duplicate ISBN shows the server's message`; `+ Copies posts the count and toasts "2 copies added."`; `a live catalogue event refetches quietly`; `Sidebar: every section is a link, none says Coming soon`.
- [ ] **Step 2: Run** `npx vitest run test/app/catalogue.test.tsx test/lib/catalogue.test.ts test/components/Sidebar.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: add the Catalogue page with book forms`).

### Task 13: Catalogue page: copy actions (admin)

**Files:**
- Create: `admin/components/catalogue/CopyStatusDialog.tsx`, `admin/components/catalogue/LostOnLoanDialog.tsx`
- Modify: `admin/lib/catalogue.ts`, `admin/components/catalogue/CopyChip.tsx`, `admin/components/catalogue/useCatalogueActions.ts`, `admin/app/(console)/catalogue/page.tsx`
- Test: `admin/test/app/catalogue.test.tsx` (extend)

**Interfaces:**
- Produces (`lib/catalogue.ts`): `markCopyMaintenance(id)`, `markCopyLost(id, replacementCharge?: number)`, `restoreCopy(id, waiveReplacementCharge: boolean): Promise<{ book: AdminBook; replacementWaived: boolean }>`.
- Chip actions: available → **Maintenance**, **Lost**; on loan → **Lost**; maintenance or lost → **Restore**; held → none. All disabled while `busy`.
- Dialogs (canvas copy): "Mark this copy under maintenance?" / "Mark this copy as lost?" with body "<barcode> is removed from what students see as available.", confirm "Confirm"; "Return this copy to circulation?" with body "<barcode> becomes visible to students again.", confirm "Restore", plus, when `owedReplacement` is set, a checkbox ticked by default "Waive <student>'s ₹<amount> replacement charge". Lost on loan: title "Mark this copy as lost?", body "<student> has this copy, due <date>. Their loan closes, any overdue fine so far is charged, and the replacement charge becomes a Lost book fine they can see.", field "Replacement charge (₹)" (whole number 0–10000, required), confirm "Mark as lost". Toasts: "Copy marked under maintenance.", "Copy marked as lost.", "Copy restored.", and when a waive was asked but `replacementWaived` is false: "Copy restored. The replacement charge was already settled, so it was not waived."

- [ ] **Step 1: Write failing tests:** `chips offer the right actions for each status`; `maintenance confirms and posts`; `lost from the shelf posts no charge`; `lost on loan requires a whole-number charge and posts it`; `restore of a copy with an owed replacement shows the ticked waive box and posts waiveReplacementCharge true`; `unticking it posts false`; `restore answering replacementWaived false shows the settled toast`; `a 409 (waitlist) shows the server's message and refetches`; `buttons stay disabled until the refetch returns`.
- [ ] **Step 2: Run** `npx vitest run test/app/catalogue.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: add copy maintenance, lost and restore to the Catalogue page`).

### Task 14: Seed: fine history and safe re-seeding (backend)

**Files:**
- Create: `backend/prisma/seedData.ts` (the seed's work as `runSeed(prisma: PrismaClient, today?: Date): Promise<SeedSummary>`)
- Modify: `backend/prisma/seed.ts` (thin CLI: builds the client from `DATABASE_URL`, calls `runSeed`, prints the summary), `backend/prisma/history.ts`
- Test: `backend/test/seed/history.test.ts` (extend), `backend/test/seed/reseed.test.ts`

**Interfaces:**
- Produces (`history.ts`): each generated loan gets a deterministic id `hist-loan-<n>`; `generateHistory` also returns `fines: HistoryFine[]`, one per loan returned after its due date, `{ userId, relatedLoanId, amount: overdueFineAmount(dueAt, returnedAt), reason: 'overdue', createdAt: returnedAt, status, paidAt, originalAmount, adjustedAt, adjustReason }`: about half `paid` (paid 1–3 days after the return, no recorder), at least one `adjusted` (lowered, reason `Returned during exam week`) and one `waived` (reason `First late return`), the rest `pending`; no librarian named on any. Deterministic like the rest.
- Produces (re-seed rules, in `runSeed`'s reset): before deleting, set back to `available` any copy of a non-demo book held by a seed user's borrow request or open loan; delete fines that belong to seed users, relate to a loan on a demo book's copy, or relate to a booking on a seed resource; delete reservations on demo books or by seed users; delete recommendation rows for seed users or demo books; delete loans on demo books' copies or by seed users; then copies, resources, books and users as today. Books librarians added, their copies and other students' rows on them stay.

- [ ] **Step 1: Write failing tests:** `history.test.ts`: `every late return has one overdue fine of the right amount`, `fines include paid, adjusted, waived and outstanding, with no librarian`, `still deterministic`. `reseed.test.ts` (runs `runSeed` against the test database): `a second run succeeds`; `after a console-added book with a copy, a seed student's open loan and a fine on it, a re-seed succeeds, keeps the added book and its copy (now available), and removes the seed student's loan and fine`; `another student's loan and fine on a demo book are removed with the demo book, and no fine is left without its loan`; `a copy a librarian added to a demo book is removed`; `every seeded copy has a barcode`.
- [ ] **Step 2: Run** `npx vitest run test/seed`; expect failures.
- [ ] **Step 3: Implement the split, the history fines (insert after the loans) and the reset rules.** Keep the demo student's account exactly as the app's fixtures expect.
- [ ] **Step 4: Run `test/seed`, `npm test`, `npm run typecheck`, then `npm run seed` twice against the dev database.**
- [ ] **Step 5: Update the README's seed section (what a re-seed resets and never touches).**
- [ ] **Step 6: Report the commit commands** (`backend: seed fine history and make re-seeding safe after console use`).

### Task 15: Catalogue checkpoint (live)

**Files:** none (verification only).

- [ ] **Step 1: Same setup as Task 7.**
- [ ] **Step 2: API smoke and contract check:** add a book with two copies and find it in `/books/search` with the right total; put a copy in maintenance and see the student-visible available count drop; restore a copy of a waitlisted title and see the claim; mark an on-loan copy lost with a charge: the loan leaves `/loans/me`, two fines appear on `/fines/me` and on the Fines page, the Dashboard overdue count drops; restore it with the waive and see the fine waived; re-seed and confirm the added book survives. Compare response keys with the TypeScript models.
- [ ] **Step 3: Browser check if screenshots work** (Catalogue page, dialogs, a second tab updating; the student app's book detail and My Loans). Otherwise record that it was not done.
- [ ] **Step 4: Clean up as in Task 7 and record the result.** Anything found becomes a fix task before Task 16.

---

## Page 3: Student page

### Task 16: Student record and manual reliability adjustment (backend)

**Files:**
- Create: `backend/src/services/adminStudentService.ts`, `backend/src/schemas/adminStudents.ts`, migration `console_students` (`--create-only`)
- Modify: `backend/prisma/schema.prisma`, `backend/src/services/reliabilityService.ts`, `backend/src/services/bookingService.ts` (check-in call), `backend/src/services/adminBookingService.ts` (export `derivedStatusSql`), `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminStudents.test.ts`, `backend/test/services/reliabilityRaces.test.ts`, `backend/test/routes/profile.test.ts`

**Interfaces:**
- Consumes: `listFinesForStudent` (Task 2), `derivedStatusSql`, `publishStudentChange()` (Task 1).
- Produces (schema): `ReliabilityScoreLog.adjustedById String?` (relation `"ReliabilityAdjuster"` to `User`, `onDelete: SetNull`).
- Produces (`reliabilityService.ts`): `export function tierFor(score: number): string` (unchanged bands); `applyReliabilityDelta(tx: Prisma.TransactionClient, userId: string, delta: number, reason: string, adjustedById?: string): Promise<{ appliedDelta: number; score: number }>`, which locks the user row (`SELECT ... FOR UPDATE`) before reading so concurrent changes never overwrite each other; check-in keeps calling it inside its transaction.
- Produces (`adminStudentService.ts`):
  ```ts
  interface AdminStudentDto { id: string; name: string; email: string; roll: string /* 'Pending' when null */; score: number; tier: string;
    history: { date: Date; score: number; delta: number; reason: string; by: string | null }[]   // newest first, at most 50
    loans: { id: string; title: string; borrowedAt: Date; dueAt: Date; returnedAt: Date | null; lostAt: Date | null;
      status: 'active' | 'overdue' | 'returned' | 'lost' }[]                                       // newest borrowed first, at most 50
    bookings: { id: string; resource: string; startTime: Date; endTime: Date; status: string }[]  // newest first, at most 50; derived status, requests included
    fines: AdminFineDto[] }                                                                         // listFinesForStudent(id, 50)
  getStudent(id: string, now?: Date): Promise<AdminStudentDto>
  adjustReliability(id: string, adminId: string, delta: number, reason: string): Promise<AdminStudentDto>
  ```
  Routes: `GET /admin/students/:id`; `POST /admin/students/:id/reliability` body `{ delta: integer -10..10, not 0, reason: trimmed 1..300 }`. Unknown id or an admin account → 404 `Student not found`. The log reason is `Library adjustment: <reason>` with `adjustedById`. An adjustment the clamp would make a no-op → 409 `"The score is already at 100."` or `"The score is already at 0."` (rolled back, nothing logged). Success publishes `student.changed`.

- [ ] **Step 1: Write failing tests:** `is for admins only`; `returns profile, tier, history with the librarian's name on manual entries, loans with derived status, bookings with derived status including requests, and fines with accruing rows`; `roll is Pending when null`; `caps each history at 50, newest first`; `an admin's id and an unknown id are 404 "Student not found"`; `adjusts by +5 and logs "Library adjustment: <reason>" with the librarian`; `clamps +10 at 95 to 100`; `+1 at 100 is 409 "The score is already at 100." and logs nothing`; `delta 0, 11, -11, a fraction, or a blank reason is 400`; `publishes student.changed once`; `profile.test.ts`: `the student's reliability card shows the library adjustment as the latest drop`. `reliabilityRaces.test.ts`: `a manual adjustment and an on-time check-in at once both land` (final score = start + 2 + delta; run several times).
- [ ] **Step 2: Run the three files;** expect failures.
- [ ] **Step 3: Add the column (migration reviewed and applied to dev and test), implement the row lock, the service, schemas and routes.**
- [ ] **Step 4: Run the three files three times, `npm test`, `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add the admin student record and manual reliability adjustment`).

### Task 17: Student page (admin)

**Files:**
- Create: `admin/lib/students.ts`, `admin/lib/pageTitle.tsx`, `admin/app/(console)/students/[id]/page.tsx`, `admin/components/students/StudentHeader.tsx`, `admin/components/students/ReliabilityCard.tsx`, `admin/components/students/HistoryTables.tsx`, `admin/components/students/AdjustReliabilityDialog.tsx`
- Modify: `admin/app/(console)/layout.tsx`, `admin/components/Sidebar.tsx` (an `activeHref` prop)
- Test: `admin/test/app/student.test.tsx`, `admin/test/lib/students.test.ts`, `admin/test/components/Sidebar.test.tsx`

**Interfaces:**
- Produces (`lib/students.ts`): `AdminStudent` (Task 16's DTO, dates as strings), `StudentFrom = 'bookings' | 'fines' | 'requests' | 'catalogue'`, `fetchStudent(id: string): Promise<AdminStudent>`, `adjustReliability(id: string, delta: number, reason: string): Promise<AdminStudent>`, `studentHref(id: string, from: StudentFrom): string` (`/students/<id>?from=<from>`).
- Produces (`lib/pageTitle.tsx`): `PageTitleProvider`, `usePageTitle(title: string | null): void` (a page sets the top bar title; null falls back to `PAGE_TITLES`).
- The page reads the id with `useParams()` and `from` with `useSearchParams()` inside a `<Suspense>` boundary (check the Next docs in `node_modules`). Top bar: "<section> / <student name>" (Bookings, Fines, Requests, Catalogue; unknown or missing `from` → "Dashboard"); the sidebar highlights that section (`activeHref`). Content per the canvas's student section: header (initials, name, "<roll> · <email>", tier tag — Good standing `tag-accent-2`, others `tag-accent` — and **Adjust reliability**); reliability card (ring with the score, a line through the history oldest to newest, the dated list with score and reason); "Loan history", "Booking history", "Fine history" tables with "No loan history for this student.", "No booking history for this student.", "No fine history for this student."; loading skeleton; "Couldn't load this student" with **Retry**; a 404 shows "Student not found". `useLiveRefresh(['fines', 'catalogue', 'bookings', 'requests', 'students'], ...)`.
- Adjust dialog: title "Adjust reliability score", body "Current score: <score>. This change is logged with your reason and shown to the student.", a −10 to +10 slider labelled "Adjustment: +3" (or "−3", "0"), "Reason (required)" with placeholder "Why override the automatic score?", confirm "Apply adjustment" disabled at 0 or with a blank reason; toast "Reliability adjusted."; the page refetches.

- [ ] **Step 1: Write failing tests:** `shows the skeleton then the header, reliability, loans, bookings and fines`; `the top bar shows "Fines / <name>" and the sidebar highlights Fines for ?from=fines`; `without from it shows "Dashboard / <name>"`; `empty histories show their lines`; `404 shows "Student not found"`; `error and Retry`; `the adjust dialog is disabled at 0 and with a blank reason, posts delta and reason, toasts and refetches`; `a 409 shows the server's message`; `a live students event refetches quietly`.
- [ ] **Step 2: Run** `npx vitest run test/app/student.test.tsx test/lib/students.test.ts test/components/Sidebar.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`** (the build must not fail on `useSearchParams`).
- [ ] **Step 5: Report the commit commands** (`admin: add the student page`).

### Task 18: Student links across the console (admin)

**Files:**
- Create: `admin/components/StudentLink.tsx`
- Modify: `admin/components/bookings/BookingsTable.tsx`, `admin/components/fines/FinesTable.tsx`, `admin/components/requests/RequestCard.tsx`, `admin/components/catalogue/CopyChip.tsx`
- Test: `admin/test/components/StudentLink.test.tsx`, existing page tests (extend one assertion each)

**Interfaces:**
- Consumes: `studentHref` (Task 17).
- Produces: `StudentLink({ student, from }: { student: { id: string; name: string }; from: StudentFrom })`: a Next `Link` to `studentHref`, styled as the canvas's student link (accent-700, underlined, inherits font size).

- [ ] **Step 1: Write failing tests:** `StudentLink points at /students/<id>?from=<from>`; `the Bookings, Fines, Requests and Catalogue pages link the student's name with their own from`.
- [ ] **Step 2: Run** `npx vitest run test/components/StudentLink.test.tsx test/app`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: link student names to the student page`).

### Task 19: Docs, full live check and hand-off

**Files:**
- Modify: `backend/README.md` (endpoint table: every new route; the lost rule; barcodes; seed rules), `backend/CLAUDE.md` (live topics and `loan.changed`; fines and copy conventions), `admin/README.md`, `admin/CLAUDE.md` (topics, `Pager`, `StudentLink`, `usePageTitle`, no Coming soon), `frontend/README.md` and `CLAUDE.md` if Task 6 left anything
- Create: `admin/docs/2026-11-22-catalogue-fines-students-design.md`, `admin/docs/2026-11-22-catalogue-fines-students.md` (byte-identical copies of the spec and this plan; verify with `cmp`)

- [ ] **Step 1: Update the docs.**
- [ ] **Step 2: Run every suite:** `cd backend && npm run typecheck && npm test`; `cd admin && npm test && npm run typecheck && npm run build`; `cd frontend && flutter analyze && flutter test`. Record the counts.
- [ ] **Step 3: Full live check** (Task 7's setup): everything in Tasks 7 and 15 once more end to end, plus the student page from each page's link, a reliability adjustment seen in the student app's reliability card, and a second console tab updating throughout. Screenshots of the three pages for the report if the browser works.
- [ ] **Step 4: Clean up** (processes you started, password file, scratch scripts, re-seed).
- [ ] **Step 5: Hand-off message:** every suite's result, rulings and deferred findings, the Render deployment state (probe a student route only this slice adds, `/fines/me`: 404 means not deployed), deploy order (backend with its three migrations, then console, then student app with a new APK tag), and the commit commands for anything not yet committed.
