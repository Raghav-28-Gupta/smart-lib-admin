# Admin Console Slice 6 (Needs Attention, Disputes, Problem Reports, Notices and Email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give librarians a Needs attention page (overdue follow-ups, fine disputes, problem reports) fed from the loans the library holds and from disputes and reports students send from the app, settled with the tools slices 4 and 5 built, with every outcome told to the student as an in-app notice and, when the library has configured a sender, an email.

**Architecture:** Kind by kind, foundation first: notices, a mailer and the queue with overdue follow-ups; then fine disputes end to end; then problem reports end to end; then seed, docs, final reviews and a live check. Three new tables (`Notice`, `FineDispute`, `IssueReport`) plus one marker column on `Fine`; overdue follow-ups are derived from loans. The Brevo email call is an optional HTTPS API call behind a thin interface; the in-app notice is the record.

**Tech Stack:** Node 22 (built-in `fetch`), Express 5, Prisma 7, PostgreSQL (`btree_gist`), Zod, Vitest + Supertest (backend); Next.js 16, React, Vitest + Testing Library (admin); Flutter, Riverpod 3, Dio, `json_serializable` (frontend).

**Spec:** `docs/superpowers/specs/2026-11-22-needs-attention-design.md` (read it first, section 6 for every rule and message; the canvas `docs/superpowers/assets/admin-console/canvas-source.dc.html` is the visual authority: search `onRequests`, `requestsList`, `REQ_TYPE_LABEL`).

## Global Constraints

- Run package scripts from inside that package. Run Vitest (backend and admin) and `flutter test` from PowerShell with `C:\` paths (from Git Bash the lowercase `c:` drive makes Vitest load twice and every suite fails at collection). The backend's full suite takes ~18 minutes (the seed test); run the admin suite alone, or its long page tests time out.
- **Never run `git add`, `git commit`, `git push` or any state-changing git.** Each task ends with the exact commit commands for the owner, prefixed `backend:`, `admin:` or `frontend:`, with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never edit `backend/src/generated/**` (regenerate with `npx prisma generate`), `frontend/**/*.g.dart` (regenerate with `dart run build_runner build`), `build/`, `.dart_tool/`, `node_modules/`. **Never read `backend/.env`.** Never print or read the dev admin password file; pass it only as a file path. `BREVO_API_KEY` is a secret: never commit, print or log it, nor any email body.
- Migrations: additive and safe on live data (Render runs `prisma migrate deploy`). Try `npx prisma migrate dev --name <name> --create-only`; if it refuses to run non-interactively, take the SQL from `npx prisma migrate diff --script` into a hand-made migration folder and say so. Read the SQL: no `DROP` of `no_overlapping_bookings` or `BorrowRequest_one_pending_per_title`, and it must not touch `BookCopy.barcode` or `next_copy_barcode()`. Then `npx prisma migrate dev`, `node scripts/migrate-test-db.mjs`, `npx prisma generate`. **If anything asks to reset the database, STOP and report; never accept.**
- Raw SQL against a plain `timestamp(3)` column casts a bound date `${now}::timestamp` (never `::timestamptz`); a test under a non-UTC session proves each new query that depends on it (see `test/services/fineRules.test.ts`).
- Every new `/admin` route answers 401 without a token and 403 for a student. Student routes use `requireAuth` and only ever touch the caller's own rows (another student's id is 404).
- Status changes are conditional updates; a lost race gets a specific 409. **Events** are published once, after commit and after any email outcome is written; a refused write publishes nothing. Live topic `attention`, event `attention.changed`.
- **Email:** off unless `BREVO_API_KEY` and `MAIL_FROM` are set; never sent from tests (a fake transport is injected); placeholder demo addresses and, when `MAIL_ALLOWED_DOMAINS` is set, other domains are `skipped`; an email failure never fails or blocks the action (5-second bound, no retry).
- Notes and reasons: trimmed, at most 300 characters. Notices last 7 days (`REQUEST_OUTCOME_VISIBLE_DAYS`), at most 20 shown. Older student apps must keep working: new response fields are additive only.
- Copy is exactly as the spec, the canvas or this plan gives it; error strings are specific, never "Something went wrong" when the server gave a reason.
- Admin: writes go through `useWriteAction` and dialogs through `components/Dialog.tsx` with `useDialogSubmit` (a refusal keeps the dialog and its text); lists refetch with `useLiveRefresh`, never poll; names link through `StudentLink`. Subagents cannot read `node_modules`: use Context7 for library docs.
- Student app: per-user controllers follow slice 5's rules (watch the user id; never render a previous user's value: use `isReloading`/`hasError` guards; a generation counter drops stale refresh results; `refreshQuietly()` joins a fetch in flight); every HTTP call through `guardApi`; never `dart:io`; tests use `mockRepositoryOverrides()`; JSON tests parse captured fixtures (`dart run tool/capture_fixtures.dart` against a freshly seeded backend, admin password only through `SMARTLIB_ADMIN_PASSWORD_FILE`, re-seed afterwards, token stays redacted).
- Tests derive dates from `new Date()`, never fixed calendar dates.

## Review Focus

1. A librarian adjusts a fine whose dispute was opened after their page loaded: refused with the specific 409, the dispute stays open, nobody is told "Your fine was reduced" (Task 9).
2. The email provider times out or answers 500 during a reminder or an uphold: the action is committed, the notice says `failed`, the console shows "not emailed", the event follows the outcome (Tasks 3, 9).
3. A return that carries a report is refused (loan already closed) or tapped twice: no report, or exactly one (Task 15).
4. An account switch on the same device: notices, "Under review" and Dispute/Report state never show the previous student's (Tasks 6, 12, 19).
5. A re-seed after a librarian-made dispute, notice and report: succeeds and keeps theirs (Task 21).

---

## Phase A: Foundation (notices, mailer, queue, overdue follow-ups)

### Task 1: The mailer (backend)

**Files:**
- Create: `backend/src/lib/mailer.ts`, `backend/test/lib/mailer.test.ts`
- Modify: `backend/src/config/constants.ts`, `backend/.env.example`

**Interfaces:**
- Produces:
  ```ts
  type MailOutcome = 'sent' | 'failed' | 'skipped'
  interface MailMessage { to: string; subject: string; text: string }
  interface MailTransport { send(m: { from: { email: string; name: string }; to: string; subject: string; text: string }, signal: AbortSignal): Promise<{ ok: boolean }> }
  sendEmail(message: MailMessage): Promise<MailOutcome>            // never throws, never logs a body or the key
  isEmailConfigured(): boolean                                      // BREVO_API_KEY and MAIL_FROM set, or a transport injected
  setMailTransport(transport: MailTransport | null): void          // tests only; null restores the real one
  ```
  `constants.ts` gains `DEMO_EMAIL_PATTERN = /^(aditi\.sharma|seed\.student\d+)@thapar\.edu$/i` and `MAIL_TIMEOUT_MS = 5000`. `.env.example` documents `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` (default "SmartLib") and `MAIL_ALLOWED_DOMAINS` (comma-separated, optional), all commented out, with a note that email is off unless the first two are set.
- The real transport is Brevo's transactional email API over `fetch` (`POST https://api.brevo.com/v3/smtp/email`, `api-key` header, JSON sender/to/subject/textContent). **Check Brevo's current API documentation (Context7 or the web) before writing the request.**

- [ ] **Step 1: Write failing tests** (`mailer.test.ts`; stub `fetch` with `vi.stubGlobal` for the real transport, a fake `MailTransport` for the rest): `is skipped, with no request, when BREVO_API_KEY or MAIL_FROM is unset`; `is skipped under NODE_ENV=test with no injected transport`; `skips the placeholder demo addresses`; `skips an address outside MAIL_ALLOWED_DOMAINS and sends inside it, case-insensitively`; `sends one request with the api-key header, the sender name and address, the recipient, subject and text`; `uses "SmartLib" when MAIL_FROM_NAME is unset`; `answers failed on a non-2xx answer, on a network error and on a timeout, and never throws`; `never passes the message text or the key to console.*`.
- [ ] **Step 2: Run** `cd backend; npx vitest run test/lib/mailer.test.ts`; expect failures (module missing).
- [ ] **Step 3: Implement `mailer.ts` and the constants.** Read configuration from `process.env` on every call (tests change it); the timeout is `AbortSignal.timeout(MAIL_TIMEOUT_MS)`.
- [ ] **Step 4: Run the file, then `npm test` and `npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Report the commit commands** (`git add src/lib/mailer.ts src/config/constants.ts .env.example test/lib/mailer.test.ts` / `backend: add an optional email sender`).

### Task 2: Notices and the attention topic (backend)

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/lib/events.ts`, `backend/src/services/loanService.ts` (publish only), `backend/src/services/adminCopyService.ts` (publish only: a copy lost while on loan passes `'attention'` too, because closing the loan removes its overdue item), `backend/src/app.ts`, `backend/test/helpers/db.ts` (add `"Notice"` to the TRUNCATE list)
- Create: migration `attention_notices`, `backend/src/services/noticeService.ts`, `backend/src/routes/notices.ts`
- Test: `backend/test/services/noticeService.test.ts`, `backend/test/routes/notices.test.ts`, `backend/test/lib/events.test.ts`, `backend/test/routes/loans.test.ts`

**Interfaces:**
- Consumes: `sendEmail`, `isEmailConfigured` (Task 1).
- Produces (schema): `enum NoticeKind { overdue_reminder overdue_escalation dispute_outcome report_outcome }`, `enum EmailStatus { sent failed skipped }`, `model Notice { id; userId → User; kind; title; body; loanId? → Loan (SetNull); fineId? → Fine (SetNull); createdById? → User "NoticeAuthor" (SetNull); createdAt; emailStatus @default(skipped); emailedAt?; @@index([userId, createdAt]) }`.
- Produces (code):
  ```ts
  interface NoticeInput { userId: string; kind: NoticeKind; title: string; body: string; loanId?: string; fineId?: string; createdById?: string }
  createNotice(tx: Prisma.TransactionClient, input: NoticeInput): Promise<Notice>      // inside the action's transaction
  deliverNotice(notice: Notice): Promise<EmailStatus>   // after commit; subject "SmartLib: " + title; body + footer; awaited, bounded; writes emailStatus and emailedAt; never throws
  interface NoticeDto { id: string; kind: NoticeKind; title: string; body: string; createdAt: Date }
  listMyNotices(userId: string, now?: Date): Promise<NoticeDto[]>    // last 7 days, newest first, at most 20
  publishAttentionChange(): void      // events.ts: { type: 'attention.changed', topics: ['attention'] }
  ```
  `LiveTopic` gains `'attention'`, `LiveEventType` gains `'attention.changed'`; `publishLoanChange(pastDue)` adds `'attention'` to its topics when `pastDue` (a late return or renewal removes an overdue item). Route `GET /notices/me` (student auth).

- [ ] **Step 1: Write failing tests.** `noticeService.test.ts`: `deliverNotice emails the student with the title as subject and records sent`; `records failed when the transport fails or times out, skipped when email is unconfigured or the address is a placeholder`; `never throws`; `listMyNotices returns only that student's notices from the last 7 days, newest first, at most 20`. `notices.test.ts`: `401 without a token`; `lists only the caller's notices`. `events.test.ts`: `publishAttentionChange publishes attention.changed on attention`. `loans.test.ts` (update the existing loan.changed assertions): `a past-due return and a past-due renewal carry attention; an on-time one does not`. `adminCopies.test.ts` (update the existing event assertion): `marking a copy lost while on loan publishes catalogue.changed on catalogue, fines, metrics and attention`.
- [ ] **Step 2: Run** `npx vitest run test/services/noticeService.test.ts test/routes/notices.test.ts test/lib/events.test.ts test/routes/loans.test.ts`; expect the new tests to fail.
- [ ] **Step 3: Edit the schema, create and apply the migration, regenerate the client, then implement the service, the route (registered in `app.ts` before `adminRouter`) and the event changes.** The footer text is a constant in `noticeService.ts`.
- [ ] **Step 4: Run the four files, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add notices, the attention live topic and a student notices route`).

### Task 3: The queue and overdue follow-ups (backend)

**Files:**
- Create: `backend/src/services/adminAttentionService.ts`, `backend/src/schemas/adminAttention.ts`
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminAttention.test.ts`

**Interfaces:**
- Consumes: `createNotice`, `deliverNotice`, `publishAttentionChange` (Task 2), `isEmailConfigured` (Task 1), `overdueFineAmount` (`fineRules.ts`).
- Produces:
  ```ts
  type AttentionKind = 'overdue' | 'fine_dispute' | 'report'
  interface AttentionStudent { id: string; name: string; email: string }
  type AttentionItemDto =
    | { id: string; kind: 'overdue'; student: AttentionStudent; waitingSince: Date;
        overdue: { loanId: string; title: string; dueAt: Date; daysOverdue: number; amount: number;
                   escalated: boolean;  // the loan has ever been escalated (any overdue_escalation notice), even if a reminder came after it
                   lastNotice: { kind: 'reminder' | 'escalation'; at: Date; emailStatus: 'sent' | 'failed' | 'skipped' } | null } }
    // 'fine_dispute' and 'report' variants are added by Tasks 9 and 16
  listAttention(q: { kind?: AttentionKind }, now?: Date): Promise<{ items: AttentionItemDto[]; counts: { all: number; overdue: number; fine_dispute: number; report: number }; emailEnabled: boolean }>
  remindOverdueLoan(loanId: string, adminId: string, now?: Date): Promise<AttentionItemDto>
  escalateOverdueLoan(loanId: string, adminId: string, note: string | null, now?: Date): Promise<AttentionItemDto>
  ```
  Routes: `GET /admin/attention?kind=` (oldest waiting first), `POST /admin/loans/:id/remind`, `POST /admin/loans/:id/escalate` (body `{ note? }`, default `{}`).
- Rules (spec 6.1): an overdue item is an active loan with `overdueFineAmount(dueAt, now) > 0` (whole days overdue ≥ 1); `waitingSince` is the due date. Remind and escalate lock the loan row (`FOR NO KEY UPDATE`), re-check it is active and still overdue (409 `"This loan is no longer overdue."`), apply the rule (reminder: 409 `"A reminder was sent <n> hours ago."` within 24 hours of the last reminder; escalation once: 409 `"This loan was already escalated."`), insert the notice (copy from spec 5.3: "Overdue book reminder" / "Formal overdue notice", with the librarian's note appended to an escalation), commit, then `deliverNotice`, then `publishAttentionChange()`. Unknown loan 404 `Loan not found`.

- [ ] **Step 1: Write failing tests** (seed users, books, copies, loans and notices with Prisma; fake mail transport): `is for admins only` (401, 403 on all three routes); `lists an active loan a day overdue and not one 23 hours overdue`; `the amount equals that loan's fineAmount on /loans/me`; `a returned, lost or on-time loan is not listed`; `oldest due first, and the kind filter and counts`; `emailEnabled is true only when email is configured`; `remind creates a notice, sends one email after commit, records sent, and the item shows it as lastNotice`; `remind records failed (and succeeds) when the transport fails`; `a placeholder-address student gets skipped`; `a second reminder within 24 hours is 409 with the hours`; `after 24 hours it is allowed`; `escalate once, then 409`; `a reminder after an escalation is allowed (when none was sent in the last 24 hours) and the item stays escalated: true with the reminder as lastNotice`; `both refuse a loan returned, renewed or lost a moment earlier with 409 "This loan is no longer overdue."`; `two simultaneous reminds: one notice, one email, one 409`; `unknown loan is 404`; `the event is published once after the email outcome, and none on a refusal`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminAttention.test.ts`; expect failures.
- [ ] **Step 3: Implement the schema, service and routes.** The queue is one query for overdue loans with student, title, newest notice and whether the loan has any escalation notice (no per-row queries).
- [ ] **Step 4: Run the file twice, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: add the Needs attention queue with overdue follow-ups`).

### Task 4: The Needs attention page and badge (admin)

**Files:**
- Create: `admin/lib/attention.ts`, `admin/lib/attentionContext.tsx`, `admin/app/(console)/attention/page.tsx`, `admin/components/attention/AttentionCard.tsx`, `admin/components/attention/AttentionStates.tsx`
- Modify: `admin/lib/live.ts` (topic `attention`, event `attention.changed`), `admin/components/Sidebar.tsx`, `admin/app/(console)/layout.tsx`, `admin/lib/students.ts` (`StudentFrom` gains `'attention'` with label "Needs attention" and href `/attention`), `admin/components/StudentLink.tsx` (no change if it takes `StudentFrom`)
- Test: `admin/test/app/attention.test.tsx`, `admin/test/lib/attention.test.ts`, `admin/test/lib/attentionContext.test.tsx`, `admin/test/components/Sidebar.test.tsx`, `admin/test/lib/students.test.ts`

**Interfaces:**
- Consumes: Task 3's response (types mirror `AttentionItemDto` with dates as strings).
- Produces (`lib/attention.ts`): `AttentionItem` (overdue variant for now), `AttentionCounts`, `fetchAttention(): Promise<{ items: AttentionItem[]; counts: AttentionCounts; emailEnabled: boolean }>`. `lib/attentionContext.tsx`: `AttentionProvider`, `useAttention(): { state: LoadState; refresh(): Promise<void>; retry(): void }` (modelled on `RequestsProvider`, refetching on topic `attention`), `attentionCount(state): number` (`counts.all`, 0 while loading or on error). Sidebar: `Sidebar` gains an `attentionCount` prop and a **Needs attention** entry (icon `ShieldAlert`) right after Requests with its own badge. Page title "Needs attention".
- The page follows the canvas (chips All, Overdue follow-ups, Fine disputes, Maintenance flags with counts; no No-show chip; `?type=overdue|fine_dispute|report` selects a chip, read with `useSearchParams` inside `<Suspense>`; cards with type tag, `StudentLink from="attention"`, "waiting N days", summary, detail; "Couldn't load the queue" with Retry; skeleton of three 84px blocks; empty state "You're all caught up" with "Nothing needs attention right now. Overdue loans, fine disputes and problem reports will show up here."). An overdue card reads summary "<title> — <n> days overdue", detail "<₹amount so far>. <last notice line>" where the line is "Reminded 2 days ago · emailed", "· not emailed" (failed or skipped) or "Escalated 1 day ago", none when no notice. Card buttons arrive in Task 5.

- [ ] **Step 1: Write failing tests** (`mockFetch`): `shows the skeleton, then an overdue card with its tag, student link, waiting time, amount and last-notice line`; `the chips show counts, filter the cards, and ?type=overdue selects Overdue follow-ups`; `no No-show chip`; `the empty state and "Couldn't load the queue" with Retry`; `a live attention event refetches quietly`; `a quiet refetch that fails keeps the cards`; `the sidebar has Needs attention after Requests with the count as a badge, hidden at 0`; `studentSection('attention') labels the breadcrumb "Needs attention"`; `the provider ignores an older reply that arrives late`.
- [ ] **Step 2: Run** `cd admin; npx vitest run test/app/attention.test.tsx test/lib test/components/Sidebar.test.tsx`; expect failures.
- [ ] **Step 3: Implement the files above.** Read the Next docs through Context7 for `useSearchParams`/Suspense (the student page already does this correctly: follow `app/(console)/students/[id]/page.tsx`).
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: add the Needs attention page with overdue follow-ups`).

### Task 5: Overdue actions and the Dashboard link (admin)

**Files:**
- Create: `admin/components/attention/RemindDialog.tsx`, `admin/components/attention/EscalateDialog.tsx`, `admin/components/attention/useAttentionActions.ts`
- Modify: `admin/lib/attention.ts`, `admin/components/attention/AttentionCard.tsx`, `admin/app/(console)/attention/page.tsx`, `admin/components/dashboard/DashboardView.tsx`, `admin/components/dashboard/KpiCard.tsx` (optional `href`)
- Test: `admin/test/app/attention.test.tsx` (extend), `admin/test/app/dashboard.test.tsx`

**Interfaces:**
- Consumes: Task 3's routes, `useAttention().state.data.emailEnabled`, `Dialog`, `useWriteAction`, `useDialogSubmit`.
- Produces: `remindLoan(loanId: string): Promise<unknown>`, `escalateLoan(loanId: string, note: string): Promise<unknown>` (blank note sends `{}`); `useAttentionActions(refresh)` returning `{ busy, remind(item), escalate(item, note) }`; `KpiCard` takes an optional `href` (renders a `Link`, keeps its look).
- Dialogs: **Send reminder**, title "Send an overdue reminder?", body "<student> gets a notice in the app and an email about <title>." or, when `emailEnabled` is false, "<student> gets a notice in the app about <title>. Email isn't set up."; confirm "Send reminder"; toast "Reminder sent." **Escalate**, title "Escalate to a formal notice?", body "<student> will receive a formal overdue notice for <title> (and an email when email is set up). The fine keeps growing at ₹10 a day until the book is back.", optional note field, confirm "Escalate"; toast "Escalated.". The Dashboard's "Overdue materials" card links to `/attention?type=overdue`. An escalated item shows an "Escalated" tag and no Escalate button.

- [ ] **Step 1: Write failing tests:** `Send reminder posts and toasts "Reminder sent." and the card shows "Reminded just now"`; `the reminder dialog says whether email goes too`; `Escalate sends the note, shows Escalated, and hides the button`; `a 409 (reminded recently, no longer overdue) shows the server's message, keeps the dialog and refetches`; `buttons stay disabled until the list has refetched`; `a second click in flight sends nothing`; `the Overdue materials card on the Dashboard links to /attention?type=overdue`.
- [ ] **Step 2: Run** `npx vitest run test/app/attention.test.tsx test/app/dashboard.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: add reminders and escalation, and link the Dashboard's overdue card`).

### Task 6: Library notices in the student app (frontend)

**Files:**
- Create: `frontend/lib/models/notice.dart` (+ generated), `frontend/lib/features/notices/notice_repository.dart`, `notices_controller.dart`, `notices_section.dart`, fixture `frontend/test/fixtures/notices_me.json` (captured)
- Modify: `frontend/lib/features/loans/loans_screen.dart`, `frontend/test/support/mock_overrides.dart` (`notices:` parameter), `frontend/tool/capture_fixtures.dart`, `frontend/README.md`, `frontend/CLAUDE.md`
- Test: `frontend/test/models/notice_json_test.dart`, `frontend/test/features/notices/http_notice_repository_test.dart`, `frontend/test/features/notices/notices_controller_test.dart`, `frontend/test/features/loans/loans_screen_test.dart` (extend)

**Interfaces:**
- Consumes: `GET /notices/me` (Task 2).
- Produces:
  ```dart
  enum NoticeKind { overdueReminder /* 'overdue_reminder' */, overdueEscalation, disputeOutcome, reportOutcome, unknown }   // unknownEnumValue: unknown
  class Notice { String id; NoticeKind kind; String title; String body; DateTime createdAt /* localDateTime */ }
  abstract class NoticeRepository { Future<List<Notice>> myNotices(); }   // HttpNoticeRepository, MockNoticeRepository
  final noticeRepositoryProvider; final noticesControllerProvider   // AsyncNotifier<List<Notice>>, keyed on the user id; refreshQuietly()
  ```
  `NoticesSection` sits above Requests on My Loans: heading "Library notices", each notice's title in bold, its body and its date (same `20 Nov 2026` format as fines); an escalation in the accent colour; **hidden** when there are none, while loading, and on a load error (notices are secondary: no error text, the next open retries). A notice of an unknown kind still shows its title and body. `LoansScreen` makes one `refreshQuietly()` on notices when opened, with the same per-list rules as loans and fines.
- Controller rules (CLAUDE.md, slice 5): watch the user id; never render a previous user's value (`isReloading || hasError` hides it); generation counter in `build()`; `refreshQuietly()` joins a fetch in flight of the same generation.

- [ ] **Step 1: Extend `capture_fixtures.dart`:** after the existing steps, have the admin remind the demo student's overdue loan if one is still open (or create the notice through whichever admin route Task 3 exposes), then save `GET /notices/me` as `notices_me`. Do not run it yet.
- [ ] **Step 2: Write failing tests:** model: `parses a notice from the fixture`, `an unknown kind maps to unknown and keeps title and body`; repository: `GET /notices/me parses the list`, `401 maps to UnauthorizedException`; controller: `refreshQuietly keeps the data on a network error`, `joins a fetch in flight`, `a refresh started for student A never overwrites student B after a switch`; screen: `shows each notice's title, body and date`, `an escalation uses the accent style`, `hidden when there are none and while loading`, `a different student never sees the previous student's notices while theirs load`, `opening My Loans refetches the notices once`.
- [ ] **Step 3: Run** `cd frontend; flutter test test/models/notice_json_test.dart test/features/notices test/features/loans`; confirm the new tests fail.
- [ ] **Step 4: Capture the fixture** against a freshly seeded local backend (Tasks 1–3 applied; email unset, so notices are `skipped`), then implement the model (`build_runner`), repository, controller, section and screen changes.
- [ ] **Step 5: Run `flutter test` (all) and `flutter analyze`; add the README and CLAUDE.md notes; report the commit commands** (`frontend: show library notices on My Loans`).

### Task 7: Foundation checkpoint (live)

**Files:** none (verification only; scratch files in the session scratchpad).

- [ ] **Step 1: Re-seed, create the throwaway dev admin** (write a random password to a scratchpad file, never printed; set it through `createOrPromoteAdmin` with `npx tsx --env-file=.env` from `backend/`), start the backend (email unset).
- [ ] **Step 2: API smoke and contract check** (a scratch script that reads the password file): `GET /admin/attention` lists the demo student's overdue loan with an amount equal to `/loans/me`, `emailEnabled` false; remind it and see the notice on `GET /notices/me` with `emailStatus` skipped (visible on the next queue fetch as "not emailed"); a second remind is 409; escalate once; return the loan as the student and see it leave the queue and `attention.changed` arrive on `GET /admin/events` once per write. Compare response keys with the TypeScript and Dart models.
- [ ] **Step 3: Stop only the processes you started, delete the password file and scripts, re-seed, record the result.** Anything found becomes a fix task before Task 8.

---

## Phase B: Fine disputes

### Task 8: Dispute creation and the fine row (backend)

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/routes/fines.ts`, `backend/src/services/fineService.ts`, `backend/src/services/adminFineService.ts`, `backend/src/schemas/adminFines.ts`
- Create: migration `attention_disputes`, `backend/src/services/disputeService.ts`, `backend/src/schemas/disputes.ts`
- Test: `backend/test/routes/disputes.test.ts`, `backend/test/routes/fines.test.ts`, `backend/test/routes/adminFines.test.ts`

**Interfaces:**
- Produces (schema): `enum DisputeStatus { open waived adjusted upheld }`; `model FineDispute { id; fineId → Fine @unique; userId → User; reason; status @default(open); resolutionNote?; resolvedById? → User "DisputeResolver" (SetNull); createdAt; resolvedAt?; @@index([status, createdAt]) }`; `Fine.disputedAt DateTime?` (the marker: set while a dispute is open, cleared when it is resolved). Add `"FineDispute"` to `test/helpers/db.ts`.
- Produces (code): `createDispute(userId: string, fineId: string, reason: string): Promise<{ id: string; status: 'open' }>`; route `POST /fines/:id/dispute` body `{ reason }` (trimmed 1–300), 201. `StudentFineDto` gains `dispute: { status: 'open' | 'waived' | 'adjusted' | 'upheld'; note: string | null } | null`. `AdminFineStatus` gains `'disputed'` (derived: marker set; such a fine is listed as disputed, not outstanding or adjusted), `AdminFineDto` gains `dispute: { id: string; reason: string; createdAt: Date } | null`, the list's `status` filter accepts `disputed`.
- Rules: `createDispute` runs in one transaction: a conditional update on the fine (`id`, `userId`, `status IN (pending, adjusted)`, `disputedAt IS NULL`) sets the marker, then inserts the `FineDispute`. On no match: unknown or another student's fine 404 `Fine not found`; paid or waived 409 `"This fine can't be disputed because it is already paid or waived."`; already disputed (open, or resolved: the unique `fineId` rejects a second dispute and rolls the marker back) 409 `"You've already disputed this fine."` Publishes `publishFineChange()` and `publishAttentionChange()` after commit. `markFinePaid` gains `disputedAt: null` in its condition and answers 409 `"This fine is being disputed. Resolve the dispute first."` after the paid and waived refusals and before the changed-amount one. The queue's `fine_dispute` items arrive in Task 9.

- [ ] **Step 1: Write failing tests:** `a student disputes their own outstanding fine (201) and it lists as disputed with the reason on /admin/fines and as dispute open on /fines/me`; `an adjusted fine can be disputed`; `another student's fine and an unknown id are 404`; `a paid or waived fine is 409`; `a second dispute, open or resolved, is 409 "You've already disputed this fine."`; `reason blank, 301 characters or missing is 400`; `401 without a token`; `Mark paid on a disputed fine is 409 with the disputed message and the fine is unchanged`; `the Disputed filter returns only disputed fines and Outstanding excludes them`; `dispute versus pay at once: exactly one wins` (pin the interleaving with a held row lock, as in `test/services/fineRaces.test.ts`); `dispute versus a waive at once: exactly one wins`; `publishes fine.changed and attention.changed once, none on a refusal`.
- [ ] **Step 2: Run** `npx vitest run test/routes/disputes.test.ts test/routes/fines.test.ts test/routes/adminFines.test.ts`; expect failures.
- [ ] **Step 3: Edit the schema, create and apply the migration, regenerate, then implement.** **Also keep the re-seed working (ruling from Task 6's capture, where `npm run seed` failed on `Notice_userId_fkey`):** extend `resetSeedData` in `backend/prisma/seedData.ts` to delete `FineDispute` rows, before the fines and users they point at, for every fine the reset deletes (step 4's criteria) and for seed users; test in `backend/test/seed/reseed.test.ts`: `a re-seed succeeds after a student disputed a seed fine and leaves no dispute without its fine`. Task 21 adds the seed data and the survival tests; this task only keeps the reset from breaking.
- [ ] **Step 4: Run the three files three times, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: let students dispute a fine and hold payment while it is open`).

### Task 9: Resolving a dispute and the queue (backend)

**Files:**
- Modify: `backend/src/services/adminFineService.ts` (`adjustFine`), `backend/src/services/adminCopyService.ts` (`waiveReplacementFine`), `backend/src/services/disputeService.ts`, `backend/src/services/adminAttentionService.ts`, `backend/src/schemas/adminFines.ts`, `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminDisputes.test.ts`, `backend/test/routes/adminFines.test.ts`, `backend/test/routes/adminCopies.test.ts`, `backend/test/routes/adminAttention.test.ts`, `backend/test/services/disputeRaces.test.ts`

**Interfaces:**
- Consumes: Task 8's schema and `createDispute`; Task 2's `createNotice`/`deliverNotice`; Task 3's queue.
- Produces:
  ```ts
  adjustFine(fineId: string, adminId: string, amount: number, reason: string, disputeId?: string | null, now?: Date): Promise<AdminFineDto>   // body gains disputeId
  closeDisputeOnFine(tx: Prisma.TransactionClient, fineId: string, outcome: 'waived' | 'adjusted', note: string, adminId: string, now: Date): Promise<Notice | null>
  upholdDispute(disputeId: string, adminId: string, note: string | null, now?: Date): Promise<{ id: string }>
  // AttentionItemDto gains:
  | { id: string; kind: 'fine_dispute'; student: AttentionStudent; waitingSince: Date;
      dispute: { disputeId: string; studentReason: string; fine: { id: string; item: string; reason: 'overdue' | 'no_show' | 'lost'; amount: number; originalAmount: number; status: string } } }
  ```
  Route `POST /admin/disputes/:id/uphold` (body `{ note? }`, default `{}`). `counts.fine_dispute` and the `fine_dispute` kind filter go live. `adjustFine` today takes `now` as its fifth argument: it moves to the sixth, so update every existing caller and test that passes it.
- Rules (spec 6.2, 6.3): `adjustFine` becomes a transaction: lock the fine row (`FOR NO KEY UPDATE`); a marker set and no `disputeId` is 409 `"This fine was just disputed. Read the dispute before changing the fine."`; a `disputeId` naming a dispute that is not the open one is 409 `"This dispute was already resolved."`; otherwise the existing conditional UPDATE (which also clears the marker), then close the open dispute (`waived` when the new amount is 0, else `adjusted`; the adjustment's reason is the note) and create the notice (copy: spec 5.3). `waiveReplacementFine` closes an open dispute on that fine the same way (note: the restore reason). `upholdDispute` is a conditional update on `open`, clears the marker, creates the notice; 409 `"This dispute was already resolved."`; 404 `Dispute not found`. After commit: `deliverNotice`, then `publishFineChange()` and `publishAttentionChange()`.

- [ ] **Step 1: Write failing tests:** `adjusting a disputed fine with its dispute id closes it as adjusted (waived at 0), clears the marker, writes the notice with the reason, and the student sees both on /fines/me and /notices/me`; `adjusting without the dispute id is 409 "This fine was just disputed…" and changes nothing`; `adjusting with the id of a closed dispute is 409 "This dispute was already resolved."`; `an adjust of an undisputed fine still works with no disputeId`; `restoring a copy with the replacement waived closes a dispute on that fine as waived and sends the notice`; `uphold closes the dispute, clears the marker, keeps the amount, and the fine can then be paid`; `a second uphold, or an uphold after an adjust closed it, is 409`; `unknown dispute is 404`; `the queue lists open disputes oldest first with the student's words, and counts and the kind filter`; `each outcome's notice text matches the spec (waived, reduced, stands)`; `a failing email transport records failed and the action stands`; `events once, after the email outcome, none on a refusal`; **races** (`disputeRaces.test.ts`, held row locks): `dispute then partial adjust without the id is refused; partial adjust then dispute is allowed`; `pay versus adjust keeps slice 5's rule`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminDisputes.test.ts test/routes/adminFines.test.ts test/routes/adminCopies.test.ts test/routes/adminAttention.test.ts test/services/disputeRaces.test.ts`; expect failures.
- [ ] **Step 3: Implement.** Keep the fine UPDATE a single conditional statement inside the transaction (slice 5's `adjustFine` SQL); update the schema for the body.
- [ ] **Step 4: Run the five files three times, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: resolve fine disputes by adjusting, waiving or upholding, with notices`).

### Task 10: The Fines page and disputes (admin)

**Files:**
- Modify: `admin/lib/fines.ts`, `admin/components/fines/FinesTable.tsx`, `admin/components/fines/FineCells.tsx`, `admin/components/fines/useFineActions.ts`, `admin/app/(console)/fines/page.tsx`
- Test: `admin/test/app/fines.test.tsx`, `admin/test/lib/fines.test.ts`

**Interfaces:**
- Consumes: Tasks 8 and 9's response shapes.
- Produces: `AdminFine.dispute: { id: string; reason: string; createdAt: string } | null`; `FineStatus` gains `'disputed'`; `FINE_STATUS_FILTERS` gains Disputed after Outstanding; `adjustFine(id, amount, reason, disputeId?: string | null)` sends `disputeId` when present; `useFineActions.adjust(fine, amount, reason)` passes `fine.dispute?.id`.
- Page: a Disputed tag (accent) in place of Outstanding, a muted line `Student: "<reason>"` under it (full text in the `title`), Mark paid hidden while `dispute` is set, Waive / adjust kept.

- [ ] **Step 1: Write failing tests:** `a disputed row shows the Disputed tag, the student's reason, no Mark paid and a Waive / adjust button`; `the status select offers Disputed and requests status=disputed`; `adjusting a disputed fine sends its disputeId`; `adjusting an undisputed fine sends none`; `a 409 "This fine was just disputed…" shows the server's message, refetches, and the row then shows the dispute`.
- [ ] **Step 2: Run** `cd admin; npx vitest run test/app/fines.test.tsx test/lib/fines.test.ts`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: show disputes on the Fines page and name the dispute when adjusting`).

### Task 11: Dispute cards on the queue (admin)

**Files:**
- Create: `admin/components/attention/UpholdDialog.tsx`
- Modify: `admin/lib/attention.ts`, `admin/components/attention/AttentionCard.tsx`, `admin/components/attention/useAttentionActions.ts`, `admin/app/(console)/attention/page.tsx`
- Test: `admin/test/app/attention.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 9's `fine_dispute` items and route; `AdjustFineDialog` (reused, not copied).
- Produces: `upholdDispute(disputeId: string, note: string): Promise<unknown>`; `fineFromDispute(item): AdminFine` (builds the fine the adjust dialog needs from the item, including `dispute: { id, reason, createdAt }`); `useAttentionActions` gains `uphold(item, note)` and `adjust(item, amount, reason)` (calls `adjustFine(fine.id, amount, reason, disputeId)`, toasts "Fine waived."/"Fine adjusted.").
- Card: tag "Fine dispute"; summary "Disputes ₹<amount> <Overdue|No-show|Lost book> fine on <item>"; detail the student's words; buttons **Waive / adjust** (opens `AdjustFineDialog`) and **Uphold fine** (title "Uphold this fine?", body "The dispute is closed and the fine stands. <summary>.", optional note, confirm "Uphold fine", toast "Fine upheld.").

- [ ] **Step 1: Write failing tests:** `a dispute card shows the tag, summary and the student's words`; `Waive / adjust opens the shared adjust dialog and sends the dispute id`; `Uphold fine posts the note, toasts, and the card leaves after the refetch`; `a 409 on either shows the server's message, keeps the dialog and refetches`; `the Fine disputes chip counts them`; `the student link carries from=attention`.
- [ ] **Step 2: Run** `npx vitest run test/app/attention.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: settle fine disputes from the Needs attention page`).

### Task 12: Dispute a fine in the student app (frontend)

**Files:**
- Modify: `frontend/lib/models/fine.dart` (+ generated), `frontend/lib/features/fines/fine_repository.dart`, `fines_controller.dart`, `fines_section.dart`, `frontend/tool/capture_fixtures.dart`, `frontend/test/support/mock_overrides.dart` (no change if only the mock repo gains a method), README, CLAUDE.md
- Create: fixture `frontend/test/fixtures/fines_me_disputed.json` (captured)
- Test: `frontend/test/models/fine_json_test.dart`, `frontend/test/features/fines/http_fine_repository_test.dart`, `frontend/test/features/fines/fines_controller_test.dart`, `frontend/test/features/loans/loans_screen_test.dart`

**Interfaces:**
- Consumes: `dispute` on `GET /fines/me` rows and `POST /fines/:id/dispute` (Task 8); the outcome notice reaches the student through Task 6's section.
- Produces: `enum DisputeStatus { open, waived, adjusted, upheld, unknown }`; `class FineDispute { DisputeStatus status; String? note }`; `Fine.dispute` (nullable); `FineRepository.dispute(String fineId, String reason): Future<void>` (Http and Mock); `FinesController.dispute(String fineId, String reason)` (calls the repository, then `refreshQuietly()`).
- UI (`FinesSection`): an outstanding or adjusted fine with no dispute shows a **Dispute** text button; it opens a dialog "Dispute this fine" with one required multi-line field "Why do you think this fine is wrong?" (max 300) and **Send**; the write goes through `UiController.attempt` with the success toast "Dispute sent." and the server's message on a refusal (the dialog stays with its text). A card with an open dispute shows "Under review" instead of the button; an upheld one adds "The library kept this fine." plus the note; waived and adjusted already read from the fine's own status and library note. An unknown dispute status shows nothing extra. The button never returns once a dispute exists.

- [ ] **Step 1: Reorder the capture's fines steps:** with the outstanding fine from the overdue return, have the student dispute it, save `fines_me_disputed`; then the admin adjusts it **with the dispute id** (closing it), save `fines_me_adjusted` (now with a closed dispute), then paid. The existing fixtures gain the additive `dispute` key. Do not run it yet.
- [ ] **Step 2: Write failing tests:** model: `parses an open dispute`, `parses a fine with a closed dispute`, `a fine without the key has no dispute`, `an unknown dispute status maps to unknown`; repository: `POST /fines/:id/dispute sends the reason`; `a 409 maps to ConflictException with the server's message`; controller: `dispute refreshes the fines`; screen: `an outstanding fine shows Dispute and an open one shows "Under review"`, `the dialog needs a reason and sends it`, `a refusal keeps the dialog and shows the message`, `an upheld dispute shows the library's note`, `a paid or waived fine has no Dispute button`, `a different student never sees the previous student's dispute state`.
- [ ] **Step 3: Run** `cd frontend; flutter test test/models test/features/fines test/features/loans`; confirm the new tests fail.
- [ ] **Step 4: Capture the fixtures, then implement the model (`build_runner`), repository, controller and UI.**
- [ ] **Step 5: Run `flutter test` (all) and `flutter analyze`; update README and CLAUDE.md; report the commit commands** (`frontend: let students dispute a fine and see the answer`).

### Task 13: Disputes checkpoint (live)

**Files:** none.

- [ ] **Step 1: As Task 7** (re-seed, throwaway admin, backend, scratch script).
- [ ] **Step 2: API smoke and contract check:** a student disputes an outstanding fine; it lists as disputed on `/admin/fines`, appears in the queue with the student's words, and `/fines/me` shows `dispute.open`; Mark paid on it is 409; an adjust without `disputeId` is 409; uphold one (notice "Your fine stands" on `/notices/me`, the fine can be paid); adjust another with its dispute id (closed as adjusted, notice "reduced"); a second dispute on a fine is 409; the dispute-versus-pay race by hand where practical; every write produced one `attention.changed`. Compare keys with the TypeScript and Dart models. Check `GET /admin/attention` counts equal the page totals.
- [ ] **Step 3: Clean up as Task 7; record the result.** Anything found becomes a fix task before Task 14.

---

## Phase C: Problem reports

### Task 14: Resource reports and the booking flags (backend)

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/app.ts`, `backend/src/services/bookingService.ts` (`BookingDto`, `listMyBookings`)
- Create: migration `attention_reports` (hand-edit the SQL as below), `backend/src/services/reportService.ts`, `backend/src/schemas/reports.ts`, `backend/src/routes/reports.ts`
- Test: `backend/test/routes/reports.test.ts`, `backend/test/routes/bookings.test.ts`

**Interfaces:**
- Produces (schema): `enum IssueCategory { damaged missing_pages not_working dirty other }`, `enum ReportStatus { open confirmed dismissed }`, `model IssueReport { id; userId → User; bookCopyId? → BookCopy; resourceId? → Resource; category; note?; status @default(open); resolutionNote?; resolvedById? → User "ReportResolver" (SetNull); createdAt; resolvedAt?; @@index([status, createdAt]) }`. Migration SQL adds a CHECK that exactly one of `bookCopyId`, `resourceId` is set, and two partial unique indexes (`WHERE status = 'open'`) on `(userId, bookCopyId)` and `(userId, resourceId)`. Add `"IssueReport"` to `test/helpers/db.ts`.
- Produces (code): `createResourceReport(userId: string, input: { resourceId: string; category: 'not_working' | 'dirty' | 'other'; note?: string }, now?: Date): Promise<{ id: string }>`; route `POST /reports` (student auth, body as above, 201). `BookingDto` gains `canReport: boolean` and `reportOpen: boolean`.
- Rules (spec 6.4): the student needs a booking on that resource with a raw status of `booked`, `checked_in` or `completed` that started within the last 7 days or starts within the next 24 hours (a never-checked-in booking counts; cancelled, requests and later bookings do not); otherwise 403 `"You can only report a seat or room you have booked."`; an open report from the student on the same resource is 409 `"You already reported this. The library is looking into it."` (also on the unique index); category `other` needs a note, a copy category is 400 here. `canReport` is that rule with no open report; `reportOpen` is an open report by the student on the resource; both computed in one batched lookup. Publishes `publishAttentionChange()` after commit.

- [ ] **Step 1: Write failing tests:** `a student reports a resource they booked (201)`; `a booking that started 6 days ago, one starting in 23 hours, a checked-in one and one never checked into all qualify`; `a booking 8 days ago, one starting in 25 hours, a cancelled booking and a room request do not (403)`; `an open report on the same resource is 409, also under two simultaneous requests`; `category other without a note, a copy category and an unknown category are 400`; `401 without a token`; `/bookings/me shows canReport and reportOpen correctly and a student with no booking sees false`; `publishes attention.changed once, none on a refusal`; `the CHECK rejects a report with no target or two targets` (a direct insert).
- [ ] **Step 2: Run** `npx vitest run test/routes/reports.test.ts test/routes/bookings.test.ts`; expect failures.
- [ ] **Step 3: Edit the schema, create the migration with the hand-written CHECK and indexes, apply, regenerate, implement.** **Also keep the re-seed working:** extend `resetSeedData` in `backend/prisma/seedData.ts` to delete `IssueReport` rows by seed users, on the demo books' copies and on the seed resources, before the copies, resources and users they point at; test in `backend/test/seed/reseed.test.ts`: `a re-seed succeeds after a student reported a seed copy and a seed resource`. Task 21 adds the seed data and the survival tests.
- [ ] **Step 4: Run both files three times, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: let students report a seat or room`).

### Task 15: Return a copy with a report (backend)

**Files:**
- Modify: `backend/src/services/loanService.ts` (`returnLoan`), `backend/src/schemas/loans.ts`, `backend/src/routes/loans.ts`
- Test: `backend/test/routes/loans.test.ts`, `backend/test/services/lostLoanRaces.test.ts` (extend if its helpers fit), `backend/test/routes/reports.test.ts`

**Interfaces:**
- Consumes: Task 14's `IssueReport`.
- Produces: `returnLoan(userId, loanId, report?: { category: 'damaged' | 'missing_pages' | 'other'; note?: string }): Promise<LoanDto>`; `returnLoanSchema = z.object({ report: z.object({ category: z.enum(['damaged','missing_pages','other']), note: z.string().trim().max(300).optional() }).optional() }).default({})` with a refine that `other` needs a note; `POST /loans/:id/return` validates it (no body still works).
- Rules (spec 6.4): the report row is created inside the return's existing transaction, after the conditional `active → returned` update succeeded, with the returning student and the copy; a refused return (closed loan) creates none; an open report by the same student on the same copy is kept (no second row, the return still succeeds); `publishAttentionChange()` after commit when a report was created, alongside the existing `publishLoanChange`.

- [ ] **Step 1: Write failing tests:** `returning with a report creates one open report on that copy by that student, in the same transaction`; `returning with no body behaves as before`; `a return refused because the loan is already returned or lost creates no report`; `two simultaneous returns with a report create exactly one report and one 409`; `a failure after the loan update rolls the report back` (force it by making the copy update fail in a test double or a pinned lock); `an existing open report by the same student on the copy is kept and the return succeeds`; `category other without a note, an unknown category and a 301-character note are 400`; `attention.changed is published once after a report, none otherwise`.
- [ ] **Step 2: Run** `npx vitest run test/routes/loans.test.ts test/routes/reports.test.ts test/services/lostLoanRaces.test.ts`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the three files three times, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: let a student report a problem with a copy when returning it`).

### Task 16: Confirm, dismiss and the queue (backend)

**Files:**
- Modify: `backend/src/services/reportService.ts`, `backend/src/services/adminAttentionService.ts`, `backend/src/schemas/adminAttention.ts`, `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminReports.test.ts`, `backend/test/routes/adminAttention.test.ts`

**Interfaces:**
- Consumes: Task 14's schema; `markCopyMaintenance`, `markCopyLost` (`adminCopyService`); `takeOffline` (`adminResourceService`); `createNotice`/`deliverNotice`.
- Produces:
  ```ts
  confirmReport(reportId: string, adminId: string, input: { outcome?: 'maintenance' | 'lost'; note?: string | null }, now?: Date): Promise<{ id: string }>
  dismissReport(reportId: string, adminId: string, note: string | null, now?: Date): Promise<{ id: string }>
  // AttentionItemDto gains:
  | { id: string; kind: 'report'; student: AttentionStudent; waitingSince: Date;
      report: { reportId: string; target: 'copy' | 'resource'; category: string; note: string | null;
                copy?: { id: string; barcode: string; title: string }; resource?: { id: string; name: string } } }
  ```
  Routes `POST /admin/reports/:id/confirm` (body `{ outcome?, note? }`), `POST /admin/reports/:id/dismiss` (body `{ note? }`). `counts.report` and the `report` kind filter go live.
- Rules (spec 6.4): a copy report needs `outcome` (400 `"Choose what to do with the copy."`); `maintenance` calls `markCopyMaintenance`, `lost` calls `markCopyLost` with no charge fields (a copy now on loan answers its own 409 `"This copy is now on loan."`, so a report never charges anyone); a resource report calls `takeOffline(resourceId, note)`. The action's refusal is returned and the report stays open. Idempotent on state: a copy already in the requested state, or a resource already offline, closes the report without error. Then a conditional update on `open` closes the report (`confirmed`/`dismissed`), the notice is created ("Thanks for the report" / "About your report", spec 5.3, note appended), and after commit: `deliverNotice`, `publishAttentionChange()`. Closed already: 409 `"This report was already resolved."`; unknown 404 `Report not found`.

- [ ] **Step 1: Write failing tests:** `confirming a copy report as maintenance puts the copy in maintenance, closes the report and notifies the reporter`; `as lost works for a shelf copy and never creates a fine`; `a copy that was lent again is refused with "This copy is now on loan." and the report stays open`; `a waitlist refusal keeps the report open`; `a copy already in maintenance closes the report without error`; `confirming a resource report takes it offline with the note, and an already-offline resource closes it`; `a copy report with no outcome is 400`; `dismiss closes with the note and the notice says no action was needed`; `closing twice is 409; unknown id is 404`; `the queue lists reports oldest first with the target, category and note, and the counts and filter`; `a failing email records failed and the action stands`; `events once, after the email outcome, none on a refusal`.
- [ ] **Step 2: Run** `npx vitest run test/routes/adminReports.test.ts test/routes/adminAttention.test.ts`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both files three times, then `npm test` and `npm run typecheck`.**
- [ ] **Step 5: Report the commit commands** (`backend: confirm or dismiss problem reports from the queue`).

### Task 17: Report cards on the queue (admin)

**Files:**
- Create: `admin/components/attention/ConfirmCopyReportDialog.tsx`, `admin/components/attention/DismissDialog.tsx`
- Modify: `admin/lib/attention.ts`, `admin/components/attention/AttentionCard.tsx`, `admin/components/attention/useAttentionActions.ts`, `admin/app/(console)/attention/page.tsx`
- Test: `admin/test/app/attention.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 16's items and routes; `OfflineDialog` from `components/resources/` (reuse for "Take offline", with its note prefilled from the report text; read its props before wiring).
- Produces: `confirmReport(id: string, body: { outcome?: 'maintenance' | 'lost'; note?: string }): Promise<unknown>`, `dismissReport(id: string, note: string): Promise<unknown>`; actions `confirmCopy(item, outcome, note)`, `takeResourceOffline(item, note)`, `dismiss(item, note)`.
- Cards: tag "Maintenance flag"; a copy report reads "Copy <barcode> of <title>, reported at return: <category>" with the student's note as detail; a resource report "<resource> — <category>". Copy: **Confirm & flag copy** (title "Flag this copy for maintenance?", the canvas reason select Damaged / Missing pages / Lost, optional note, body "<summary>. It will be removed from what students see as available. Confirming never charges the student.", confirm "Confirm & flag copy", toast "Copy flagged."). Resource: **Take offline** (reuse the slice 4 dialog; toast "Resource taken offline."). Both: **Dismiss** (title "Dismiss this report?", optional note, confirm "Dismiss", toast "Report dismissed."). Category labels: Damaged, Missing pages, Not working, Dirty, Other.

- [ ] **Step 1: Write failing tests:** `a copy report card shows the barcode, title, category and note`; `Confirm & flag copy sends the chosen outcome (Damaged and Missing pages map to maintenance, Lost to lost) and the note`; `a resource report offers Take offline with the note prefilled and Dismiss`; `Dismiss sends the note`; `a refusal ("This copy is now on loan.") keeps the dialog, toasts the message and the card stays`; `the Maintenance flags chip counts them`.
- [ ] **Step 2: Run** `npx vitest run test/app/attention.test.tsx`; expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.**
- [ ] **Step 5: Report the commit commands** (`admin: settle problem reports from the Needs attention page`).

### Task 18: Report a problem when returning a book (frontend)

**Files:**
- Modify: `frontend/lib/features/loans/loan_repository.dart`, `loans_controller.dart`, `loans_screen.dart`, `frontend/lib/core/ui/ui_controller.dart`, `ui_state.dart`, `confirm_dialog.dart`, `frontend/test/features/loans/*`, `frontend/test/core/ui/*`, README, CLAUDE.md
- Create: `frontend/lib/models/return_report.dart`

**Interfaces:**
- Consumes: `POST /loans/:id/return` with an optional `report` (Task 15).
- Produces: `enum ReportCategory { damaged, missingPages /* 'missing_pages' */, other }` (copy categories) and `class ReturnReport { ReportCategory category; String? note; Map<String, dynamic> toJson() }`; `LoanRepository.returnLoan(String loanId, {ReturnReport? report})`; `LoansController.returnLoan(String loanId, {ReturnReport? report})`; `UiController.onConfirmReturnLoan` becomes `Future<void> Function(String loanId, ReturnReport? report)?` and `confirmReturnLoan(ReturnReport? report)` replaces `confirmDialog()` for the return dialog (other dialogs unchanged).
- UI: the Return dialog keeps its title "Return this book?" and text, and gains a checkbox "Report a problem with this copy"; ticking it shows the choices Damaged, Missing pages, Other and a note field (max 300; required for Other; Return disabled until valid). The success toast is "Returned." or "Returned. Thanks for the report." The dialog is a `StatefulWidget` inside `confirm_dialog.dart` holding its own choices.

- [ ] **Step 1: Write failing tests:** repository (stub adapter): `return sends no body when there is no report and { report: { category, note } } when there is`; `a 409 maps as before`; controller: `returnLoan passes the report and still refreshes the fines`; dialog widget test: `the report choices are hidden until the box is ticked`, `Other needs a note before Return enables`, `Return without a report behaves as before`, `Return with a report calls the action with it`, `the toast text differs`; existing return tests stay green.
- [ ] **Step 2: Run** `cd frontend; flutter test test/features/loans test/core`; confirm the new tests fail.
- [ ] **Step 3: Implement** (model, repository, controller, `UiController`, the dialog).
- [ ] **Step 4: Run `flutter test` (all) and `flutter analyze`; update README and CLAUDE.md.**
- [ ] **Step 5: Report the commit commands** (`frontend: let a student report a problem with a book when returning it`).

### Task 19: Report a seat or room (frontend)

**Files:**
- Modify: `frontend/lib/models/resource_booking.dart` (+ generated), `frontend/lib/features/bookings/booking_repository.dart`, `bookings_controller.dart`, `bookings_screen.dart`, `frontend/tool/capture_fixtures.dart`, fixtures (re-captured), README, CLAUDE.md
- Test: `frontend/test/models/resource_booking_json_test.dart`, `frontend/test/features/bookings/*`

**Interfaces:**
- Consumes: `canReport`, `reportOpen` on `GET /bookings/me` and `POST /reports` (Task 14).
- Produces: `ResourceBooking.resourceId` (`@JsonKey(defaultValue: '')`), `canReport` and `reportOpen` (default false; both carried through `copyWith`); `enum ResourceReportCategory { notWorking /* 'not_working' */, dirty, other }`; `BookingRepository.reportResource(String resourceId, ResourceReportCategory category, String? note): Future<void>`; `BookingsController.reportProblem(ResourceBooking b, ResourceReportCategory category, String? note)` (repository, then `refreshQuietly()`).
- UI: a **Report a problem** text button on each My Bookings card the server marks `canReport`; a dialog with the choices Not working, Dirty, Other and an optional note (required for Other, max 300); after sending, the card shows "Reported" (`reportOpen`) instead of the button. Success toast "Thanks, the library has your report."; a refusal shows the server's message and keeps the dialog.

- [ ] **Step 1: Re-capture bookings fixtures** (the additive keys appear) with the capture's booking steps unchanged; extend the capture to have the student report the seat once and save `bookings_me_reported`. Do not run it yet.
- [ ] **Step 2: Write failing tests:** model: `parses canReport, reportOpen and resourceId`, `older payloads without them parse as false`, `copyWith keeps them`; repository: `POST /reports sends the resource, category and note`; controller: `reportProblem refreshes the bookings`; screen: `the button shows only when canReport`, `Other needs a note`, `after sending the card reads Reported`, `a refusal keeps the dialog`, `a different student never sees the previous student's report state`.
- [ ] **Step 3: Run** `flutter test test/models test/features/bookings`; confirm the new tests fail.
- [ ] **Step 4: Capture the fixtures, then implement.**
- [ ] **Step 5: Run `flutter test` (all) and `flutter analyze`; update README and CLAUDE.md; report the commit commands** (`frontend: let a student report a problem with a seat or room`).

### Task 20: Reports checkpoint (live)

**Files:** none.

- [ ] **Step 1: As Task 7.**
- [ ] **Step 2: API smoke and contract check:** a student returns a copy with a damage report (the report exists, the copy is available); reports a booked seat; both appear in the queue with the right fields; confirm the copy as maintenance (the copy leaves circulation, the student's `/notices/me` has the "Thanks for the report" notice); dismiss the seat report; a second report on the same target is 409; a refused return creates no report; every write produced one `attention.changed`; the queue counts equal the page's. Compare keys with the TypeScript and Dart models.
- [ ] **Step 3: Clean up as Task 7; record the result.** Anything found becomes a fix task before Task 21.

---

## Phase D: Seed, docs, final review

### Task 21: Seed and re-seed rules (backend)

**Files:**
- Modify: `backend/prisma/seedData.ts`, `backend/prisma/history.ts` (only if the dispute seeding needs fine ids), `backend/README.md` (seed section)
- Test: `backend/test/seed/reseed.test.ts`, `backend/test/seed/history.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 8 and 14's tables.
- Note: the reset's deletion of `Notice` rows moved to Task 2b, of `FineDispute` to Task 8 and of `IssueReport` to Task 14 (each new table must not break `npm run seed` the moment it exists); this task adds the seed data and the survival and ordering tests on top, and extends those deletions only where its tests need it.
- Produces (behavior): the seed adds two open fine disputes (on outstanding seed fines; the fine's marker set, a student reason, no librarian), one open copy report and one open resource report by seed students, and creates no notices and sends no email. The re-seed reset deletes, before the rows they point at: disputes on any fine the reset deletes (including other students' fines on demo books), disputes and reports by seed users, reports on the demo books' copies and the seed resources, and notices for seed users. A notice for another student that points at a demo-book loan or fine survives with its links cleared (the FKs are `SetNull`); disputes, reports and notices for librarian-added books and resources, and their students, are never touched.

- [ ] **Step 1: Write failing tests:** `a fresh seed has two open disputes, an open copy report and an open resource report, and the Disputed filter and the queue have data`; `a second run succeeds`; `a librarian-made dispute and report on a non-seed book by a non-seed student survive a re-seed`; `a dispute on another student's fine for a demo book is deleted with the fine, leaving none without a fine`; `a notice for another student about a demo-book loan survives with null links; seed users' notices are deleted`; `the seed sends no email` (the fake transport is never called).
- [ ] **Step 2: Run** `npx vitest run test/seed`; expect failures.
- [ ] **Step 3: Implement the seeding and the reset order** (one transaction as today; the recreate stays outside).
- [ ] **Step 4: Run `test/seed`, then `npm test` and `npm run typecheck`, then `npm run seed` twice against dev (report the summaries; the dev admin account must survive).**
- [ ] **Step 5: Report the commit commands** (`backend: seed open disputes and reports and make re-seeding safe for them`).

### Task 22: Docs

**Files:**
- Modify: `backend/README.md` (endpoint table for every new route, the dispute and report rules, the mailer and its four settings in the Render settings table next to `TZ` and `CORS_ORIGINS`, the notice copy, events), `backend/CLAUDE.md` (Live Events: `publishAttentionChange`, topic `attention`, `loan.changed` carrying `attention`; email is optional and never fails an action; the mailer rules), `backend/.env.example` (confirm Task 1's entries), `admin/README.md`, `admin/CLAUDE.md` (topic list, `AttentionProvider`, the Needs attention page, `StudentFrom 'attention'`, `useAttentionActions`), `frontend/README.md` and `CLAUDE.md` (notices, dispute, reports, the return dialog)
- Create: `admin/docs/2026-11-22-needs-attention-design.md` and `admin/docs/2026-11-22-needs-attention.md` (byte-identical copies of this spec and plan; verify with `cmp`)

- [ ] **Step 1: Update the docs** from the code as it stands (read the routes, schemas, events and components before describing them); fix any statement the earlier slices' docs make that this slice changed (admin README "Needs attention is deferred").
- [ ] **Step 2: Check each doc statement against the code** and list any place the code differs from the spec or plan in the report (do not fix code here).
- [ ] **Step 3: Report the commit commands for each repo** (`backend: document ...`, `admin: document ...`, `frontend: document ...`).

### Task 23: Final suites, full live check and hand-off

**Files:** none (the controller runs the final reviews first, per the process: one whole-slice review per repo on the most capable model, then one fix wave and one scoped re-review; this task follows them).

- [ ] **Step 1: Run every suite on the final code:** `cd backend; npm run typecheck; npm test`; `cd admin; npm test; npm run typecheck; npm run build` (alone, not beside other suites); `cd frontend; flutter analyze; flutter test`. Record the counts.
- [ ] **Step 2: Full live check** (as Task 7): everything in Tasks 7, 13 and 20 once more end to end, plus the Dashboard Overdue card's link target, the sidebar badge count against the queue, the student page breadcrumb "Needs attention / <student>", an overdue reminder's email path with the fake transport only if email is unset (and with the owner's Brevo settings only if the owner has set them), and a re-seed with a librarian-made dispute. Browser part only if the owner has logged in.
- [ ] **Step 3: Clean up** (processes you started, the password file, scratch scripts, test data, re-seed).
- [ ] **Step 4: Hand-off message:** every suite's result, the rulings and deferred findings, the Render deployment state (probe a route only this slice adds, `/notices/me`: 404 means not deployed), the owner's email steps (Brevo account, authenticated sender or domain, `BREVO_API_KEY`, `MAIL_FROM`, optionally `MAIL_ALLOWED_DOMAINS`), deploy order (backend with its three migrations, then console, then app with a new APK tag), and the commit commands for anything not yet committed.
