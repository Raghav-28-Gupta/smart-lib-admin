# Slice 2 — Request Approvals and the Live Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Borrowing a book and booking a room become requests that hold the copy or slot until a librarian approves or declines them in the admin console, which shows every request and every student action live.

**Architecture:** Room requests are `ResourceBooking` rows in a new `requested` status that the existing exclusion constraint treats as taken; borrow requests are rows in a new `BorrowRequest` table holding one copy in a new `requested` copy status. Every mutation publishes a small "what changed" event on an in-process bus after its write commits; `GET /admin/events` streams those as Server-Sent Events, and the Next.js console refetches the affected views. The Flutter student app shows Pending, Declined and Expired states and re-checks every 30 seconds while something is pending.

**Tech Stack:** Node 22, TypeScript, Express 5, Prisma 7 (adapter-pg), PostgreSQL 16 with btree_gist, Vitest 4 + supertest (backend); Next.js 16.3.8, React 19.3, Vitest 5 + Testing Library (console); Flutter, Riverpod 3, Dio, json_serializable (student app).

**Spec:** `docs/superpowers/specs/2026-10-20-request-approvals-design.md`

## Global Constraints

- Approval applies only to borrowing a book and booking a room. Seats, renewals, returns, check-ins, cancellations and the waitlist stay instant.
- A pending borrow request holds one copy (`CopyStatus` `requested`); a pending room request holds its slot (`BookingStatus` `requested`, covered by `no_overlapping_bookings`).
- A borrow request lapses 24 hours after it is made (`expiresAt = requestedAt + 24 h`); a room request lapses when `startTime + gracePeriodMinutes` has passed.
- Students see pending requests, plus declined and expired requests whose `decidedAt` is within the last 7 days. Approved and withdrawn requests are not listed.
- A decline reason is optional, trimmed, at most 300 characters; an empty one counts as none. Without one the student sees "Declined by the library".
- User-facing copy is quoted verbatim from the spec (§4, §6, §7) in the steps below. Do not paraphrase it.
- Live events say what changed (topics `requests`, `metrics`), never the new state; they are published only after the write has committed.
- Console timings: refetch debounce 1 s; resync on every `ready` and every 5 minutes; reconnect after 1, 2, 5, 10, then 30 s; 60 s of silence counts as a dead connection. Server timings: heartbeat every 25 s; each stream ends after 15 minutes.
- The student app re-checks every 30 seconds while a request is pending and its screen is open, and never replaces what is shown with an error because a re-check failed.
- No new environment variables and no new npm or pub dependencies.
- Never commit for the user. Each task ends with the commit commands for the user to run, prefixed `backend:`, `admin:` or `frontend:`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run every script inside its package (`backend/`, `admin/`, `frontend/`). In `backend/`, `npm test` migrates the test database first; `npx vitest run` alone does not, so run `node scripts/migrate-test-db.mjs` before it whenever a migration is new.
- Never hand-edit generated files (`backend/src/generated/**`, Flutter `*.g.dart`); regenerate them with `npx prisma generate` and `dart run build_runner build`.

## Review Focus

1. **A network blip during the student app's 30-second re-check** must leave the current list on screen: no error page, no toast. Tests: Task 15 (`refreshQuietly keeps the list when the network fails` for all three controllers) and Task 16 (`a network blip during the re-check keeps the list on screen`).
2. **A librarian deciding a request that was already settled** (by another librarian, the student withdrawing, or the deadline) gets the specific 409 naming what happened, never a second loan, and the queue refreshes. Tests: Task 6 (`two librarians approving at once`, `deciding a settled request says what happened`, `approving after the deadline`) and Task 11 (`a 409 shows the server's message and refreshes the list`).
3. **A console that outlives a dropped stream, a server restart or the 15-minute rotation** reconnects by itself, resyncs, never re-toasts earlier requests, and the Dashboard never flashes its skeleton on a live refresh. Tests: Task 9 (`reconnects 1 second after the server ends the stream`, `treats a minute of silence as a dropped connection`), Task 10 (`refreshes every view on ready and every 5 minutes`), Task 12 (`refreshes the numbers on a metrics event without the skeleton`).
4. **Double submission:** two quick borrow requests reaching the server, a double tap on Request to borrow, or a double click on Approve hold exactly one copy and make exactly one decision. Tests: Task 4 (`two quick requests for the same title hold one copy`), Task 15 (`a double tap requests once`), Task 11 (`a double click approves once`).
5. **A lapsed hold never blocks another student,** including right after Render wakes from sleep: the startup sweep and the request paths release expired holds before anyone is refused. Tests: Task 5 (`runs once at start and then every minute`, `releases a lapsed hold before another student's request`).

---

## File Structure

**backend/**

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `BorrowRequest`, `BorrowRequestStatus`, new statuses and booking columns |
| `prisma/migrations/20261020120000_request_statuses/migration.sql` (new) | Enum values only (PostgreSQL can't use a new value in the transaction that adds it) |
| `prisma/migrations/20261020120100_request_approvals/migration.sql` (new) | Table, columns, indexes, partial unique index, exclusion constraint rewrite |
| `src/lib/events.ts` (new) | In-process publish/subscribe bus |
| `src/lib/timeLabels.ts` (new) | "Thu, Oct 22" and "2–3 PM" for event summaries |
| `src/lib/liveStream.ts` (new) | Writes the bus to one SSE response; closes all on shutdown |
| `src/services/requestHolds.ts` (new) | Releasing held copies, lapsing stale requests, the 60-second sweep |
| `src/services/borrowRequestService.ts` (new) | Student borrow requests: create, list, withdraw |
| `src/services/requestMessages.ts` (new) | The 409 wording when a request was already settled |
| `src/services/adminRequestService.ts` (new) | Admin queue, approve, decline (both kinds) |
| `src/services/bookingService.ts` (modify) | Rooms become requests; visibility; withdraw; events |
| `src/services/resourceService.ts` (modify) | Held slots count as taken |
| `src/services/loanService.ts`, `reservationService.ts` (modify) | Drop instant borrowing; activity events |
| `src/services/adminMetrics.ts`, `adminMetricsService.ts` (modify) | Count only `booked` and `checked_in` |
| `src/routes/borrowRequests.ts`, `src/schemas/borrowRequests.ts` (new) | Student routes |
| `src/routes/admin.ts` (modify), `src/schemas/adminRequests.ts` (new) | Admin routes and the event stream |
| `src/routes/loans.ts`, `src/app.ts`, `src/index.ts`, `src/config/constants.ts` (modify) | 409 for old apps, mounting, sweep and shutdown, constants |

**admin/**

| File | Responsibility |
|---|---|
| `lib/requests.ts` (new) | Request types and API calls |
| `lib/live.ts` (new) | SSE parser and the reconnecting stream client |
| `lib/liveContext.tsx` (new) | `LiveProvider`, `useLiveStatus`, `useLiveMessages`, `useLiveRefresh` |
| `lib/requestsContext.tsx` (new) | Shared pending-request state |
| `lib/useNow.ts` (new) | A ticking clock for "waiting 12 min" |
| `lib/api.ts`, `lib/format.ts` (modify) | `endSession`; waiting and library-time formatting |
| `components/Toasts.tsx`, `components/RequestToasts.tsx` (new) | Toast host; a toast per new request |
| `components/requests/*` (new) | Request text, decision hook, card, decline dialog, page states |
| `components/dashboard/WaitingPanel.tsx` (new) | The Dashboard's "Waiting for approval" card |
| `components/Sidebar.tsx`, `components/TopBar.tsx`, `app/(console)/layout.tsx`, `app/(console)/dashboard/page.tsx` (modify) | Nav item and badge, live indicator, providers and tab title, live metrics |
| `app/(console)/requests/page.tsx` (new) | The Requests page |

**frontend/**

| File | Responsibility |
|---|---|
| `lib/models/borrow_request.dart` (new) | `BorrowRequest`, `BorrowRequestStatus` |
| `lib/models/resource_booking.dart`, `loan.dart`, `reservation.dart` (modify) | New statuses, `unknown` fallbacks, `expiresAt`, `declineReason` |
| `lib/features/borrow_requests/*` (new) | Repository (HTTP and mock) and controller |
| `lib/widgets/pending_refresh.dart` (new) | The 30-second re-check |
| `lib/features/catalog/book_detail_screen.dart`, `lib/features/loans/*`, `lib/features/bookings/*` (modify) | Request states on every screen |
| `tool/capture_fixtures.dart`, `test/fixtures/*` (modify) | Real payloads for the new states |

---

### Task 1: Schema, migrations and the slice 1 metric fix

**Files:**
- Modify: `backend/prisma/schema.prisma` (whole file)
- Create: `backend/prisma/migrations/20261020120000_request_statuses/migration.sql`
- Create: `backend/prisma/migrations/20261020120100_request_approvals/migration.sql`
- Modify: `backend/src/services/adminMetrics.ts:62-71`
- Modify: `backend/src/services/adminMetricsService.ts:20-28`
- Modify: `backend/prisma/seed.ts` (`deleteExistingSeedData`)
- Modify: `backend/test/helpers/db.ts`
- Test: `backend/test/services/adminMetrics.test.ts`

**Interfaces:**
- Produces (Prisma client, regenerated): model `BorrowRequest { id, userId, user, bookId, book, bookCopyId, bookCopy, status: BorrowRequestStatus, requestedAt, expiresAt, decidedAt, decidedById, decidedBy, declineReason, loanId, loan }`; enum `BorrowRequestStatus = 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled'`; `BookingStatus` gains `'requested' | 'declined' | 'expired'`; `CopyStatus` gains `'requested'`; `ResourceBooking` gains `requestedAt: Date`, `decidedAt: Date | null`, `decidedById: string | null`, `decidedBy`, `declineReason: string | null`. Relation field names on existing models are unchanged.

- [ ] **Step 1: Write the failing metric test**

In `backend/test/services/adminMetrics.test.ts`, inside `describe('bookedPercent', ...)`, after the test `counts a no-show, which stays booked, the same as a check-in`, add:

```ts
  it('counts only booked and checked-in bookings, not requests, declines or lapses', () => {
    const bookings = [
      booking('s1', TODAY, 10, 11, 'requested'),
      booking('s1', TODAY, 11, 12, 'declined'),
      booking('s1', TODAY, 12, 13, 'expired'),
      booking('s1', TODAY, 15, 16, 'checked_in'),
    ]
    // 1 of 11 open hours -> 9%
    expect(bookedPercent(bookings, [seat('s1')], [TODAY])).toBe(9)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `backend/`): `npx vitest run test/services/adminMetrics.test.ts`
Expected: FAIL, `expected 36 to be 9` (four of eleven hours counted).

- [ ] **Step 3: Count only bookings that occupy the resource**

In `backend/src/services/adminMetrics.ts`, replace the doc comment and first line of the loop in `bookedHoursBySlot`:

```ts
// Only these are use of a seat or room. A pending request, a decline, a lapse
// and a cancellation are not.
const OCCUPYING = new Set(['booked', 'checked_in'])

/**
 * Booked hours per slot label for these resources over these days. Only
 * booked and checked-in bookings count; anything outside the open slots never counts.
 */
function bookedHoursBySlot(bookings: BookingRow[], resourceIds: Set<string>, days: Date[]): Map<string, number> {
  const bySlot = new Map<string, number>(TIME_SLOTS.map((s) => [s.label, 0]))
  for (const b of bookings) {
    if (!OCCUPYING.has(b.status) || !resourceIds.has(b.resourceId)) continue
```

(The rest of the function is unchanged.)

In `backend/src/services/adminMetricsService.ts`, change the bookings query in `resourcesAndBookings` to load only those rows:

```ts
    prisma.resourceBooking.findMany({
      where: { status: { in: ['booked', 'checked_in'] }, startTime: { lt: to }, endTime: { gt: from } },
      select: { resourceId: true, startTime: true, endTime: true, status: true },
    }),
```

- [ ] **Step 4: Run the metric tests to verify they pass**

Run: `npx vitest run test/services/adminMetrics.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Replace the Prisma schema**

Replace `backend/prisma/schema.prisma` with:

```prisma
// Prisma 7: the `prisma-client` generator emits into an explicit output dir
// (no more node_modules/.prisma), and the datasource URL now lives in
// prisma.config.ts rather than an env() call here.
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  // The backend compiles to CommonJS, and compiled output keeps import
  // specifiers as written. Left to infer, the generator emits ES modules
  // (import.meta.url) importing './x.ts' -- which tsx and vitest tolerate,
  // but compiled `node dist/index.js` (production) crashes on at startup.
  moduleFormat        = "cjs"
  importFileExtension = "js"
}

datasource db {
  provider = "postgresql"
}

enum Role {
  student
  admin
}

enum CopyStatus {
  available
  borrowed
  lost
  maintenance
  // Set aside for a pending borrow request (see BorrowRequest).
  requested
}

enum LoanStatus {
  active
  returned
  overdue
}

enum ReservationStatus {
  waiting
  fulfilled
  expired
  cancelled
}

enum ResourceType {
  seat
  room
}

enum BookingStatus {
  booked
  checked_in
  no_show
  released
  completed
  cancelled
  // A room booking waiting for a librarian, and its two unhappy endings.
  requested
  declined
  expired
}

enum BorrowRequestStatus {
  pending
  approved
  declined
  expired
  cancelled
}

enum FineReason {
  overdue
  no_show
}

enum FineStatus {
  pending
  paid
  waived
}

enum RecommendationMethod {
  content
  collaborative
  hybrid
}

model User {
  id               String   @id @default(uuid())
  name             String
  email            String   @unique
  passwordHash     String
  // University roll number. Nullable because self-registered accounts don't
  // supply one; the API surfaces `roll ?? 'Pending'` to the client.
  roll             String?
  role             Role     @default(student)
  reliabilityScore Float    @default(100)
  createdAt        DateTime @default(now())

  loans           Loan[]
  reservations    Reservation[]
  bookings        ResourceBooking[] @relation("BookingUser")
  fines           Fine[]
  reliabilityLogs ReliabilityScoreLog[]
  recommendations RecommendationCache[]

  borrowRequests        BorrowRequest[]   @relation("BorrowRequester")
  decidedBorrowRequests BorrowRequest[]   @relation("BorrowRequestDecider")
  decidedBookings       ResourceBooking[] @relation("BookingDecider")
}

model Book {
  id            String  @id @default(uuid())
  isbn          String  @unique
  title         String
  author        String
  genre         String?
  description   String?
  publishedYear Int?
  totalCopies   Int     @default(1)

  copies          BookCopy[]
  reservations    Reservation[]
  recommendations RecommendationCache[]
  borrowRequests  BorrowRequest[]
}

model BookCopy {
  id     String     @id @default(uuid())
  bookId String
  book   Book       @relation(fields: [bookId], references: [id])
  status CopyStatus @default(available)
  loans  Loan[]

  borrowRequests BorrowRequest[]
}

model Loan {
  id           String     @id @default(uuid())
  userId       String
  user         User       @relation(fields: [userId], references: [id])
  bookCopyId   String
  bookCopy     BookCopy   @relation(fields: [bookCopyId], references: [id])
  borrowedAt   DateTime   @default(now())
  dueAt        DateTime
  returnedAt   DateTime?
  renewedCount Int        @default(0)
  status       LoanStatus @default(active)
  fines        Fine[]

  borrowRequest BorrowRequest?
}

model Reservation {
  id             String            @id @default(uuid())
  userId         String
  user           User              @relation(fields: [userId], references: [id])
  bookId         String
  book           Book              @relation(fields: [bookId], references: [id])
  requestedAt    DateTime          @default(now())
  status         ReservationStatus @default(waiting)
  claimExpiresAt DateTime?
}

model Resource {
  id       String       @id @default(uuid())
  type     ResourceType
  name     String
  location String?
  capacity Int          @default(1)

  bookings ResourceBooking[]
}

model ResourceBooking {
  id                 String        @id @default(uuid())
  userId             String
  user               User          @relation("BookingUser", fields: [userId], references: [id])
  resourceId         String
  resource           Resource      @relation(fields: [resourceId], references: [id])
  // Timestamptz, not plain timestamp: the no_overlapping_bookings EXCLUDE
  // constraint indexes tstzrange(startTime, endTime), and tstzrange() is only
  // IMMUTABLE (a hard requirement for index expressions) when its arguments
  // are already timestamptz. Absolute instants are the right model for
  // bookings regardless.
  startTime          DateTime      @db.Timestamptz(3)
  endTime            DateTime      @db.Timestamptz(3)
  status             BookingStatus @default(booked)
  gracePeriodMinutes Int           @default(15)
  checkedInAt        DateTime?     @db.Timestamptz(3)
  priorityScore      Float?
  // Approval of room bookings (seats are booked directly). requestedAt is
  // when the student asked; decidedAt when the row left 'requested'
  // (approved, declined, expired or withdrawn); decidedBy the librarian who
  // approved or declined.
  requestedAt        DateTime      @default(now()) @db.Timestamptz(3)
  decidedAt          DateTime?     @db.Timestamptz(3)
  decidedById        String?
  decidedBy          User?         @relation("BookingDecider", fields: [decidedById], references: [id])
  declineReason      String?

  noShowEvent NoShowEvent?
  fines       Fine[]

  @@index([status, startTime])
}

// A student's request to borrow a book, waiting for a librarian. The copy it
// holds is set to CopyStatus.requested until the request is decided, lapses
// or is withdrawn; approval creates the Loan. One pending request per student
// and title is enforced by a partial unique index in the migration SQL
// (Prisma's schema language cannot express a WHERE clause on an index).
model BorrowRequest {
  id            String              @id @default(uuid())
  userId        String
  user          User                @relation("BorrowRequester", fields: [userId], references: [id])
  bookId        String
  book          Book                @relation(fields: [bookId], references: [id])
  bookCopyId    String
  bookCopy      BookCopy            @relation(fields: [bookCopyId], references: [id])
  status        BorrowRequestStatus @default(pending)
  requestedAt   DateTime            @default(now()) @db.Timestamptz(3)
  expiresAt     DateTime            @db.Timestamptz(3)
  decidedAt     DateTime?           @db.Timestamptz(3)
  decidedById   String?
  decidedBy     User?               @relation("BorrowRequestDecider", fields: [decidedById], references: [id])
  declineReason String?
  loanId        String?             @unique
  loan          Loan?               @relation(fields: [loanId], references: [id])

  @@index([status, expiresAt])
}

model NoShowEvent {
  id                   String          @id @default(uuid())
  resourceBookingId    String          @unique
  resourceBooking      ResourceBooking @relation(fields: [resourceBookingId], references: [id])
  userId               String
  predictedProbability Float
  actualNoShow         Boolean?
  recordedAt           DateTime        @default(now())
}

model Fine {
  id               String           @id @default(uuid())
  userId           String
  user             User             @relation(fields: [userId], references: [id])
  relatedLoanId    String?
  relatedLoan      Loan?            @relation(fields: [relatedLoanId], references: [id])
  relatedBookingId String?
  relatedBooking   ResourceBooking? @relation(fields: [relatedBookingId], references: [id])
  amount           Float
  reason           FineReason
  status           FineStatus       @default(pending)
  createdAt        DateTime         @default(now())
}

model ReliabilityScoreLog {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  score      Float
  delta      Float
  reason     String
  computedAt DateTime @default(now())
}

model RecommendationCache {
  id          String               @id @default(uuid())
  userId      String
  user        User                 @relation(fields: [userId], references: [id])
  bookId      String
  book        Book                 @relation(fields: [bookId], references: [id])
  score       Float
  method      RecommendationMethod
  generatedAt DateTime             @default(now())
}
```

- [ ] **Step 6: Add the two migrations**

`backend/prisma/migrations/20261020120000_request_statuses/migration.sql`:

```sql
-- Enum values for request approvals. In a migration of their own because
-- PostgreSQL cannot use an enum value in the transaction that adds it, and the
-- next migration's exclusion constraint uses 'requested'.

-- AlterEnum
ALTER TYPE "CopyStatus" ADD VALUE 'requested';

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'requested';
ALTER TYPE "BookingStatus" ADD VALUE 'declined';
ALTER TYPE "BookingStatus" ADD VALUE 'expired';
```

`backend/prisma/migrations/20261020120100_request_approvals/migration.sql`:

```sql
-- Request approvals: borrow requests, and room bookings that wait for a
-- librarian. The enum values used here were added by the previous migration.

-- CreateEnum
CREATE TYPE "BorrowRequestStatus" AS ENUM ('pending', 'approved', 'declined', 'expired', 'cancelled');

-- AlterTable
ALTER TABLE "ResourceBooking" ADD COLUMN     "decidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "BorrowRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "bookCopyId" TEXT NOT NULL,
    "status" "BorrowRequestStatus" NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "declineReason" TEXT,
    "loanId" TEXT,

    CONSTRAINT "BorrowRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BorrowRequest_loanId_key" ON "BorrowRequest"("loanId");

-- CreateIndex
CREATE INDEX "BorrowRequest_status_expiresAt_idx" ON "BorrowRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ResourceBooking_status_startTime_idx" ON "ResourceBooking"("status", "startTime");

-- AddForeignKey
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowRequest" ADD CONSTRAINT "BorrowRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowRequest" ADD CONSTRAINT "BorrowRequest_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowRequest" ADD CONSTRAINT "BorrowRequest_bookCopyId_fkey" FOREIGN KEY ("bookCopyId") REFERENCES "BookCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowRequest" ADD CONSTRAINT "BorrowRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowRequest" ADD CONSTRAINT "BorrowRequest_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written: Prisma's schema language can express neither of these.
-- ============================================================================

-- One pending request per student and title. Two quick taps would otherwise
-- hold two copies. A violation surfaces as SQLSTATE 23505.
CREATE UNIQUE INDEX "BorrowRequest_one_pending_per_title"
ON "BorrowRequest"("userId", "bookId") WHERE status = 'pending';

-- A pending room request holds its slot, so the exclusion constraint now
-- covers 'requested' too. Declined, expired and cancelled rows free it.
ALTER TABLE "ResourceBooking" DROP CONSTRAINT no_overlapping_bookings;

ALTER TABLE "ResourceBooking"
ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING gist (
  "resourceId" WITH =,
  tstzrange("startTime", "endTime") WITH &&
) WHERE (status IN ('requested', 'booked', 'checked_in'));
```

- [ ] **Step 7: Regenerate the client and type-check**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` into `./src/generated/prisma`.
Run: `npm run typecheck`
Expected: no output (exit 0).

- [ ] **Step 8: Apply the migrations to the test and dev databases**

Run: `node scripts/migrate-test-db.mjs`
Expected: ends with `All migrations have been successfully applied.` and lists `20261020120000_request_statuses` and `20261020120100_request_approvals`.
Run: `npx prisma migrate deploy`
Expected: the same two migrations applied to the dev database (`DATABASE_URL`).

- [ ] **Step 9: Let the seed and the test reset handle the new table**

In `backend/test/helpers/db.ts`, add `"BorrowRequest"` to the start of the truncated list:

```ts
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "BorrowRequest", "NoShowEvent", "Fine", "ReliabilityScoreLog", "RecommendationCache",
      "ResourceBooking", "Resource", "Reservation", "Loan", "BookCopy",
      "Book", "User"
    RESTART IDENTITY CASCADE
  `)
```

In `backend/prisma/seed.ts`, make borrow requests the first thing `deleteExistingSeedData` deletes:

```ts
async function deleteExistingSeedData() {
  const existingUsers = await prisma.user.findMany({ where: { email: { in: SEED_USER_EMAILS } }, select: { id: true } })
  const userIds = existingUsers.map((u) => u.id)

  // Borrow requests point at copies, loans and users, so they go first.
  await prisma.borrowRequest.deleteMany({ where: { OR: [{ bookId: { in: SEED_BOOK_IDS } }, { userId: { in: userIds } }] } })
  await prisma.fine.deleteMany({ where: { userId: { in: userIds } } })
```

(The remaining `deleteMany` calls are unchanged.)

- [ ] **Step 10: Verify the seed still compiles and runs**

Run: `npm run typecheck:seed`
Expected: no output.
Run: `npm run seed`
Expected: three lines, the last `Generated <n> past bookings and <m> past loans for the seed students.`

- [ ] **Step 11: Run the whole backend suite**

Run: `npm test`
Expected: every file passes (168 tests).

- [ ] **Step 12: Hand off the commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261020120000_request_statuses prisma/migrations/20261020120100_request_approvals src/services/adminMetrics.ts src/services/adminMetricsService.ts prisma/seed.ts test/helpers/db.ts test/services/adminMetrics.test.ts
git commit -m "backend: add request statuses, borrow requests and the held-slot constraint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Event bus and time labels

**Files:**
- Create: `backend/src/lib/events.ts`
- Create: `backend/src/lib/timeLabels.ts`
- Create: `backend/test/helpers/events.ts`
- Test: `backend/test/lib/events.test.ts`, `backend/test/lib/timeLabels.test.ts`

**Interfaces:**
- Produces: `type LiveTopic = 'requests' | 'metrics'`; `type LiveEventType = 'request.created' | 'request.decided' | 'request.expired' | 'request.cancelled' | 'activity'`; `interface LiveEvent { type: LiveEventType; topics: LiveTopic[]; kind?: 'borrow' | 'room'; summary?: string }`; `publish(event: LiveEvent): void`; `subscribe(listener: (event: LiveEvent) => void): () => void`; `subscriberCount(): number`; `publishActivity(): void`; `dayLabel(d: Date): string`; `slotLabel(start: Date, end: Date): string`; test helper `recordEvents(): { events: LiveEvent[]; stop(): void }`.

- [ ] **Step 1: Write the failing tests**

`backend/test/lib/events.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publish, publishActivity, subscribe, subscriberCount, type LiveEvent } from '../../src/lib/events'

const created: LiveEvent = {
  type: 'request.created',
  topics: ['requests'],
  kind: 'borrow',
  summary: 'Aditi Sharma wants to borrow Clean Code',
}

describe('event bus', () => {
  const stops: Array<() => void> = []
  afterEach(() => {
    for (const stop of stops.splice(0)) stop()
    vi.restoreAllMocks()
  })

  it('delivers each published event to every subscriber', () => {
    const a: LiveEvent[] = []
    const b: LiveEvent[] = []
    stops.push(subscribe((e) => a.push(e)), subscribe((e) => b.push(e)))
    publish(created)
    expect(a).toEqual([created])
    expect(b).toEqual([created])
  })

  it('stops delivering once unsubscribed', () => {
    const got: LiveEvent[] = []
    const stop = subscribe((e) => got.push(e))
    stop()
    publish(created)
    expect(got).toEqual([])
    expect(subscriberCount()).toBe(0)
  })

  it('keeps delivering to the others when one subscriber throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const got: LiveEvent[] = []
    stops.push(
      subscribe(() => {
        throw new Error('socket closed')
      }),
      subscribe((e) => got.push(e)),
    )
    publish(created)
    expect(got).toEqual([created])
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('publishActivity announces a change to the Dashboard numbers', () => {
    const got: LiveEvent[] = []
    stops.push(subscribe((e) => got.push(e)))
    publishActivity()
    expect(got).toEqual([{ type: 'activity', topics: ['metrics'] }])
  })
})
```

`backend/test/lib/timeLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dayLabel, slotLabel } from '../../src/lib/timeLabels'

// Local-time constructors, so these pass in any machine time zone.
const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute)

describe('time labels', () => {
  it('names the day like "Thu, Oct 22"', () => {
    expect(dayLabel(at(14))).toBe('Thu, Oct 22')
  })

  it('shows an hour slot the way the console does', () => {
    expect(slotLabel(at(14), at(15))).toBe('2–3 PM')
    expect(slotLabel(at(9), at(10))).toBe('9–10 AM')
    expect(slotLabel(at(11), at(12))).toBe('11 AM–12 PM')
    expect(slotLabel(at(12), at(13))).toBe('12–1 PM')
  })

  it('keeps the minutes when a slot is not on the hour', () => {
    expect(slotLabel(at(14, 30), at(15, 30))).toBe('2:30–3:30 PM')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `backend/`): `npx vitest run test/lib`
Expected: FAIL, cannot resolve `../../src/lib/events` and `../../src/lib/timeLabels`.

- [ ] **Step 3: Implement the bus, the labels and the test helper**

`backend/src/lib/events.ts`:

```ts
// The in-process bus behind the admin console's live updates. Services
// publish after their database write has committed; GET /admin/events streams
// what they publish (lib/liveStream.ts). Events say what changed, never the
// new state: the console refetches. One Render instance means every console
// is connected to this process; several instances would need a shared bus
// (Redis pub/sub).

export type LiveTopic = 'requests' | 'metrics'
export type LiveEventType = 'request.created' | 'request.decided' | 'request.expired' | 'request.cancelled' | 'activity'

export interface LiveEvent {
  type: LiveEventType
  topics: LiveTopic[]
  kind?: 'borrow' | 'room'
  /** request.created only, e.g. "Aditi Sharma wants to borrow Clean Code". */
  summary?: string
}

type Listener = (event: LiveEvent) => void

const listeners = new Set<Listener>()

export function publish(event: LiveEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch (error) {
      // One broken stream must not stop the others hearing about it.
      console.error(error)
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function subscriberCount(): number {
  return listeners.size
}

/** For the many actions that only move Dashboard numbers. */
export function publishActivity(): void {
  publish({ type: 'activity', topics: ['metrics'] })
}
```

`backend/src/lib/timeLabels.ts`:

```ts
// Day and slot labels for live-event summaries, in the server's time zone
// (TZ), like every other library time.

const meridiem = (d: Date) => (d.getHours() < 12 ? 'AM' : 'PM')

function clock(d: Date): string {
  const hour = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
  return d.getMinutes() === 0 ? String(hour) : `${hour}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "Thu, Oct 22" */
export function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "2–3 PM", "11 AM–12 PM", "2:30–3:30 PM" */
export function slotLabel(start: Date, end: Date): string {
  return meridiem(start) === meridiem(end)
    ? `${clock(start)}–${clock(end)} ${meridiem(end)}`
    : `${clock(start)} ${meridiem(start)}–${clock(end)} ${meridiem(end)}`
}
```

`backend/test/helpers/events.ts`:

```ts
import { subscribe, type LiveEvent } from '../../src/lib/events'

/** Records every event published until stop() is called (call it in afterEach). */
export function recordEvents(): { events: LiveEvent[]; stop: () => void } {
  const events: LiveEvent[] = []
  const stop = subscribe((event) => events.push(event))
  return { events, stop }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run test/lib`
Expected: PASS (7 tests).

- [ ] **Step 5: Hand off the commit**

```bash
git add src/lib/events.ts src/lib/timeLabels.ts test/helpers/events.ts test/lib
git commit -m "backend: add the live event bus and summary time labels" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Room bookings become requests

**Files:**
- Modify: `backend/src/config/constants.ts`
- Modify: `backend/src/services/bookingService.ts`
- Modify: `backend/src/services/resourceService.ts:27-31`
- Test: `backend/test/routes/bookings.test.ts`, `backend/test/routes/resources.test.ts`

**Interfaces:**
- Consumes: `publish`, `publishActivity` (Task 2); `dayLabel`, `slotLabel` (Task 2); `recordEvents` (Task 2).
- Produces: `REQUEST_OUTCOME_VISIBLE_DAYS = 7` (constants); `HOLDING_STATUSES: BookingStatus[]`; `graceEnd(booking: { startTime: Date; gracePeriodMinutes: number }): Date`; `BookingDto` gains `expiresAt: Date | null` and `declineReason: string | null`, and `frontendStatus` gains `'requested' | 'declined' | 'expired'`.

- [ ] **Step 1: Write the failing tests**

In `backend/test/routes/bookings.test.ts`, keep the `jsonwebtoken` and `supertest` imports and replace the rest of the import block with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../src/app'
import { GRACE_PERIOD_MINUTES, JWT_SECRET } from '../../src/config/constants'
import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../../src/lib/prisma'
import { dayLabel, slotLabel } from '../../src/lib/timeLabels'
import { resetDb } from '../helpers/db'
import { recordEvents } from '../helpers/events'
```

and add at the end of the file:

```ts
describe('room requests', () => {
  beforeEach(resetDb)
  let recorder: ReturnType<typeof recordEvents> | undefined
  afterEach(() => {
    recorder?.stop()
    recorder = undefined
  })

  function requestRoom(token: string, resourceId: string, hour = 14) {
    return request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId, startTime: iso(2027, 1, 10, hour), endTime: iso(2027, 1, 10, hour + 1) })
  }

  it('creates a room booking as a request that holds the slot until the grace period ends', async () => {
    const { token } = await seedUser()
    const room = await seedResource('room', 'Room 201')

    const res = await requestRoom(token, room.id)

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ status: 'requested', frontendStatus: 'requested', declineReason: null })
    expect(new Date(res.body.expiresAt).getTime()).toBe(
      new Date(iso(2027, 1, 10, 14)).getTime() + GRACE_PERIOD_MINUTES * 60_000,
    )
  })

  it('refuses a second student the held slot, with alternatives', async () => {
    const { token: first } = await seedUser()
    const { token: second } = await seedUser()
    const room = await seedResource('room', 'Room 201')
    await seedResource('room', 'Room 202')
    await requestRoom(first, room.id)

    const res = await requestRoom(second, room.id)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('This resource is already booked for that time.')
    expect(res.body.details.alternatives.length).toBeGreaterThan(0)
  })

  it('announces a room request to the console, and a seat booking as activity', async () => {
    const { user, token } = await seedUser()
    const room = await seedResource('room', 'Room 201')
    const seat = await seedResource('seat', 'Desk 1')
    recorder = recordEvents()

    await requestRoom(token, room.id)
    await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: seat.id, startTime: iso(2027, 1, 10, 9), endTime: iso(2027, 1, 10, 10) })

    const start = new Date(iso(2027, 1, 10, 14))
    const end = new Date(iso(2027, 1, 10, 15))
    expect(recorder.events).toEqual([
      {
        type: 'request.created',
        topics: ['requests'],
        kind: 'room',
        summary: `${user.name} wants Room 201 · ${dayLabel(start)} · ${slotLabel(start, end)}`,
      },
      { type: 'activity', topics: ['metrics'] },
    ])
  })

  it('publishes nothing when the booking is refused', async () => {
    const { token: first } = await seedUser()
    const { token: second } = await seedUser()
    const room = await seedResource('room', 'Room 201')
    await requestRoom(first, room.id)
    recorder = recordEvents()

    await requestRoom(second, room.id)

    expect(recorder.events).toEqual([])
  })

  it('lets the student withdraw a request, which frees the slot', async () => {
    const { token: first } = await seedUser()
    const { token: second } = await seedUser()
    const room = await seedResource('room', 'Room 201')
    const asked = await requestRoom(first, room.id)
    recorder = recordEvents()

    const res = await request(app).post(`/bookings/${asked.body.id}/cancel`).set('Authorization', `Bearer ${first}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
    expect(recorder.events).toEqual([{ type: 'request.cancelled', topics: ['requests'], kind: 'room' }])
    expect((await requestRoom(second, room.id)).status).toBe(201)
  })

  it('cannot check in to a room that is still a request', async () => {
    const { token } = await seedUser()
    const room = await seedResource('room', 'Room 201')
    const asked = await requestRoom(token, room.id)

    const res = await request(app).post(`/bookings/${asked.body.id}/checkin`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('This booking cannot be checked into.')
  })

  it('reports check-ins and cancellations of booked seats as activity', async () => {
    const { token } = await seedUser()
    const seat = await seedResource('seat', 'Desk 1')
    const now = new Date()
    const startedAt = new Date(now.getTime() - 60_000)
    const booked = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: seat.id, startTime: startedAt.toISOString(), endTime: new Date(startedAt.getTime() + 3_600_000).toISOString() })
    const later = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: seat.id, startTime: iso(2027, 1, 10, 9), endTime: iso(2027, 1, 10, 10) })
    recorder = recordEvents()

    await request(app).post(`/bookings/${booked.body.id}/checkin`).set('Authorization', `Bearer ${token}`)
    await request(app).post(`/bookings/${later.body.id}/cancel`).set('Authorization', `Bearer ${token}`)

    expect(recorder.events).toEqual([
      { type: 'activity', topics: ['metrics'] },
      { type: 'activity', topics: ['metrics'] },
    ])
  })
})

describe('GET /bookings/me with room requests', () => {
  beforeEach(resetDb)

  it('shows pending requests, and declined or expired ones for a week', async () => {
    const { user, token } = await seedUser()
    const room = await seedResource('room', 'Room 201')
    const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000)
    const row = (hour: number, data: Partial<Prisma.ResourceBookingUncheckedCreateInput>) =>
      prisma.resourceBooking.create({
        data: {
          userId: user.id,
          resourceId: room.id,
          startTime: new Date(iso(2027, 1, 10, hour)),
          endTime: new Date(iso(2027, 1, 10, hour + 1)),
          ...data,
        },
      })
    await row(9, { status: 'requested' })
    await row(10, { status: 'declined', decidedAt: daysAgo(1), declineReason: 'Reserved for an event' })
    await row(11, { status: 'expired', decidedAt: daysAgo(2) })
    await row(12, { status: 'declined', decidedAt: daysAgo(8) })
    await row(13, { status: 'cancelled', decidedAt: daysAgo(1) })

    const res = await request(app).get('/bookings/me').set('Authorization', `Bearer ${token}`)

    expect(res.body.map((b: { frontendStatus: string }) => b.frontendStatus)).toEqual(['requested', 'declined', 'expired'])
    expect(res.body[0].expiresAt).not.toBeNull()
    expect(res.body[1].declineReason).toBe('Reserved for an event')
    expect(res.body[2].declineReason).toBeNull()
  })
})
```

In `backend/test/routes/resources.test.ts`, inside `describe('GET /resources/availability', ...)`, add:

```ts
  it('marks a slot taken while a room request holds it', async () => {
    const user = await seedUser()
    const resource = await prisma.resource.create({ data: { type: 'room', name: 'Room 201' } })
    await prisma.resourceBooking.create({
      data: {
        userId: user.id,
        resourceId: resource.id,
        startTime: atLocalHour(DATE, 14),
        endTime: atLocalHour(DATE, 15),
        status: 'requested',
      },
    })

    const res = await request(app).get(`/resources/availability?type=room&date=${DATE}`)
    expect(res.body[0].takenSlotsToday).toEqual(['2:00 PM'])
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `backend/`): `npx vitest run test/routes/bookings.test.ts test/routes/resources.test.ts`
Expected: FAIL. The room tests get `status: 'booked'` instead of `'requested'`, there are no events, and the availability test gets `[]`.

- [ ] **Step 3: Add the visibility constant**

In `backend/src/config/constants.ts`, after `WAITLIST_CLAIM_HOURS`:

```ts
// Declined and expired requests stay in the student's lists this long, so the
// student sees the answer.
export const REQUEST_OUTCOME_VISIBLE_DAYS = 7
```

- [ ] **Step 4: Make room bookings requests in the booking service**

In `backend/src/services/bookingService.ts`:

Replace the imports with:

```ts
import { GRACE_PERIOD_MINUTES, RELIABILITY_ONTIME_BOOKING_BONUS, REQUEST_OUTCOME_VISIBLE_DAYS, TIME_SLOTS } from '../config/constants'
import { Prisma } from '../generated/prisma/client'
import type { BookingStatus, ResourceBooking, ResourceType } from '../generated/prisma/client'
import { publish, publishActivity } from '../lib/events'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/httpError'
import { prisma } from '../lib/prisma'
import { dayLabel, slotLabel } from '../lib/timeLabels'
import { applyReliabilityDelta } from './reliabilityService'
```

Replace the `BookingDto` interface with:

```ts
export interface BookingDto {
  id: string
  userId: string
  resourceId: string
  resourceName: string
  resourceType: string
  startTime: Date
  endTime: Date
  status: string
  frontendStatus: 'requested' | 'declined' | 'expired' | 'upcomingFar' | 'inWindow' | 'checkedIn' | 'released'
  graceRemainingSeconds: number
  checkedInAt: Date | null
  /** A room request's deadline: its start plus the grace period. Null otherwise. */
  expiresAt: Date | null
  /** Set only on a declined request, and only if the librarian gave one. */
  declineReason: string | null
}

/**
 * The statuses that occupy a slot. The no_overlapping_bookings constraint
 * covers exactly these, so availability and conflict alternatives use them too.
 */
export const HOLDING_STATUSES: BookingStatus[] = ['requested', 'booked', 'checked_in']

/** When a booking's check-in window closes -- and when a room request for it lapses. */
export function graceEnd(booking: { startTime: Date; gracePeriodMinutes: number }): Date {
  return new Date(booking.startTime.getTime() + booking.gracePeriodMinutes * 60 * 1000)
}
```

Replace `computeWindow` and `toBookingDto` with:

```ts
// Computes the frontend's window-based status/countdown for a still-'booked'
// row (checked_in and the request statuses are handled by the caller, which
// has the raw status). No scheduler releases bookings, so 'released' is purely
// a read-time label -- the DB status stays 'booked' regardless.
function computeWindow(startTime: Date, gracePeriodMinutes: number, now: Date): { frontendStatus: 'upcomingFar' | 'inWindow' | 'released'; graceRemainingSeconds: number } {
  const end = graceEnd({ startTime, gracePeriodMinutes })
  if (now < startTime) return { frontendStatus: 'upcomingFar', graceRemainingSeconds: 0 }
  if (now <= end) return { frontendStatus: 'inWindow', graceRemainingSeconds: Math.floor((end.getTime() - now.getTime()) / 1000) }
  return { frontendStatus: 'released', graceRemainingSeconds: 0 }
}

function toBookingDto(booking: ResourceBooking & { resource: { name: string; type: string } }, now: Date): BookingDto {
  const window = computeWindow(booking.startTime, booking.gracePeriodMinutes, now)
  const frontendStatus: BookingDto['frontendStatus'] =
    booking.status === 'requested' || booking.status === 'declined' || booking.status === 'expired'
      ? booking.status
      : booking.status === 'checked_in'
        ? 'checkedIn'
        : window.frontendStatus

  return {
    id: booking.id,
    userId: booking.userId,
    resourceId: booking.resourceId,
    resourceName: booking.resource.name,
    resourceType: booking.resource.type,
    startTime: booking.startTime,
    endTime: booking.endTime,
    status: booking.status,
    frontendStatus,
    graceRemainingSeconds: frontendStatus === 'inWindow' ? window.graceRemainingSeconds : 0,
    checkedInAt: booking.checkedInAt,
    expiresAt: booking.status === 'requested' ? graceEnd(booking) : null,
    declineReason: booking.status === 'declined' ? booking.declineReason : null,
  }
}
```

In `findAlternatives`, change both `status: { in: ['booked', 'checked_in'] }` filters to `status: { in: HOLDING_STATUSES }`.

Replace `createBooking` with:

```ts
export async function createBooking(userId: string, resourceId: string, startTime: Date, endTime: Date): Promise<BookingDto> {
  if (endTime <= startTime) throw new ValidationError('endTime must be after startTime.')

  // A slot whose check-in window has closed can only ever be released, never
  // used. The current slot stays bookable while it can still be checked into
  // -- the same rule the client uses to grey out past slots.
  const now = new Date()
  if (now.getTime() > startTime.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000) {
    throw new ValidationError('That time slot has already passed. Pick a later one.')
  }

  const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
  if (!resource) throw new NotFoundError('Resource')
  // Rooms wait for a librarian (and hold the slot meanwhile); seats are booked at once.
  const isRoom = resource.type === 'room'

  try {
    // The no_overlapping_bookings constraint is what guarantees no double
    // booking. But when several requests insert overlapping rows at the same
    // instant, Postgres can abort the losers with a deadlock (40P01) while they
    // wait on each other's uncommitted rows, instead of the clean exclusion
    // violation (23P01) -- a 500 here, and about a second of waiting per
    // victim. Taking a per-resource lock first makes concurrent attempts for
    // one resource queue up: each loser then sees the winner's committed row
    // and fails fast with 23P01. Other resources are unaffected. The lock is
    // released automatically at commit or rollback.
    const booking = await prisma.$transaction(async (tx) => {
      // $executeRaw, not $queryRaw: the function returns void, which Prisma
      // cannot deserialize as a result column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${resourceId}))`
      return tx.resourceBooking.create({
        data: { userId, resourceId, startTime, endTime, status: isRoom ? 'requested' : 'booked', requestedAt: now },
        include: { resource: { select: { name: true, type: true } }, user: { select: { name: true } } },
      })
    })
    if (isRoom) {
      publish({
        type: 'request.created',
        topics: ['requests'],
        kind: 'room',
        summary: `${booking.user.name} wants ${booking.resource.name} · ${dayLabel(startTime)} · ${slotLabel(startTime, endTime)}`,
      })
    } else {
      publishActivity()
    }
    return toBookingDto(booking, now)
  } catch (e) {
    if (isExclusionViolation(e)) {
      const alternatives = await findAlternatives(resource, startTime, endTime, now)
      throw new ConflictError('This resource is already booked for that time.', { alternatives })
    }
    throw e
  }
}
```

Replace `listMyBookings` with:

```ts
export async function listMyBookings(userId: string): Promise<BookingDto[]> {
  const now = new Date()
  const since = new Date(now.getTime() - REQUEST_OUTCOME_VISIBLE_DAYS * 24 * 60 * 60 * 1000)
  const bookings = await prisma.resourceBooking.findMany({
    where: {
      userId,
      OR: [
        { status: { notIn: ['cancelled', 'declined', 'expired'] } },
        // A request's answer stays visible for a week.
        { status: { in: ['declined', 'expired'] }, decidedAt: { gte: since } },
      ],
    },
    include: { resource: { select: { name: true, type: true } } },
    orderBy: { startTime: 'asc' },
  })
  return bookings.map((b) => toBookingDto(b, now))
}
```

In `checkInBooking`, publish activity after the transaction, just before the return:

```ts
  publishActivity()
  return toBookingDto(updated, now)
```

Replace `cancelBooking` with:

```ts
export async function cancelBooking(userId: string, bookingId: string): Promise<BookingDto> {
  const booking = await getOwnedBooking(userId, bookingId)
  if (booking.status !== 'booked' && booking.status !== 'requested') {
    throw new ConflictError('This booking cannot be cancelled.')
  }

  const now = new Date()
  const withdrawing = booking.status === 'requested'
  // Conditional on the status just read, so a librarian's decision landing at
  // the same moment wins cleanly instead of being overwritten.
  const { count } = await prisma.resourceBooking.updateMany({
    where: { id: bookingId, status: booking.status },
    data: withdrawing ? { status: 'cancelled', decidedAt: now } : { status: 'cancelled' },
  })
  if (count === 0) throw new ConflictError('This booking cannot be cancelled.')

  const updated = await prisma.resourceBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { resource: { select: { name: true, type: true } } },
  })
  if (withdrawing) publish({ type: 'request.cancelled', topics: ['requests'], kind: 'room' })
  else publishActivity()
  return toBookingDto(updated, now)
}
```

- [ ] **Step 5: Count held slots as taken in availability**

In `backend/src/services/resourceService.ts`, add `import { HOLDING_STATUSES } from './bookingService'` and change the bookings filter in `getAvailability` to `status: { in: HOLDING_STATUSES },`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/routes/bookings.test.ts test/routes/resources.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all files pass.

- [ ] **Step 8: Hand off the commit**

```bash
git add src/config/constants.ts src/services/bookingService.ts src/services/resourceService.ts test/routes/bookings.test.ts test/routes/resources.test.ts
git commit -m "backend: make room bookings requests that hold their slot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Borrow requests for students

**Files:**
- Modify: `backend/src/config/constants.ts`
- Create: `backend/src/services/requestHolds.ts`
- Create: `backend/src/services/borrowRequestService.ts`
- Create: `backend/src/schemas/borrowRequests.ts`
- Create: `backend/src/routes/borrowRequests.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/routes/loans.ts`
- Modify: `backend/src/services/loanService.ts`
- Modify: `backend/src/services/reservationService.ts`
- Test: `backend/test/routes/borrowRequests.test.ts` (new), `backend/test/routes/loans.test.ts`, `backend/test/routes/reservations.test.ts`

**Interfaces:**
- Consumes: `publish`, `publishActivity` (Task 2); `REQUEST_OUTCOME_VISIBLE_DAYS` (Task 3); `assertNotReservedForAnother`, `consumeClaimIfAny`, `onBookReturned` (existing, `reservationService.ts`).
- Produces: `BORROW_REQUEST_HOURS = 24`; `releaseBorrowRequest(request: { id: string; bookId: string; bookCopyId: string }, data: { status: 'declined' | 'expired' | 'cancelled'; decidedAt: Date; decidedById?: string; declineReason?: string | null }): Promise<boolean>` in `requestHolds.ts`; `interface BorrowRequestDto { id; bookId; bookTitle; status; requestedAt: Date; expiresAt: Date; decidedAt: Date | null; declineReason: string | null }`; `createBorrowRequest(userId, bookId)`, `listMyBorrowRequests(userId)`, `cancelBorrowRequest(userId, requestId)` in `borrowRequestService.ts`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/routes/borrowRequests.test.ts`:

```ts
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app'
import { BORROW_REQUEST_HOURS, JWT_SECRET } from '../../src/config/constants'
import { prisma } from '../../src/lib/prisma'
import { resetDb } from '../helpers/db'
import { recordEvents } from '../helpers/events'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

let userCounter = 0

async function seedUser() {
  userCounter += 1
  const user = await prisma.user.create({
    data: { name: `Student ${userCounter}`, email: `student${userCounter}@test.com`, passwordHash: 'x' },
  })
  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' })
  return { user, token }
}

async function seedBookWithCopies(availableCopies: number, totalCopies = availableCopies) {
  const book = await prisma.book.create({
    data: { isbn: `isbn-${Math.random()}`, title: 'Clean Code', author: 'Robert C. Martin', genre: 'Software Eng.', totalCopies },
  })
  const borrowed = totalCopies - availableCopies
  await prisma.bookCopy.createMany({
    data: [
      ...Array.from({ length: availableCopies }, () => ({ bookId: book.id, status: 'available' as const })),
      ...Array.from({ length: Math.max(borrowed, 0) }, () => ({ bookId: book.id, status: 'borrowed' as const })),
    ],
  })
  return book
}

function ask(token: string, bookId: string) {
  return request(app).post('/borrow-requests').set('Authorization', `Bearer ${token}`).send({ bookId })
}

describe('POST /borrow-requests', () => {
  beforeEach(resetDb)
  let recorder: ReturnType<typeof recordEvents> | undefined
  afterEach(() => {
    recorder?.stop()
    recorder = undefined
  })

  it('creates a pending request that holds one copy for 24 hours', async () => {
    const { token } = await seedUser()
    const book = await seedBookWithCopies(2, 4)

    const res = await ask(token, book.id)

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ bookId: book.id, bookTitle: 'Clean Code', status: 'pending', decidedAt: null, declineReason: null })
    expect(new Date(res.body.expiresAt).getTime() - new Date(res.body.requestedAt).getTime()).toBe(BORROW_REQUEST_HOURS * HOUR_MS)
    expect(await prisma.bookCopy.count({ where: { bookId: book.id, status: 'requested' } })).toBe(1)
    expect((await request(app).get(`/books/${book.id}`)).body.availableCopies).toBe(1)
  })

  it('refuses a title the student already has on loan', async () => {
    const { user, token } = await seedUser()
    const book = await seedBookWithCopies(1, 2)
    const borrowed = await prisma.bookCopy.findFirstOrThrow({ where: { bookId: book.id, status: 'borrowed' } })
    await prisma.loan.create({ data: { userId: user.id, bookCopyId: borrowed.id, dueAt: new Date(Date.now() + 5 * DAY_MS) } })

    const res = await ask(token, book.id)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('You already have this book borrowed.')
  })

  it('refuses a second pending request for the same title', async () => {
    const { token } = await seedUser()
    const book = await seedBookWithCopies(2, 2)
    await ask(token, book.id)

    const res = await ask(token, book.id)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe("You've already requested this book.")
  })

  it('two quick requests for the same title hold one copy', async () => {
    const { token } = await seedUser()
    const book = await seedBookWithCopies(3, 3)

    const results = await Promise.all([ask(token, book.id), ask(token, book.id)])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(results.find((r) => r.status === 409)!.body.error).toBe("You've already requested this book.")
    expect(await prisma.borrowRequest.count({ where: { status: 'pending' } })).toBe(1)
    expect(await prisma.bookCopy.count({ where: { bookId: book.id, status: 'requested' } })).toBe(1)
  })

  it('says so when no copy is left', async () => {
    const { token } = await seedUser()
    const book = await seedBookWithCopies(0, 2)

    const res = await ask(token, book.id)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('No available copies right now.')
  })

  it('refuses copies held for waitlisted students', async () => {
    const { user: claimant } = await seedUser()
    const { token } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    await prisma.reservation.create({
      data: { userId: claimant.id, bookId: book.id, status: 'fulfilled', claimExpiresAt: new Date(Date.now() + HOUR_MS) },
    })

    const res = await ask(token, book.id)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('All available copies are reserved for waitlisted students right now.')
  })

  it("turns the student's own waitlist claim into the request", async () => {
    const { user, token } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    await prisma.reservation.create({
      data: { userId: user.id, bookId: book.id, status: 'fulfilled', claimExpiresAt: new Date(Date.now() + HOUR_MS) },
    })

    expect((await ask(token, book.id)).status).toBe(201)
    expect((await request(app).get('/reservations/me').set('Authorization', `Bearer ${token}`)).body).toHaveLength(0)
  })

  it('answers 404 for an unknown book and 401 without a token', async () => {
    const { token } = await seedUser()
    expect((await ask(token, 'no-such-book')).status).toBe(404)
    expect((await request(app).post('/borrow-requests').send({ bookId: 'x' })).status).toBe(401)
  })

  it('announces the request to the console, and nothing when one is refused', async () => {
    const { user, token } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    recorder = recordEvents()

    await ask(token, book.id)
    await ask(token, book.id)

    expect(recorder.events).toEqual([
      { type: 'request.created', topics: ['requests'], kind: 'borrow', summary: `${user.name} wants to borrow Clean Code` },
    ])
  })
})

describe('GET /borrow-requests/me', () => {
  beforeEach(resetDb)

  it('lists pending requests and answers from the last week, newest first', async () => {
    const { user, token } = await seedUser()
    const { user: other } = await seedUser()
    const book = await seedBookWithCopies(7, 7)
    const copies = await prisma.bookCopy.findMany({ where: { bookId: book.id } })
    const now = Date.now()
    const row = (
      i: number,
      userId: string,
      status: 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled',
      requestedHoursAgo: number,
      decidedDaysAgo: number | null,
      declineReason: string | null = null,
    ) =>
      prisma.borrowRequest.create({
        data: {
          userId,
          bookId: book.id,
          bookCopyId: copies[i].id,
          status,
          requestedAt: new Date(now - requestedHoursAgo * HOUR_MS),
          expiresAt: new Date(now - requestedHoursAgo * HOUR_MS + BORROW_REQUEST_HOURS * HOUR_MS),
          decidedAt: decidedDaysAgo === null ? null : new Date(now - decidedDaysAgo * DAY_MS),
          declineReason,
        },
      })
    await row(0, user.id, 'declined', 30, 1, 'Reserved for a course')
    await row(1, user.id, 'pending', 1, null)
    await row(2, user.id, 'expired', 50, 1)
    await row(3, user.id, 'declined', 300, 8)
    await row(4, user.id, 'approved', 40, 1)
    await row(5, user.id, 'cancelled', 3, 0)
    await row(6, other.id, 'pending', 2, null)

    const res = await request(app).get('/borrow-requests/me').set('Authorization', `Bearer ${token}`)

    expect(res.body.map((r: { status: string }) => r.status)).toEqual(['pending', 'declined', 'expired'])
    expect(res.body[1].declineReason).toBe('Reserved for a course')
  })
})

describe('POST /borrow-requests/:id/cancel', () => {
  beforeEach(resetDb)
  let recorder: ReturnType<typeof recordEvents> | undefined
  afterEach(() => {
    recorder?.stop()
    recorder = undefined
  })

  it('withdraws a pending request and passes the copy to the next waiting student', async () => {
    const { token } = await seedUser()
    const { user: waiter } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    const asked = await ask(token, book.id)
    await prisma.reservation.create({ data: { userId: waiter.id, bookId: book.id, status: 'waiting' } })
    recorder = recordEvents()

    const res = await request(app).post(`/borrow-requests/${asked.body.id}/cancel`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
    expect(await prisma.bookCopy.count({ where: { bookId: book.id, status: 'available' } })).toBe(1)
    expect((await prisma.reservation.findFirstOrThrow({ where: { userId: waiter.id } })).status).toBe('fulfilled')
    expect(recorder.events).toEqual([{ type: 'request.cancelled', topics: ['requests'], kind: 'borrow' }])
  })

  it("refuses another student's request, one no longer pending, and an unknown one", async () => {
    const { token } = await seedUser()
    const { token: otherToken } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    const asked = await ask(token, book.id)
    const cancel = (as: string, id: string) =>
      request(app).post(`/borrow-requests/${id}/cancel`).set('Authorization', `Bearer ${as}`)

    const theirs = await cancel(otherToken, asked.body.id)
    expect([theirs.status, theirs.body.error]).toEqual([403, 'This request belongs to another user.'])
    await cancel(token, asked.body.id)
    const again = await cancel(token, asked.body.id)
    expect([again.status, again.body.error]).toEqual([409, 'This request is no longer pending.'])
    expect((await cancel(token, 'nope')).status).toBe(404)
  })
})
```

In `backend/test/routes/loans.test.ts`:

1. Change the vitest import to `import { afterEach, beforeEach, describe, expect, it } from 'vitest'` and add `import { recordEvents } from '../helpers/events'`.
2. Replace the whole `describe('POST /loans (borrow)', ...)` block with:

```ts
describe('POST /loans', () => {
  beforeEach(resetDb)

  it('tells older app versions that borrowing needs approval now', async () => {
    const { token } = await seedUser()
    const book = await seedBookWithCopies(2, 2)

    const res = await request(app).post('/loans').set('Authorization', `Bearer ${token}`).send({ bookId: book.id })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe("Borrowing now needs a librarian's approval. Update the SmartLib app to send a request.")
    expect(await prisma.loan.count()).toBe(0)
  })

  it('still validates the body, and requires authentication', async () => {
    const { token } = await seedUser()
    expect((await request(app).post('/loans').set('Authorization', `Bearer ${token}`).send({})).status).toBe(400)
    expect((await request(app).post('/loans').send({ bookId: 'b1' })).status).toBe(401)
  })
})
```

3. In `describe('GET /loans/me', ...)`, test `lists only the caller's active loans, not another user's`, replace the `POST /loans` line with a seeded loan:

```ts
    const copy = await prisma.bookCopy.findFirstOrThrow({ where: { bookId: book.id } })
    await prisma.loan.create({ data: { userId: user.id, bookCopyId: copy.id, dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } })
```

4. At the end of the file add:

```ts
describe('loan activity reaches the console', () => {
  beforeEach(resetDb)
  let recorder: ReturnType<typeof recordEvents> | undefined
  afterEach(() => recorder?.stop())

  it('reports a renewal and a return as activity', async () => {
    const { user, token } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    const copy = await prisma.bookCopy.findFirstOrThrow({ where: { bookId: book.id } })
    const loan = await prisma.loan.create({
      data: { userId: user.id, bookCopyId: copy.id, dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) },
    })
    recorder = recordEvents()

    await request(app).post(`/loans/${loan.id}/renew`).set('Authorization', `Bearer ${token}`)
    await request(app).post(`/loans/${loan.id}/return`).set('Authorization', `Bearer ${token}`)

    expect(recorder.events).toEqual([
      { type: 'activity', topics: ['metrics'] },
      { type: 'activity', topics: ['metrics'] },
    ])
  })
})
```

In `backend/test/routes/reservations.test.ts`:

1. Change the vitest import to `import { afterEach, beforeEach, describe, expect, it } from 'vitest'` and add `import { recordEvents } from '../helpers/events'`.
2. Replace the whole `describe('borrowing while a claim is outstanding', ...)` block with:

```ts
describe('requesting while a claim is outstanding', () => {
  beforeEach(resetDb)

  it('blocks a non-claimant from requesting the sole earmarked copy', async () => {
    const { user: claimant } = await seedUser()
    const { token: otherToken } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    await prisma.reservation.create({
      data: { userId: claimant.id, bookId: book.id, status: 'fulfilled', claimExpiresAt: new Date(Date.now() + 60_000) },
    })

    const res = await request(app).post('/borrow-requests').set('Authorization', `Bearer ${otherToken}`).send({ bookId: book.id })
    expect(res.status).toBe(409)
  })

  it('lets the claimant request it, which uses up the claim', async () => {
    const { user: claimant, token: claimantToken } = await seedUser()
    const book = await seedBookWithCopies(1, 1)
    await prisma.reservation.create({
      data: { userId: claimant.id, bookId: book.id, status: 'fulfilled', claimExpiresAt: new Date(Date.now() + 60_000) },
    })

    const res = await request(app).post('/borrow-requests').set('Authorization', `Bearer ${claimantToken}`).send({ bookId: book.id })
    expect(res.status).toBe(201)

    const remaining = await request(app).get('/reservations/me').set('Authorization', `Bearer ${claimantToken}`)
    expect(remaining.body).toHaveLength(0)
  })
})

describe('waitlist activity reaches the console', () => {
  beforeEach(resetDb)
  let recorder: ReturnType<typeof recordEvents> | undefined
  afterEach(() => recorder?.stop())

  it('reports joining and leaving as activity', async () => {
    const { token } = await seedUser()
    const book = await seedBookWithCopies(0, 1)
    recorder = recordEvents()

    const joined = await request(app).post('/reservations').set('Authorization', `Bearer ${token}`).send({ bookId: book.id })
    await request(app).delete(`/reservations/${joined.body.id}`).set('Authorization', `Bearer ${token}`)

    expect(recorder.events).toEqual([
      { type: 'activity', topics: ['metrics'] },
      { type: 'activity', topics: ['metrics'] },
    ])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `backend/`): `npx vitest run test/routes/borrowRequests.test.ts test/routes/loans.test.ts test/routes/reservations.test.ts`
Expected: FAIL. `/borrow-requests` answers 404 (no route), `BORROW_REQUEST_HOURS` is undefined, `POST /loans` still answers 201, and no activity events are published.

- [ ] **Step 3: Add the request window**

In `backend/src/config/constants.ts`, after `REQUEST_OUTCOME_VISIBLE_DAYS`:

```ts
// A borrow request holds its copy this long while it waits for a librarian.
export const BORROW_REQUEST_HOURS = 24
```

- [ ] **Step 4: Add the copy release**

Create `backend/src/services/requestHolds.ts`:

```ts
// Releasing what a request holds. A pending borrow request holds one copy
// (CopyStatus 'requested'); a pending room request holds its slot through the
// no_overlapping_bookings constraint, which frees it as soon as the row leaves
// 'requested'.
import { prisma } from '../lib/prisma'
import { onBookReturned } from './reservationService'

/**
 * Moves a pending borrow request to `data.status` and hands its copy back: the
 * copy is available again, then the waitlist cascade runs (the next waiting
 * student gets a claim). Conditional on 'pending', so of two racing decisions
 * only one lands; returns false for the one that lost.
 */
export async function releaseBorrowRequest(
  request: { id: string; bookId: string; bookCopyId: string },
  data: { status: 'declined' | 'expired' | 'cancelled'; decidedAt: Date; decidedById?: string; declineReason?: string | null },
): Promise<boolean> {
  const released = await prisma.$transaction(async (tx) => {
    const { count } = await tx.borrowRequest.updateMany({ where: { id: request.id, status: 'pending' }, data })
    if (count === 0) return false
    await tx.bookCopy.updateMany({ where: { id: request.bookCopyId, status: 'requested' }, data: { status: 'available' } })
    return true
  })
  if (released) await onBookReturned(request.bookId, data.decidedAt)
  return released
}
```

- [ ] **Step 5: Add the borrow request service**

Create `backend/src/services/borrowRequestService.ts`:

```ts
// A student asks to borrow a book; a librarian approves or declines it in the
// admin console (adminRequestService.ts). While it waits, the request holds one
// copy, so nobody else can take it.
import { BORROW_REQUEST_HOURS, REQUEST_OUTCOME_VISIBLE_DAYS } from '../config/constants'
import { Prisma } from '../generated/prisma/client'
import type { BorrowRequest } from '../generated/prisma/client'
import { publish } from '../lib/events'
import { ConflictError, ForbiddenError, NotFoundError } from '../lib/httpError'
import { prisma } from '../lib/prisma'
import { releaseBorrowRequest } from './requestHolds'
import { assertNotReservedForAnother, consumeClaimIfAny } from './reservationService'

const HOUR_MS = 60 * 60 * 1000

export interface BorrowRequestDto {
  id: string
  bookId: string
  bookTitle: string
  status: 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled'
  requestedAt: Date
  expiresAt: Date
  decidedAt: Date | null
  declineReason: string | null
}

function toDto(r: BorrowRequest & { book: { title: string } }): BorrowRequestDto {
  return {
    id: r.id,
    bookId: r.bookId,
    bookTitle: r.book.title,
    status: r.status,
    requestedAt: r.requestedAt,
    expiresAt: r.expiresAt,
    decidedAt: r.decidedAt,
    declineReason: r.declineReason,
  }
}

// The partial unique index BorrowRequest_one_pending_per_title rejects a
// second pending request for a title. Prisma reports a unique violation as
// P2002; through the pg driver adapter it can also arrive as a generic P2039
// carrying SQLSTATE 23505 in its message (see bookingService.isExclusionViolation).
function isDuplicatePending(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === 'P2002' || (e.code === 'P2039' && e.message.includes('23505')))
  )
}

export async function createBorrowRequest(userId: string, bookId: string): Promise<BorrowRequestDto> {
  const book = await prisma.book.findUnique({ where: { id: bookId } })
  if (!book) throw new NotFoundError('Book')

  const activeLoan = await prisma.loan.findFirst({ where: { userId, status: 'active', bookCopy: { bookId } } })
  if (activeLoan) throw new ConflictError('You already have this book borrowed.')
  const pending = await prisma.borrowRequest.findFirst({ where: { userId, bookId, status: 'pending' } })
  if (pending) throw new ConflictError("You've already requested this book.")

  const now = new Date()
  // "No available copies right now." or the waitlist message, as borrowing had.
  await assertNotReservedForAnother(userId, bookId, now)

  let created
  try {
    created = await prisma.$transaction(async (tx) => {
      // The same race-safe claim borrowing used: the conditional update
      // re-checks 'available' against the committed row, so two requests can
      // never hold one copy.
      const candidates = await tx.bookCopy.findMany({ where: { bookId, status: 'available' }, select: { id: true }, take: 5 })
      for (const candidate of candidates) {
        const { count } = await tx.bookCopy.updateMany({
          where: { id: candidate.id, status: 'available' },
          data: { status: 'requested' },
        })
        if (count === 1) {
          return tx.borrowRequest.create({
            data: {
              userId,
              bookId,
              bookCopyId: candidate.id,
              requestedAt: now,
              expiresAt: new Date(now.getTime() + BORROW_REQUEST_HOURS * HOUR_MS),
            },
            include: { book: { select: { title: true } }, user: { select: { name: true } } },
          })
        }
      }
      throw new ConflictError('No available copies right now.')
    })
  } catch (e) {
    if (isDuplicatePending(e)) throw new ConflictError("You've already requested this book.")
    throw e
  }

  // A waitlist claim the student held is now this request.
  await consumeClaimIfAny(userId, bookId)
  publish({
    type: 'request.created',
    topics: ['requests'],
    kind: 'borrow',
    summary: `${created.user.name} wants to borrow ${created.book.title}`,
  })
  return toDto(created)
}

export async function listMyBorrowRequests(userId: string): Promise<BorrowRequestDto[]> {
  const since = new Date(Date.now() - REQUEST_OUTCOME_VISIBLE_DAYS * 24 * HOUR_MS)
  const rows = await prisma.borrowRequest.findMany({
    where: {
      userId,
      OR: [{ status: 'pending' }, { status: { in: ['declined', 'expired'] }, decidedAt: { gte: since } }],
    },
    include: { book: { select: { title: true } } },
    orderBy: { requestedAt: 'desc' },
  })
  return rows.map(toDto)
}

export async function cancelBorrowRequest(userId: string, requestId: string): Promise<BorrowRequestDto> {
  const request = await prisma.borrowRequest.findUnique({ where: { id: requestId } })
  if (!request) throw new NotFoundError('Borrow request')
  if (request.userId !== userId) throw new ForbiddenError('This request belongs to another user.')

  const withdrawn =
    request.status === 'pending' && (await releaseBorrowRequest(request, { status: 'cancelled', decidedAt: new Date() }))
  if (!withdrawn) throw new ConflictError('This request is no longer pending.')

  publish({ type: 'request.cancelled', topics: ['requests'], kind: 'borrow' })
  const updated = await prisma.borrowRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { book: { select: { title: true } } },
  })
  return toDto(updated)
}
```

- [ ] **Step 6: Add the routes and retire instant borrowing**

Create `backend/src/schemas/borrowRequests.ts`:

```ts
import { z } from 'zod'

export const createBorrowRequestSchema = z.object({ bookId: z.string().min(1) })

// Same non-UUID reasoning as loans.ts.
export const borrowRequestIdParamsSchema = z.object({ id: z.string().min(1) })
```

Create `backend/src/routes/borrowRequests.ts`:

```ts
import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth'
import { validate } from '../middleware/validate'
import { borrowRequestIdParamsSchema, createBorrowRequestSchema } from '../schemas/borrowRequests'
import { cancelBorrowRequest, createBorrowRequest, listMyBorrowRequests } from '../services/borrowRequestService'

export const borrowRequestsRouter = Router()

borrowRequestsRouter.post('/borrow-requests', requireAuth, validate({ body: createBorrowRequestSchema }), async (req, res) => {
  const { bookId } = req.body as { bookId: string }
  res.status(201).json(await createBorrowRequest(req.user!.sub, bookId))
})

borrowRequestsRouter.get('/borrow-requests/me', requireAuth, async (req, res) => {
  res.json(await listMyBorrowRequests(req.user!.sub))
})

borrowRequestsRouter.post(
  '/borrow-requests/:id/cancel',
  requireAuth,
  validate({ params: borrowRequestIdParamsSchema }),
  async (req, res) => {
    const { id } = req.params as { id: string }
    res.json(await cancelBorrowRequest(req.user!.sub, id))
  },
)
```

In `backend/src/app.ts`, add `import { borrowRequestsRouter } from './routes/borrowRequests'` and mount it right after `app.use(loansRouter)`:

```ts
app.use(loansRouter)
app.use(borrowRequestsRouter)
```

In `backend/src/routes/loans.ts`, import `ConflictError` from `'../lib/httpError'`, drop `borrowBook` from the service import, and replace the `POST /loans` handler with:

```ts
// Borrowing is a request now (POST /borrow-requests), approved by a librarian.
// Older app versions still call this route; the 409 tells their students to update.
loansRouter.post('/loans', requireAuth, validate({ body: createLoanSchema }), () => {
  throw new ConflictError("Borrowing now needs a librarian's approval. Update the SmartLib app to send a request.")
})
```

In `backend/src/services/loanService.ts`:
- Delete the `borrowBook` function.
- Replace the reservation import with `import { onBookReturned } from './reservationService'` and add `import { publishActivity } from '../lib/events'`.
- In `renewLoan`, call `publishActivity()` just before `return toLoanDto(updated, now)`.
- In `returnLoan`, call `publishActivity()` right after `await onBookReturned(loan.bookCopy.bookId, now)`.

In `backend/src/services/reservationService.ts`:
- Add `import { publishActivity } from '../lib/events'`.
- In `joinWaitlist`, call `publishActivity()` after the reservation is created, before `return toReservationDto(reservation, now)`.
- In `cancelReservation`, call `publishActivity()` after the rebalance, before the return.
- Update the two comments that name `loanService.borrowBook` so they name `borrowRequestService.createBorrowRequest` instead (`assertNotReservedForAnother` "Used by …"; `consumeClaimIfAny` "Called by … after the request holds a copy").

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/routes/borrowRequests.test.ts test/routes/loans.test.ts test/routes/reservations.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: all files pass.

- [ ] **Step 9: Hand off the commit**

```bash
git add src/config/constants.ts src/services/requestHolds.ts src/services/borrowRequestService.ts src/schemas/borrowRequests.ts src/routes/borrowRequests.ts src/app.ts src/routes/loans.ts src/services/loanService.ts src/services/reservationService.ts test/routes/borrowRequests.test.ts test/routes/loans.test.ts test/routes/reservations.test.ts
git commit -m "backend: add borrow requests and retire instant borrowing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lapsing stale requests

**Files:**
- Modify: `backend/src/services/requestHolds.ts`
- Modify: `backend/src/services/borrowRequestService.ts` (`createBorrowRequest`, `listMyBorrowRequests`)
- Modify: `backend/src/services/bookingService.ts` (`listMyBookings`)
- Modify: `backend/src/index.ts`
- Test: `backend/test/services/requestHolds.test.ts`

**Interfaces:**
- Consumes: `releaseBorrowRequest` (Task 4); `publish` (Task 2).
- Produces: `expireStaleRequests(now?: Date): Promise<number>`; `SWEEP_INTERVAL_MS = 60_000`; `startExpirySweep(sweep?: () => Promise<unknown>, intervalMs?: number): () => void`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/services/requestHolds.test.ts`:

```ts
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../src/app'
import { JWT_SECRET } from '../../src/config/constants'
import { prisma } from '../../src/lib/prisma'
import { expireStaleRequests, startExpirySweep } from '../../src/services/requestHolds'
import { resetDb } from '../helpers/db'
import { recordEvents } from '../helpers/events'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

async function seedUser() {
  const user = await prisma.user.create({ data: { name: `Student ${Math.random()}`, email: `s${Math.random()}@test.com`, passwordHash: 'x' } })
  return { user, token: jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' }) }
}

/** A book whose only copy is held by a pending request that lapses `expiresInMs` from now. */
async function heldBook(userId: string, expiresInMs: number) {
  const book = await prisma.book.create({
    data: { isbn: `isbn-${Math.random()}`, title: 'Sapiens', author: 'Yuval Noah Harari', totalCopies: 1 },
  })
  const copy = await prisma.bookCopy.create({ data: { bookId: book.id, status: 'requested' } })
  const now = Date.now()
  const held = await prisma.borrowRequest.create({
    data: {
      userId,
      bookId: book.id,
      bookCopyId: copy.id,
      requestedAt: new Date(now + expiresInMs - 24 * HOUR_MS),
      expiresAt: new Date(now + expiresInMs),
    },
  })
  return { book, copy, held }
}

/** A pending room request whose slot started `startedMsAgo` ago. */
async function roomRequest(userId: string, startedMsAgo: number) {
  const room = await prisma.resource.create({ data: { type: 'room', name: `Room ${Math.random()}` } })
  const start = new Date(Date.now() - startedMsAgo)
  return prisma.resourceBooking.create({
    data: { userId, resourceId: room.id, startTime: start, endTime: new Date(start.getTime() + HOUR_MS), status: 'requested' },
  })
}

describe('expireStaleRequests', () => {
  beforeEach(resetDb)
  let recorder: ReturnType<typeof recordEvents> | undefined
  afterEach(() => {
    recorder?.stop()
    recorder = undefined
  })

  it('lapses a borrow request after its 24 hours, freeing the copy for the waitlist', async () => {
    const { user } = await seedUser()
    const { user: waiter } = await seedUser()
    const { book, copy, held } = await heldBook(user.id, -MINUTE_MS)
    await prisma.reservation.create({ data: { userId: waiter.id, bookId: book.id, status: 'waiting' } })

    expect(await expireStaleRequests()).toBe(1)

    const after = await prisma.borrowRequest.findUniqueOrThrow({ where: { id: held.id } })
    expect(after.status).toBe('expired')
    expect(after.decidedAt).not.toBeNull()
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe('available')
    expect((await prisma.reservation.findFirstOrThrow({ where: { userId: waiter.id } })).status).toBe('fulfilled')
  })

  it('leaves a borrow request alone before its deadline', async () => {
    const { user } = await seedUser()
    const { held } = await heldBook(user.id, HOUR_MS)

    expect(await expireStaleRequests()).toBe(0)
    expect((await prisma.borrowRequest.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('pending')
  })

  it("lapses a room request once its slot's grace period has passed", async () => {
    const { user } = await seedUser()
    const stale = await roomRequest(user.id, 16 * MINUTE_MS)
    const fresh = await roomRequest(user.id, 14 * MINUTE_MS)

    expect(await expireStaleRequests()).toBe(1)

    expect((await prisma.resourceBooking.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('expired')
    expect((await prisma.resourceBooking.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('requested')
  })

  it('announces a sweep that lapsed something, once, and stays quiet otherwise', async () => {
    const { user } = await seedUser()
    await heldBook(user.id, -MINUTE_MS)
    await roomRequest(user.id, 20 * MINUTE_MS)
    recorder = recordEvents()

    await expireStaleRequests()
    await expireStaleRequests()

    expect(recorder.events).toEqual([{ type: 'request.expired', topics: ['requests'] }])
  })
})

describe('lapsing before the request paths', () => {
  beforeEach(resetDb)

  it("releases a lapsed hold before another student's request", async () => {
    const { user } = await seedUser()
    const { token } = await seedUser()
    const { book } = await heldBook(user.id, -MINUTE_MS)

    const res = await request(app).post('/borrow-requests').set('Authorization', `Bearer ${token}`).send({ bookId: book.id })

    expect(res.status).toBe(201)
  })

  it('shows lapsed requests as expired in the student lists', async () => {
    const { user, token } = await seedUser()
    await heldBook(user.id, -MINUTE_MS)
    await roomRequest(user.id, 20 * MINUTE_MS)

    const borrows = await request(app).get('/borrow-requests/me').set('Authorization', `Bearer ${token}`)
    const bookings = await request(app).get('/bookings/me').set('Authorization', `Bearer ${token}`)

    expect(borrows.body.map((r: { status: string }) => r.status)).toEqual(['expired'])
    expect(bookings.body.map((b: { frontendStatus: string }) => b.frontendStatus)).toEqual(['expired'])
  })
})

describe('startExpirySweep', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('runs once at start and then every minute until stopped', () => {
    const sweep = vi.fn().mockResolvedValue(0)

    const stop = startExpirySweep(sweep)
    expect(sweep).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(sweep).toHaveBeenCalledTimes(2)
    stop()
    vi.advanceTimersByTime(180_000)
    expect(sweep).toHaveBeenCalledTimes(2)
  })

  it('logs a failed sweep instead of crashing the server', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const stop = startExpirySweep(vi.fn().mockRejectedValue(new Error('database asleep')))

    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('Expiry sweep failed:', expect.any(Error)))
    stop()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `backend/`): `npx vitest run test/services/requestHolds.test.ts`
Expected: FAIL, `expireStaleRequests` and `startExpirySweep` are not exported.

- [ ] **Step 3: Implement lapsing and the sweep**

Append to `backend/src/services/requestHolds.ts` (and add `import { publish } from '../lib/events'` to its imports):

```ts
/**
 * Expires every pending request whose deadline has passed: a borrow request
 * 24 hours after it was made, a room request once its slot's grace period
 * has ended. Returns how many it expired, and publishes one request.expired
 * when that is more than none.
 */
export async function expireStaleRequests(now = new Date()): Promise<number> {
  const staleBorrows = await prisma.borrowRequest.findMany({
    where: { status: 'pending', expiresAt: { lte: now } },
    select: { id: true, bookId: true, bookCopyId: true },
  })
  let expired = 0
  for (const request of staleBorrows) {
    if (await releaseBorrowRequest(request, { status: 'expired', decidedAt: now })) expired += 1
  }

  // Each row's own grace period, as bookingService.computeWindow uses.
  const staleRooms = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "ResourceBooking"
    SET status = 'expired', "decidedAt" = ${now}
    WHERE status = 'requested'
      AND "startTime" + make_interval(mins => "gracePeriodMinutes") < ${now}
    RETURNING id`
  expired += staleRooms.length

  if (expired > 0) publish({ type: 'request.expired', topics: ['requests'] })
  return expired
}

export const SWEEP_INTERVAL_MS = 60_000

/**
 * Runs `sweep` now and then every SWEEP_INTERVAL_MS until the returned
 * function is called. Started by src/index.ts only, so tests never run it.
 */
export function startExpirySweep(
  sweep: () => Promise<unknown> = () => expireStaleRequests(),
  intervalMs = SWEEP_INTERVAL_MS,
): () => void {
  const run = () => {
    sweep().catch((error: unknown) => console.error('Expiry sweep failed:', error))
  }
  run()
  const timer = setInterval(run, intervalMs)
  return () => clearInterval(timer)
}
```

- [ ] **Step 4: Lapse stale requests before the request paths**

In `backend/src/services/borrowRequestService.ts`, import `expireStaleRequests` alongside `releaseBorrowRequest` from `'./requestHolds'`.
- In `createBorrowRequest`, add as the first line: `await expireStaleRequests()`.
- In `listMyBorrowRequests`, add as the first line: `await expireStaleRequests()`.

In `backend/src/services/bookingService.ts`, add `import { expireStaleRequests } from './requestHolds'`, and in `listMyBookings` call `await expireStaleRequests(now)` right after `const now = new Date()`.

- [ ] **Step 5: Start the sweep with the server**

Replace `backend/src/index.ts` with:

```ts
import 'dotenv/config'
import { app } from './app'
import { timeZoneWarning } from './config/timezone'
import { prisma } from './lib/prisma'
import { startExpirySweep } from './services/requestHolds'

const tzWarning = timeZoneWarning(process.env)
if (tzWarning) console.warn(tzWarning)

const PORT = process.env.PORT ?? 3000
const server = app.listen(PORT, () => console.log(`Node backend running on port ${PORT}`))

// Lapses stale requests now (a sleeping Render instance can wake with some
// overdue) and then every minute.
const stopExpirySweep = startExpirySweep()

// Render (like Docker) stops the old instance with SIGTERM on every deploy.
// Finish in-flight requests and release the database connections, rather
// than dropping both mid-request; give up after 10s if a connection lingers.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`)
    setTimeout(() => process.exit(1), 10_000).unref()
    stopExpirySweep()
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0))
    })
  })
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/services/requestHolds.test.ts`
Expected: PASS (8 tests).
Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all files pass.

- [ ] **Step 8: Hand off the commit**

```bash
git add src/services/requestHolds.ts src/services/borrowRequestService.ts src/services/bookingService.ts src/index.ts test/services/requestHolds.test.ts
git commit -m "backend: lapse stale requests on a one-minute sweep and before the request paths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The admin requests API

**Files:**
- Create: `backend/src/services/requestMessages.ts`
- Create: `backend/src/services/adminRequestService.ts`
- Create: `backend/src/schemas/adminRequests.ts`
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/test/routes/adminRequests.test.ts`

**Interfaces:**
- Consumes: `releaseBorrowRequest`, `expireStaleRequests` (Tasks 4–5); `graceEnd` (Task 3); `publish` (Task 2); `LOAN_PERIOD_DAYS` (existing).
- Produces: `type RequestKind = 'borrow' | 'room'`; `interface AdminRequestDto { id; kind; student: { id; name; email }; requestedAt: Date; expiresAt: Date; book?: { id; title; author; availableCopies; totalCopies }; room?: { resourceId; name; location: string | null; startTime: Date; endTime: Date } }`; `interface DecisionDto { id: string; kind: RequestKind; status: 'approved' | 'declined'; decidedAt: Date }`; `listPendingRequests(now?): Promise<{ requests: AdminRequestDto[]; counts: { all; borrow; room } }>`; `approveRequest(kind, id, adminId, now?)`; `declineRequest(kind, id, adminId, reason: string | null, now?)`; `settledMessage(settled: Settled | null, deciderName: string | null): string`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/routes/adminRequests.test.ts`:

```ts
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app'
import { JWT_SECRET } from '../../src/config/constants'
import { prisma } from '../../src/lib/prisma'
import { resetDb } from '../helpers/db'
import { recordEvents } from '../helpers/events'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

async function seedUser(role: 'student' | 'admin' = 'student', name = `${role} ${Math.random()}`) {
  const user = await prisma.user.create({
    data: { name, email: `${role}${Math.random()}@test.com`, passwordHash: 'x', role },
  })
  return { user, token: jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' }) }
}

async function seedBook(available: number, total = available) {
  const book = await prisma.book.create({
    data: { isbn: `isbn-${Math.random()}`, title: 'Clean Code', author: 'Robert C. Martin', totalCopies: total },
  })
  await prisma.bookCopy.createMany({
    data: Array.from({ length: total }, (_, i) => ({ bookId: book.id, status: i < available ? ('available' as const) : ('borrowed' as const) })),
  })
  return book
}

function tomorrowAt(hour: number) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d
}

async function askToBorrow(token: string, bookId: string): Promise<string> {
  const res = await request(app).post('/borrow-requests').set('Authorization', `Bearer ${token}`).send({ bookId })
  expect(res.status).toBe(201)
  return res.body.id
}

function requestRoom(token: string, resourceId: string, hour: number) {
  return request(app)
    .post('/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ resourceId, startTime: tomorrowAt(hour).toISOString(), endTime: tomorrowAt(hour + 1).toISOString() })
}

async function askForRoom(token: string, resourceId: string, hour = 14): Promise<string> {
  const res = await requestRoom(token, resourceId, hour)
  expect(res.status).toBe(201)
  return res.body.id
}

const approve = (token: string, kind: string, id: string) =>
  request(app).post(`/admin/requests/${kind}/${id}/approve`).set('Authorization', `Bearer ${token}`)
const decline = (token: string, kind: string, id: string, body: object = {}) =>
  request(app).post(`/admin/requests/${kind}/${id}/decline`).set('Authorization', `Bearer ${token}`).send(body)

describe('GET /admin/requests', () => {
  beforeEach(resetDb)

  it('is for admins only', async () => {
    const { token } = await seedUser()
    expect((await request(app).get('/admin/requests')).status).toBe(401)
    expect((await request(app).get('/admin/requests').set('Authorization', `Bearer ${token}`)).status).toBe(403)
  })

  it('lists pending borrow and room requests, oldest first, with counts', async () => {
    const { token: admin } = await seedUser('admin')
    const { user: aditi, token: aditiToken } = await seedUser('student', 'Aditi Sharma')
    const { user: rohan, token: rohanToken } = await seedUser('student', 'Rohan Verma')
    const book = await seedBook(2, 4)
    const room = await prisma.resource.create({ data: { type: 'room', name: 'Group Room 201', location: 'Group study rooms' } })
    const borrowId = await askToBorrow(aditiToken, book.id)
    const roomId = await askForRoom(rohanToken, room.id)

    const res = await request(app).get('/admin/requests').set('Authorization', `Bearer ${admin}`)

    expect(res.status).toBe(200)
    expect(res.body.counts).toEqual({ all: 2, borrow: 1, room: 1 })
    expect(res.body.requests[0]).toMatchObject({
      id: borrowId,
      kind: 'borrow',
      student: { id: aditi.id, name: 'Aditi Sharma', email: aditi.email },
      book: { id: book.id, title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 1, totalCopies: 4 },
    })
    expect(res.body.requests[1]).toMatchObject({
      id: roomId,
      kind: 'room',
      student: { id: rohan.id, name: 'Rohan Verma' },
      expiresAt: new Date(tomorrowAt(14).getTime() + 15 * MINUTE_MS).toISOString(),
      room: {
        resourceId: room.id,
        name: 'Group Room 201',
        location: 'Group study rooms',
        startTime: tomorrowAt(14).toISOString(),
        endTime: tomorrowAt(15).toISOString(),
      },
    })
  })
})

describe('deciding requests', () => {
  beforeEach(resetDb)
  let recorder: ReturnType<typeof recordEvents> | undefined
  afterEach(() => {
    recorder?.stop()
    recorder = undefined
  })

  it('approving a borrow request starts the loan now and marks the copy borrowed', async () => {
    const { token: admin } = await seedUser('admin')
    const { token: student } = await seedUser()
    const book = await seedBook(1)
    const id = await askToBorrow(student, book.id)
    recorder = recordEvents()

    const res = await approve(admin, 'borrow', id)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id, kind: 'borrow', status: 'approved' })
    const loans = await request(app).get('/loans/me').set('Authorization', `Bearer ${student}`)
    expect(loans.body).toHaveLength(1)
    expect(new Date(loans.body[0].dueAt).getTime() - Date.now()).toBeGreaterThan(13.9 * 24 * HOUR_MS)
    expect(await prisma.bookCopy.count({ where: { bookId: book.id, status: 'borrowed' } })).toBe(1)
    expect((await prisma.borrowRequest.findUniqueOrThrow({ where: { id } })).loanId).toBe(loans.body[0].id)
    expect(recorder.events).toEqual([{ type: 'request.decided', topics: ['requests', 'metrics'], kind: 'borrow' }])
    expect((await request(app).get('/admin/requests').set('Authorization', `Bearer ${admin}`)).body.counts.all).toBe(0)
  })

  it('declining a borrow request keeps the trimmed reason and passes the copy to the waitlist', async () => {
    const { token: admin } = await seedUser('admin')
    const { token: student } = await seedUser()
    const { user: waiter } = await seedUser()
    const book = await seedBook(1)
    const id = await askToBorrow(student, book.id)
    await prisma.reservation.create({ data: { userId: waiter.id, bookId: book.id, status: 'waiting' } })
    recorder = recordEvents()

    const res = await decline(admin, 'borrow', id, { reason: '  Reserved for a course  ' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('declined')
    const mine = await request(app).get('/borrow-requests/me').set('Authorization', `Bearer ${student}`)
    expect(mine.body[0]).toMatchObject({ status: 'declined', declineReason: 'Reserved for a course' })
    expect((await prisma.reservation.findFirstOrThrow({ where: { userId: waiter.id } })).status).toBe('fulfilled')
    expect(recorder.events).toEqual([{ type: 'request.decided', topics: ['requests'], kind: 'borrow' }])
  })

  it('treats a blank reason as none, and refuses one over 300 characters', async () => {
    const { token: admin } = await seedUser('admin')
    const { token: student } = await seedUser()
    const first = await askToBorrow(student, (await seedBook(1)).id)
    const second = await askToBorrow(student, (await seedBook(1)).id)

    expect((await decline(admin, 'borrow', first, { reason: '   ' })).status).toBe(200)
    expect((await prisma.borrowRequest.findUniqueOrThrow({ where: { id: first } })).declineReason).toBeNull()
    expect((await decline(admin, 'borrow', second, { reason: 'x'.repeat(301) })).status).toBe(400)
  })

  it('approving a room request books the slot; declining one frees it', async () => {
    const { token: admin } = await seedUser('admin')
    const { token: student } = await seedUser()
    const { token: other } = await seedUser()
    const room = await prisma.resource.create({ data: { type: 'room', name: 'Group Room 201' } })
    const approvedId = await askForRoom(student, room.id, 10)
    const declinedId = await askForRoom(student, room.id, 14)
    recorder = recordEvents()

    expect((await approve(admin, 'room', approvedId)).status).toBe(200)
    expect((await decline(admin, 'room', declinedId)).status).toBe(200)

    const mine = await request(app).get('/bookings/me').set('Authorization', `Bearer ${student}`)
    expect(mine.body.map((b: { frontendStatus: string }) => b.frontendStatus)).toEqual(['upcomingFar', 'declined'])
    expect((await requestRoom(other, room.id, 14)).status).toBe(201)
    expect((await requestRoom(other, room.id, 10)).status).toBe(409)
    expect(recorder.events.slice(0, 2)).toEqual([
      { type: 'request.decided', topics: ['requests', 'metrics'], kind: 'room' },
      { type: 'request.decided', topics: ['requests'], kind: 'room' },
    ])
  })

  it('two librarians approving at once: one wins, the other is told who', async () => {
    const { token: a } = await seedUser('admin', 'Librarian A')
    const { token: b } = await seedUser('admin', 'Librarian B')
    const { token: student } = await seedUser()
    const id = await askToBorrow(student, (await seedBook(1)).id)

    const results = await Promise.all([approve(a, 'borrow', id), approve(b, 'borrow', id)])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(results.find((r) => r.status === 409)!.body.error).toMatch(/^Already approved by Librarian (A|B)\.$/)
    expect(await prisma.loan.count()).toBe(1)
  })

  it('deciding a settled request says what happened', async () => {
    const { token: admin } = await seedUser('admin', 'Librarian One')
    const { token: student } = await seedUser()
    const approvedId = await askToBorrow(student, (await seedBook(1)).id)
    const declinedId = await askToBorrow(student, (await seedBook(1)).id)
    const withdrawnId = await askToBorrow(student, (await seedBook(1)).id)
    await approve(admin, 'borrow', approvedId)
    await decline(admin, 'borrow', declinedId)
    await request(app).post(`/borrow-requests/${withdrawnId}/cancel`).set('Authorization', `Bearer ${student}`)

    expect((await decline(admin, 'borrow', approvedId)).body.error).toBe('Already approved by Librarian One.')
    expect((await approve(admin, 'borrow', declinedId)).body.error).toBe('Already declined by Librarian One.')
    expect((await approve(admin, 'borrow', withdrawnId)).body.error).toBe('The student withdrew this request.')
  })

  it('approving after the deadline lapses the request instead', async () => {
    const { token: admin } = await seedUser('admin')
    const { user } = await seedUser()
    const book = await prisma.book.create({ data: { isbn: `isbn-${Math.random()}`, title: 'Sapiens', author: 'Harari', totalCopies: 1 } })
    const copy = await prisma.bookCopy.create({ data: { bookId: book.id, status: 'requested' } })
    const lapsed = await prisma.borrowRequest.create({
      data: { userId: user.id, bookId: book.id, bookCopyId: copy.id, requestedAt: new Date(Date.now() - 25 * HOUR_MS), expiresAt: new Date(Date.now() - HOUR_MS) },
    })
    const room = await prisma.resource.create({ data: { type: 'room', name: 'Room 9' } })
    const start = new Date(Date.now() - 20 * MINUTE_MS)
    const lapsedRoom = await prisma.resourceBooking.create({
      data: { userId: user.id, resourceId: room.id, startTime: start, endTime: new Date(start.getTime() + HOUR_MS), status: 'requested' },
    })

    const borrow = await approve(admin, 'borrow', lapsed.id)
    const roomRes = await approve(admin, 'room', lapsedRoom.id)

    expect([borrow.status, borrow.body.error]).toEqual([409, 'This request expired.'])
    expect([roomRes.status, roomRes.body.error]).toEqual([409, 'This request expired.'])
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe('available')
    expect((await prisma.resourceBooking.findUniqueOrThrow({ where: { id: lapsedRoom.id } })).status).toBe('expired')
    expect(await prisma.loan.count()).toBe(0)
  })

  it('answers 404 for an unknown request or a seat booking, and 400 for an unknown kind', async () => {
    const { token: admin } = await seedUser('admin')
    const { user } = await seedUser()
    const seat = await prisma.resource.create({ data: { type: 'seat', name: 'Desk 1' } })
    const seatBooking = await prisma.resourceBooking.create({
      data: { userId: user.id, resourceId: seat.id, startTime: tomorrowAt(9), endTime: tomorrowAt(10) },
    })

    const unknown = await approve(admin, 'borrow', 'no-such-request')
    expect([unknown.status, unknown.body.error]).toEqual([404, 'Request not found'])
    expect((await approve(admin, 'room', seatBooking.id)).status).toBe(404)
    expect((await approve(admin, 'loan', 'x')).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `backend/`): `npx vitest run test/routes/adminRequests.test.ts`
Expected: FAIL. `/admin/requests` answers 404 for an admin (no route yet), so every test after the access check fails.

- [ ] **Step 3: Write the settled-request wording**

Create `backend/src/services/requestMessages.ts`:

```ts
// What a librarian is told when their decision lands on a request that was
// already settled: by another librarian, by the student, or by the deadline.

export type Settled = 'approved' | 'declined' | 'expired' | 'withdrawn'

export function settledMessage(settled: Settled | null, deciderName: string | null): string {
  switch (settled) {
    case 'approved':
      return deciderName ? `Already approved by ${deciderName}.` : 'This request was already approved.'
    case 'declined':
      return deciderName ? `Already declined by ${deciderName}.` : 'This request was already declined.'
    case 'expired':
      return 'This request expired.'
    case 'withdrawn':
      return 'The student withdrew this request.'
    default:
      return 'This request is no longer pending.'
  }
}
```

- [ ] **Step 4: Implement the admin request service**

Create `backend/src/services/adminRequestService.ts`:

```ts
// The librarian's side of requests: the pending queue, and approving or
// declining a borrow or room request. Every decision is a conditional update
// on the pending status, so of two librarians deciding at once only the first
// lands; the second is told what happened (requestMessages.ts).
import { LOAN_PERIOD_DAYS } from '../config/constants'
import { publish } from '../lib/events'
import { ConflictError, NotFoundError } from '../lib/httpError'
import { prisma } from '../lib/prisma'
import { graceEnd } from './bookingService'
import { expireStaleRequests, releaseBorrowRequest } from './requestHolds'
import { settledMessage, type Settled } from './requestMessages'

export type RequestKind = 'borrow' | 'room'

export interface AdminRequestDto {
  id: string
  kind: RequestKind
  student: { id: string; name: string; email: string }
  requestedAt: Date
  expiresAt: Date
  book?: { id: string; title: string; author: string; availableCopies: number; totalCopies: number }
  room?: { resourceId: string; name: string; location: string | null; startTime: Date; endTime: Date }
}

export interface DecisionDto {
  id: string
  kind: RequestKind
  status: 'approved' | 'declined'
  decidedAt: Date
}

const DAY_MS = 24 * 60 * 60 * 1000
const studentFields = { select: { id: true, name: true, email: true } } as const

export async function listPendingRequests(
  now = new Date(),
): Promise<{ requests: AdminRequestDto[]; counts: { all: number; borrow: number; room: number } }> {
  await expireStaleRequests(now)
  const [borrows, rooms] = await Promise.all([
    prisma.borrowRequest.findMany({
      where: { status: 'pending' },
      include: { user: studentFields, book: { select: { id: true, title: true, author: true, totalCopies: true } } },
    }),
    prisma.resourceBooking.findMany({
      where: { status: 'requested' },
      include: { user: studentFields, resource: { select: { id: true, name: true, location: true } } },
    }),
  ])

  const bookIds = [...new Set(borrows.map((b) => b.bookId))]
  const available =
    bookIds.length === 0
      ? []
      : await prisma.bookCopy.groupBy({ by: ['bookId'], where: { bookId: { in: bookIds }, status: 'available' }, _count: true })
  const availableByBook = new Map(available.map((g) => [g.bookId, g._count]))

  const requests: AdminRequestDto[] = [
    ...borrows.map((b) => ({
      id: b.id,
      kind: 'borrow' as const,
      student: b.user,
      requestedAt: b.requestedAt,
      expiresAt: b.expiresAt,
      book: {
        id: b.book.id,
        title: b.book.title,
        author: b.book.author,
        availableCopies: availableByBook.get(b.bookId) ?? 0,
        totalCopies: b.book.totalCopies,
      },
    })),
    ...rooms.map((r) => ({
      id: r.id,
      kind: 'room' as const,
      student: r.user,
      requestedAt: r.requestedAt,
      expiresAt: graceEnd(r),
      room: { resourceId: r.resource.id, name: r.resource.name, location: r.resource.location, startTime: r.startTime, endTime: r.endTime },
    })),
  ].sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime())

  return { requests, counts: { all: requests.length, borrow: borrows.length, room: rooms.length } }
}

// --- Borrow requests ---------------------------------------------------------

async function findBorrow(id: string) {
  const request = await prisma.borrowRequest.findUnique({ where: { id }, include: { decidedBy: { select: { name: true } } } })
  if (!request) throw new NotFoundError('Request')
  return request
}

function borrowSettled(status: string): Settled | null {
  switch (status) {
    case 'approved':
      return 'approved'
    case 'declined':
      return 'declined'
    case 'expired':
      return 'expired'
    case 'cancelled':
      return 'withdrawn'
    default:
      return null
  }
}

async function refuseSettledBorrow(id: string): Promise<never> {
  const current = await findBorrow(id)
  throw new ConflictError(settledMessage(borrowSettled(current.status), current.decidedBy?.name ?? null))
}

async function refuseIfBorrowLapsed(request: { id: string; bookId: string; bookCopyId: string; expiresAt: Date }, now: Date) {
  if (request.expiresAt > now) return
  if (await releaseBorrowRequest(request, { status: 'expired', decidedAt: now })) {
    publish({ type: 'request.expired', topics: ['requests'] })
  }
  throw new ConflictError('This request expired.')
}

async function approveBorrow(id: string, adminId: string, now: Date): Promise<DecisionDto> {
  const request = await findBorrow(id)
  if (request.status !== 'pending') return refuseSettledBorrow(id)
  await refuseIfBorrowLapsed(request, now)

  const approved = await prisma.$transaction(async (tx) => {
    const { count } = await tx.borrowRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'approved', decidedAt: now, decidedById: adminId },
    })
    if (count === 0) return false
    // The loan starts now: approval is the moment the student gets the book.
    const loan = await tx.loan.create({
      data: { userId: request.userId, bookCopyId: request.bookCopyId, borrowedAt: now, dueAt: new Date(now.getTime() + LOAN_PERIOD_DAYS * DAY_MS) },
    })
    await tx.bookCopy.update({ where: { id: request.bookCopyId }, data: { status: 'borrowed' } })
    await tx.borrowRequest.update({ where: { id }, data: { loanId: loan.id } })
    return true
  })
  if (!approved) return refuseSettledBorrow(id)

  publish({ type: 'request.decided', topics: ['requests', 'metrics'], kind: 'borrow' })
  return { id, kind: 'borrow', status: 'approved', decidedAt: now }
}

async function declineBorrow(id: string, adminId: string, reason: string | null, now: Date): Promise<DecisionDto> {
  const request = await findBorrow(id)
  if (request.status !== 'pending') return refuseSettledBorrow(id)
  await refuseIfBorrowLapsed(request, now)

  const declined = await releaseBorrowRequest(request, { status: 'declined', decidedAt: now, decidedById: adminId, declineReason: reason })
  if (!declined) return refuseSettledBorrow(id)

  publish({ type: 'request.decided', topics: ['requests'], kind: 'borrow' })
  return { id, kind: 'borrow', status: 'declined', decidedAt: now }
}

// --- Room requests -----------------------------------------------------------

async function findRoom(id: string) {
  const booking = await prisma.resourceBooking.findUnique({
    where: { id },
    include: { resource: { select: { type: true } }, decidedBy: { select: { name: true } } },
  })
  // A seat booking is never a request.
  if (!booking || booking.resource.type !== 'room') throw new NotFoundError('Request')
  return booking
}

function roomSettled(booking: { status: string; decidedById: string | null }): Settled | null {
  if (booking.status === 'declined') return 'declined'
  if (booking.status === 'expired') return 'expired'
  // Approved, whatever happened to the booking since (checked in, cancelled...).
  if (booking.decidedById !== null) return 'approved'
  if (booking.status === 'cancelled') return 'withdrawn'
  return null
}

async function refuseSettledRoom(id: string): Promise<never> {
  const current = await findRoom(id)
  throw new ConflictError(settledMessage(roomSettled(current), current.decidedBy?.name ?? null))
}

async function refuseIfRoomLapsed(booking: { id: string; startTime: Date; gracePeriodMinutes: number }, now: Date) {
  if (now <= graceEnd(booking)) return
  const { count } = await prisma.resourceBooking.updateMany({
    where: { id: booking.id, status: 'requested' },
    data: { status: 'expired', decidedAt: now },
  })
  if (count > 0) publish({ type: 'request.expired', topics: ['requests'] })
  throw new ConflictError('This request expired.')
}

async function approveRoom(id: string, adminId: string, now: Date): Promise<DecisionDto> {
  const booking = await findRoom(id)
  if (booking.status !== 'requested') return refuseSettledRoom(id)
  await refuseIfRoomLapsed(booking, now)

  const { count } = await prisma.resourceBooking.updateMany({
    where: { id, status: 'requested' },
    data: { status: 'booked', decidedAt: now, decidedById: adminId },
  })
  if (count === 0) return refuseSettledRoom(id)

  publish({ type: 'request.decided', topics: ['requests', 'metrics'], kind: 'room' })
  return { id, kind: 'room', status: 'approved', decidedAt: now }
}

async function declineRoom(id: string, adminId: string, reason: string | null, now: Date): Promise<DecisionDto> {
  const booking = await findRoom(id)
  if (booking.status !== 'requested') return refuseSettledRoom(id)
  await refuseIfRoomLapsed(booking, now)

  const { count } = await prisma.resourceBooking.updateMany({
    where: { id, status: 'requested' },
    data: { status: 'declined', decidedAt: now, decidedById: adminId, declineReason: reason },
  })
  if (count === 0) return refuseSettledRoom(id)

  publish({ type: 'request.decided', topics: ['requests'], kind: 'room' })
  return { id, kind: 'room', status: 'declined', decidedAt: now }
}

export function approveRequest(kind: RequestKind, id: string, adminId: string, now = new Date()): Promise<DecisionDto> {
  return kind === 'borrow' ? approveBorrow(id, adminId, now) : approveRoom(id, adminId, now)
}

export function declineRequest(
  kind: RequestKind,
  id: string,
  adminId: string,
  reason: string | null,
  now = new Date(),
): Promise<DecisionDto> {
  return kind === 'borrow' ? declineBorrow(id, adminId, reason, now) : declineRoom(id, adminId, reason, now)
}
```

- [ ] **Step 5: Add the schemas and routes**

Create `backend/src/schemas/adminRequests.ts`:

```ts
import { z } from 'zod'

export const adminRequestParamsSchema = z.object({
  kind: z.enum(['borrow', 'room']),
  id: z.string().min(1),
})

// Optional and trimmed; the route turns an empty reason into none.
export const declineRequestSchema = z.object({ reason: z.string().trim().max(300).optional() })
```

In `backend/src/routes/admin.ts`, add the imports:

```ts
import { validate } from '../middleware/validate'
import { adminRequestParamsSchema, declineRequestSchema } from '../schemas/adminRequests'
import { approveRequest, declineRequest, listPendingRequests, type RequestKind } from '../services/adminRequestService'
```

and append the routes:

```ts
adminRouter.get('/admin/requests', async (req, res) => {
  res.json(await listPendingRequests())
})

adminRouter.post('/admin/requests/:kind/:id/approve', validate({ params: adminRequestParamsSchema }), async (req, res) => {
  const { kind, id } = req.params as { kind: RequestKind; id: string }
  res.json(await approveRequest(kind, id, req.user!.sub))
})

adminRouter.post(
  '/admin/requests/:kind/:id/decline',
  validate({ params: adminRequestParamsSchema, body: declineRequestSchema }),
  async (req, res) => {
    const { kind, id } = req.params as { kind: RequestKind; id: string }
    const { reason } = req.body as { reason?: string }
    res.json(await declineRequest(kind, id, req.user!.sub, reason ? reason : null))
  },
)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/routes/adminRequests.test.ts`
Expected: PASS (11 tests).
Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all files pass.

- [ ] **Step 8: Hand off the commit**

```bash
git add src/services/requestMessages.ts src/services/adminRequestService.ts src/schemas/adminRequests.ts src/routes/admin.ts test/routes/adminRequests.test.ts
git commit -m "backend: add the admin request queue with approve and decline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The live event stream and the backend docs

**Files:**
- Create: `backend/src/lib/liveStream.ts`
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/README.md`
- Test: `backend/test/lib/liveStream.test.ts`, `backend/test/routes/adminEvents.test.ts`

**Interfaces:**
- Consumes: `subscribe`, `publish`, `subscriberCount` (Task 2).
- Produces: `RETRY_MS = 5_000`, `HEARTBEAT_MS = 25_000`, `MAX_STREAM_MS = 900_000`; `interface StreamResponse`; `openLiveStream(res: StreamResponse): void`; `closeAllLiveStreams(): void`; route `GET /admin/events`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/lib/liveStream.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publish, subscriberCount } from '../../src/lib/events'
import { closeAllLiveStreams, openLiveStream } from '../../src/lib/liveStream'

/** The parts of an Express response the stream uses. */
class FakeResponse extends EventEmitter {
  statusCode = 0
  headers: Record<string, string> = {}
  flushed = false
  chunks: string[] = []
  ended = false
  status(code: number) {
    this.statusCode = code
    return this
  }
  set(headers: Record<string, string>) {
    Object.assign(this.headers, headers)
    return this
  }
  flushHeaders() {
    this.flushed = true
  }
  write(chunk: string) {
    this.chunks.push(chunk)
    return true
  }
  end() {
    this.ended = true
    this.emit('close')
  }
}

describe('openLiveStream', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    closeAllLiveStreams()
    vi.useRealTimers()
  })

  it('opens with the SSE headers, a retry hint and a ready event', () => {
    const res = new FakeResponse()
    openLiveStream(res)
    expect(res.statusCode).toBe(200)
    expect(res.headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    })
    expect(res.flushed).toBe(true)
    expect(res.chunks).toEqual(['retry: 5000\n\n', 'event: ready\ndata: {}\n\n'])
  })

  it('writes each published event with its type as the event name', () => {
    const res = new FakeResponse()
    openLiveStream(res)
    publish({ type: 'request.created', topics: ['requests'], kind: 'borrow', summary: 'Aditi Sharma wants to borrow Clean Code' })
    publish({ type: 'activity', topics: ['metrics'] })
    expect(res.chunks.slice(2)).toEqual([
      'event: request.created\ndata: {"topics":["requests"],"kind":"borrow","summary":"Aditi Sharma wants to borrow Clean Code"}\n\n',
      'event: activity\ndata: {"topics":["metrics"]}\n\n',
    ])
  })

  it('sends a heartbeat every 25 seconds', () => {
    const res = new FakeResponse()
    openLiveStream(res)
    vi.advanceTimersByTime(25_000)
    expect(res.chunks.at(-1)).toBe(': ping\n\n')
  })

  it('ends the stream after 15 minutes and stops listening', () => {
    const res = new FakeResponse()
    openLiveStream(res)
    vi.advanceTimersByTime(15 * 60_000)
    expect(res.ended).toBe(true)
    expect(subscriberCount()).toBe(0)
  })

  it('stops listening and writing when the console goes away', () => {
    const res = new FakeResponse()
    openLiveStream(res)
    res.emit('close')
    expect(subscriberCount()).toBe(0)
    const written = res.chunks.length
    vi.advanceTimersByTime(60_000)
    expect(res.chunks).toHaveLength(written)
  })

  it('closeAllLiveStreams ends every open stream', () => {
    const a = new FakeResponse()
    const b = new FakeResponse()
    openLiveStream(a)
    openLiveStream(b)
    closeAllLiveStreams()
    expect([a.ended, b.ended]).toEqual([true, true])
    expect(subscriberCount()).toBe(0)
  })
})
```

Create `backend/test/routes/adminEvents.test.ts`:

```ts
import type { AddressInfo } from 'node:net'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../src/app'
import { JWT_SECRET } from '../../src/config/constants'
import { publish, subscriberCount } from '../../src/lib/events'
import { prisma } from '../../src/lib/prisma'
import { resetDb } from '../helpers/db'

async function tokenFor(role: 'student' | 'admin') {
  const user = await prisma.user.create({
    data: { name: role, email: `${role}${Math.random()}@test.com`, passwordHash: 'x', role },
  })
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' })
}

describe('GET /admin/events', () => {
  beforeEach(resetDb)

  it('refuses a request without a token (401) and a student (403)', async () => {
    expect((await request(app).get('/admin/events')).status).toBe(401)
    expect((await request(app).get('/admin/events').set('Authorization', `Bearer ${await tokenFor('student')}`)).status).toBe(403)
  })

  it('streams published events to an admin until the console disconnects', async () => {
    const token = await tokenFor('admin')
    const server = app.listen(0)
    const { port } = server.address() as AddressInfo
    const controller = new AbortController()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/admin/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      const readUntil = async (marker: string) => {
        while (!text.includes(marker)) {
          const { value, done } = await reader.read()
          if (done) throw new Error(`The stream ended before "${marker}"`)
          text += decoder.decode(value, { stream: true })
        }
      }

      await readUntil('event: ready')
      publish({ type: 'request.created', topics: ['requests'], kind: 'room', summary: 'Rohan Verma wants Group Room 201' })
      await readUntil('Rohan Verma')
      expect(text).toContain(
        'event: request.created\ndata: {"topics":["requests"],"kind":"room","summary":"Rohan Verma wants Group Room 201"}\n\n',
      )

      controller.abort()
      await vi.waitFor(() => expect(subscriberCount()).toBe(0))
    } finally {
      controller.abort()
      server.closeAllConnections()
      server.close()
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `backend/`): `npx vitest run test/lib/liveStream.test.ts test/routes/adminEvents.test.ts`
Expected: FAIL. `../../src/lib/liveStream` can't be resolved, and `GET /admin/events` answers 404 for an admin.

- [ ] **Step 3: Implement the stream**

Create `backend/src/lib/liveStream.ts`:

```ts
// One admin console's live connection: the event bus (lib/events.ts) written
// to an HTTP response as Server-Sent Events.
import { subscribe } from './events'

export const RETRY_MS = 5_000
export const HEARTBEAT_MS = 25_000
/** Each stream ends after this long; the console reconnects, re-checking its token and role. */
export const MAX_STREAM_MS = 15 * 60_000

/** The parts of an Express response a stream uses (a fake in the unit tests). */
export interface StreamResponse {
  status(code: number): unknown
  set(headers: Record<string, string>): unknown
  flushHeaders(): void
  write(chunk: string): boolean
  end(): void
  on(event: 'close', listener: () => void): unknown
}

const open = new Set<StreamResponse>()

export function openLiveStream(res: StreamResponse): void {
  res.status(200)
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Asks any buffering proxy in between to pass each event straight through.
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  res.write(`retry: ${RETRY_MS}\n\n`)
  res.write('event: ready\ndata: {}\n\n')
  open.add(res)

  const unsubscribe = subscribe(({ type, ...rest }) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`)
  })
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  const maxAge = setTimeout(() => res.end(), MAX_STREAM_MS)

  res.on('close', () => {
    clearInterval(heartbeat)
    clearTimeout(maxAge)
    unsubscribe()
    open.delete(res)
  })
}

/** Ends every open stream (on shutdown), so the HTTP server can close. */
export function closeAllLiveStreams(): void {
  for (const res of [...open]) res.end()
}
```

In `backend/src/routes/admin.ts`, add `import { openLiveStream } from '../lib/liveStream'` and append:

```ts
// Live updates for the console, as Server-Sent Events (lib/liveStream.ts).
adminRouter.get('/admin/events', (req, res) => {
  openLiveStream(res)
})
```

In `backend/src/index.ts`, add `import { closeAllLiveStreams } from './lib/liveStream'` and, in the shutdown handler, call it right after `stopExpirySweep()`:

```ts
    stopExpirySweep()
    // An open console stream would hold server.close() open until its 15
    // minutes are up, and Render would kill the process mid-shutdown.
    closeAllLiveStreams()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/liveStream.test.ts test/routes/adminEvents.test.ts`
Expected: PASS (8 tests).
Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 5: Document approvals, the stream and the migrations**

In `backend/README.md`:

1. In the *Endpoints* table, replace the `POST /loans` row and the three `/bookings` rows that change, and add the new rows:

```markdown
| POST | `/loans` | ✓ | Retired: answers 409 asking older app versions to update (borrowing is a request now) |
| POST | `/borrow-requests` | ✓ | Ask to borrow a book (`{ bookId }`); holds one copy for 24 hours |
| GET | `/borrow-requests/me` | ✓ | Your pending requests, and those declined or expired in the last 7 days |
| POST | `/borrow-requests/:id/cancel` | ✓ | Withdraw a pending request |
```

```markdown
| POST | `/bookings` | ✓ | Book a seat, or request a room (`{ resourceId, startTime, endTime }`); 409 + alternatives on conflict |
| GET | `/bookings/me` | ✓ | Your bookings and room requests, with computed grace-window status |
| POST | `/bookings/:id/cancel` | ✓ | Cancel before check-in, or withdraw a room request |
```

and, after the `/admin/metrics/demand` row:

```markdown
| GET | `/admin/requests` | admin | Pending borrow and room requests, oldest first, with counts |
| POST | `/admin/requests/:kind/:id/approve` | admin | Approve (`kind` is `borrow` or `room`); 409 if it was already settled |
| POST | `/admin/requests/:kind/:id/decline` | admin | Decline, with an optional `{ reason }` (up to 300 characters) |
| GET | `/admin/events` | admin | Live updates for the console, as Server-Sent Events |
```

2. Add these two sections before *Response shape*:

````markdown
## Request approvals

Borrowing a book and booking a room are requests that a librarian approves in
the admin console. Seats, renewals, returns, check-ins and the waitlist are
instant.

- A borrow request holds one copy (copy status `requested`) for 24 hours. A
  room request holds its slot (booking status `requested`, covered by the
  exclusion constraint) until the slot's 15-minute grace period ends.
- Approving a borrow request creates the loan, so its 14 days start then.
  Declining it, letting it lapse, or the student withdrawing it frees the copy
  and runs the waitlist cascade.
- Lapsed requests are expired by a sweep that runs at startup and every minute
  (`src/services/requestHolds.ts`), and before the request paths read or write.
- Students see declined and expired requests for 7 days.

## Live events

`GET /admin/events` streams Server-Sent Events to the admin console: `ready` on
connect, then one event per change:

```
event: request.created
data: {"topics":["requests"],"kind":"borrow","summary":"Aditi Sharma wants to borrow Clean Code"}
```

Events name what changed (`requests`, `metrics`), never the new state: the
console refetches. A `: ping` comment goes out every 25 seconds, and each
stream ends after 15 minutes, so the console reconnects and its token and role
are checked again.

The bus is in-process (`src/lib/events.ts`). That reaches every console while
one instance serves the API, as on Render's free plan; several instances would
need a shared bus such as Redis pub/sub.
````

3. In *Database migration*, change the command to `npx prisma migrate deploy`, update the exclusion-constraint SQL so its last line reads `) WHERE (status IN ('requested', 'booked', 'checked_in'));`, and replace the paragraph that begins "The one migration in `prisma/migrations/`" with:

```markdown
Some migrations carry hand-written SQL that Prisma's schema language can't
express: the `EXCLUDE` constraint below (rewritten in
`20261020120100_request_approvals` so pending room requests hold their slot)
and a partial unique index allowing one pending borrow request per student and
title. Create new migrations with `npx prisma migrate dev --create-only` and
read the SQL before applying it. Prisma doesn't model these two, so a
generated migration may try to drop them.
```

4. In `backend/CLAUDE.md`, *Critical Database Constraint*: change the SQL's last line to `) WHERE (status IN ('requested', 'booked', 'checked_in'));`, and add after the numbered list:

```markdown
A pending room request (`requested`) holds its slot. `BorrowRequest` also
carries a hand-written partial unique index, `BorrowRequest_one_pending_per_title`.
Check every generated migration for a `DROP` of either before applying it.
```

and add a section before *Code Organization*:

```markdown
## Live Events

Every write that changes requests or Dashboard numbers publishes an event once
it has committed (`src/lib/events.ts`: `publish`, or `publishActivity()` for a
change that only moves Dashboard numbers). `GET /admin/events` streams them to
the admin console. A new mutation the console should see must publish one,
with a test using `recordEvents()` from `test/helpers/events.ts`.
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all files pass.

- [ ] **Step 7: Hand off the commit**

```bash
git add src/lib/liveStream.ts src/routes/admin.ts src/index.ts README.md CLAUDE.md test/lib/liveStream.test.ts test/routes/adminEvents.test.ts
git commit -m "backend: stream live events to the admin console" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Console request API and formatting

**Files:**
- Modify: `admin/lib/api.ts`
- Modify: `admin/lib/format.ts`
- Create: `admin/lib/requests.ts`
- Create: `admin/docs/2026-10-20-request-approvals-design.md`, `admin/docs/2026-10-20-request-approvals.md` (copies)
- Test: `admin/test/lib/api.test.ts`, `admin/test/lib/format.test.ts`, `admin/test/lib/requests.test.ts` (new)

**Interfaces:**
- Consumes: the backend endpoints from Task 6.
- Produces: `endSession(reason: SessionEndReason): void` (`lib/api.ts`); `LIBRARY_TIMEZONE`, `waitingLabel(ms: number): string`, `clockTime(iso: string, timeZone: string): string`, `timeSpan(startIso: string, endIso: string, timeZone: string): string`, `shortDay(iso: string, timeZone: string): string` (`lib/format.ts`); `type RequestKind = 'borrow' | 'room'`, `interface PendingRequest`, `interface PendingRequests { requests: PendingRequest[]; counts: { all: number; borrow: number; room: number } }`, `fetchPendingRequests()`, `approveRequest(r: Pick<PendingRequest, 'kind' | 'id'>)`, `declineRequest(r: Pick<PendingRequest, 'kind' | 'id'>, reason: string)` (`lib/requests.ts`).

- [ ] **Step 1: Copy the design documents into the repository**

Run (in `admin/`):

```bash
cp ../docs/superpowers/specs/2026-10-20-request-approvals-design.md docs/
cp ../docs/superpowers/plans/2026-10-20-request-approvals.md docs/
```

- [ ] **Step 2: Write the failing tests**

In `admin/test/lib/api.test.ts`, add `endSession` to the `@/lib/api` import and, inside `describe('apiRequest', ...)`, add:

```ts
  it('endSession clears the token and says why the session ended', () => {
    writeToken('t')
    const ended = listenForSessionEnd()
    endSession('not-admin')
    expect(readToken()).toBeNull()
    expect(ended.reasons).toEqual(['not-admin'])
    ended.stop()
  })
```

In `admin/test/lib/format.test.ts`, add `clockTime, shortDay, timeSpan, waitingLabel` to the `@/lib/format` import and append:

```ts
describe('waitingLabel', () => {
  it('rounds a wait down to minutes, hours or days', () => {
    expect(waitingLabel(30_000)).toBe('less than a minute')
    expect(waitingLabel(-5_000)).toBe('less than a minute')
    expect(waitingLabel(12 * 60_000 + 59_000)).toBe('12 min')
    expect(waitingLabel(3 * 3_600_000 + 59 * 60_000)).toBe('3 h')
    expect(waitingLabel(2 * 86_400_000 + 3_600_000)).toBe('2 d')
  })
})

describe('library times', () => {
  const TZ = 'Asia/Kolkata'

  it('shows a slot in the library time zone', () => {
    expect(timeSpan('2026-10-22T08:30:00.000Z', '2026-10-22T09:30:00.000Z', TZ)).toBe('2–3 PM')
    expect(timeSpan('2026-10-22T05:30:00.000Z', '2026-10-22T06:30:00.000Z', TZ)).toBe('11 AM–12 PM')
    expect(timeSpan('2026-10-22T09:00:00.000Z', '2026-10-22T10:00:00.000Z', TZ)).toBe('2:30–3:30 PM')
  })

  it('shows a clock time and a short day', () => {
    expect(clockTime('2026-10-22T08:45:00.000Z', TZ)).toBe('2:15 PM')
    expect(shortDay('2026-10-22T08:30:00.000Z', TZ)).toBe('Thu, Oct 22')
  })
})
```

Create `admin/test/lib/requests.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { writeToken } from '@/lib/api'
import { approveRequest, declineRequest, fetchPendingRequests } from '@/lib/requests'
import { json, mockFetch } from '../helpers'

const NONE = { requests: [], counts: { all: 0, borrow: 0, room: 0 } }

describe('request API', () => {
  it('fetches the pending requests with the token', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/requests': () => json(200, NONE) })
    await expect(fetchPendingRequests()).resolves.toEqual(NONE)
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
  })

  it('approves by kind and id, with no body', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'POST /admin/requests/borrow/br-1/approve': () => json(200, { id: 'br-1', kind: 'borrow', status: 'approved' }),
    })
    await approveRequest({ kind: 'borrow', id: 'br-1' })
    expect(fetch.mock.calls[0][1]!.body).toBeUndefined()
  })

  it('sends a trimmed reason, and none when it is blank', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'POST /admin/requests/room/bk-1/decline': () => json(200, { id: 'bk-1', kind: 'room', status: 'declined' }),
    })
    await declineRequest({ kind: 'room', id: 'bk-1' }, '  Reserved for an event  ')
    await declineRequest({ kind: 'room', id: 'bk-1' }, '   ')
    expect(fetch.mock.calls[0][1]!.body).toBe('{"reason":"Reserved for an event"}')
    expect(fetch.mock.calls[1][1]!.body).toBe('{}')
  })

  it("passes on the server's refusal", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/requests/borrow/br-1/approve': () => json(409, { error: 'Already approved by Librarian One.' }) })
    await expect(approveRequest({ kind: 'borrow', id: 'br-1' })).rejects.toMatchObject({
      status: 409,
      message: 'Already approved by Librarian One.',
    })
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run (in `admin/`): `npx vitest run test/lib/api.test.ts test/lib/format.test.ts test/lib/requests.test.ts`
Expected: FAIL. `endSession`, the new format functions and `@/lib/requests` don't exist.

- [ ] **Step 4: Implement**

In `admin/lib/api.ts`, add after `clearToken`:

```ts
/** Clears the token and tells ConsoleGuard why the session ended; it sends the user to /login. */
export function endSession(reason: SessionEndReason): void {
  clearToken()
  window.dispatchEvent(new CustomEvent<SessionEndReason>(SESSION_ENDED_EVENT, { detail: reason }))
}
```

and in `apiRequest` replace the session-ending block with:

```ts
    if (token && (res.status === 401 || res.status === 403)) {
      endSession(res.status === 401 ? 'expired' : 'not-admin')
    }
```

Append to `admin/lib/format.ts`:

```ts
/** The library's time zone, for every date and time the console shows. */
export const LIBRARY_TIMEZONE = process.env.NEXT_PUBLIC_LIBRARY_TIMEZONE ?? 'Asia/Kolkata'

/** "less than a minute", "12 min", "3 h", "2 d": how long something has waited, or has left. */
export function waitingLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

function clockParts(iso: string, timeZone: string): { hour: number; minute: number; meridiem: 'AM' | 'PM' } {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { hour: Number(part('hour')), minute: Number(part('minute')), meridiem: part('dayPeriod').toUpperCase() === 'AM' ? 'AM' : 'PM' }
}

/** "2:15 PM" in the library's time zone. */
export function clockTime(iso: string, timeZone: string): string {
  const { hour, minute, meridiem } = clockParts(iso, timeZone)
  return `${hour}:${String(minute).padStart(2, '0')} ${meridiem}`
}

/** "2–3 PM", "11 AM–12 PM", "2:30–3:30 PM": a slot in the library's time zone. */
export function timeSpan(startIso: string, endIso: string, timeZone: string): string {
  const start = clockParts(startIso, timeZone)
  const end = clockParts(endIso, timeZone)
  const short = (p: { hour: number; minute: number }) =>
    p.minute === 0 ? String(p.hour) : `${p.hour}:${String(p.minute).padStart(2, '0')}`
  return start.meridiem === end.meridiem
    ? `${short(start)}–${short(end)} ${end.meridiem}`
    : `${short(start)} ${start.meridiem}–${short(end)} ${end.meridiem}`
}

/** "Thu, Oct 22" in the library's time zone. */
export function shortDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(new Date(iso))
}
```

Create `admin/lib/requests.ts`:

```ts
import { apiRequest } from './api'

export type RequestKind = 'borrow' | 'room'

// GET /admin/requests (backend: src/services/adminRequestService.ts).
export interface PendingRequest {
  id: string
  kind: RequestKind
  student: { id: string; name: string; email: string }
  requestedAt: string
  expiresAt: string
  book?: { id: string; title: string; author: string; availableCopies: number; totalCopies: number }
  room?: { resourceId: string; name: string; location: string | null; startTime: string; endTime: string }
}

export interface PendingRequests {
  requests: PendingRequest[]
  counts: { all: number; borrow: number; room: number }
}

export function fetchPendingRequests(): Promise<PendingRequests> {
  return apiRequest<PendingRequests>('/admin/requests')
}

export function approveRequest(r: Pick<PendingRequest, 'kind' | 'id'>): Promise<unknown> {
  return apiRequest(`/admin/requests/${r.kind}/${encodeURIComponent(r.id)}/approve`, { method: 'POST' })
}

/** The reason is optional: blank sends none, and the student sees "Declined by the library". */
export function declineRequest(r: Pick<PendingRequest, 'kind' | 'id'>, reason: string): Promise<unknown> {
  const trimmed = reason.trim()
  return apiRequest(`/admin/requests/${r.kind}/${encodeURIComponent(r.id)}/decline`, {
    method: 'POST',
    body: trimmed ? { reason: trimmed } : {},
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/lib`
Expected: PASS.

- [ ] **Step 6: Hand off the commit**

```bash
git add lib/api.ts lib/format.ts lib/requests.ts docs/2026-10-20-request-approvals-design.md docs/2026-10-20-request-approvals.md test/lib/api.test.ts test/lib/format.test.ts test/lib/requests.test.ts
git commit -m "admin: add the request API and library-time formatting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The live client

**Files:**
- Create: `admin/lib/live.ts`
- Modify: `admin/test/helpers.ts` (add `eventStream`)
- Test: `admin/test/lib/live.test.ts`

**Interfaces:**
- Consumes: `apiBaseUrl`, `readToken`, `endSession` (Task 8).
- Produces: `type LiveTopic = 'requests' | 'metrics'`; `type LiveEventType`; `interface LiveEvent { type: LiveEventType; topics: LiveTopic[]; kind?: 'borrow' | 'room'; summary?: string }`; `type LiveStatus = 'connecting' | 'live' | 'reconnecting'`; `RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]`; `DEAD_AFTER_MS = 60_000`; `createSseParser(onEvent: (type: string, data: string) => void): (text: string) => void`; `interface LiveHandlers { onEvent(event: LiveEvent): void; onReady(): void; onStatus(status: LiveStatus): void }`; `connectLive(handlers: LiveHandlers): { close(): void }`; test helper `eventStream(): { response: Response; send(text: string): void; end(): void }`.

- [ ] **Step 1: Add the stream helper for tests**

Append to `admin/test/helpers.ts`:

```ts
/** A text/event-stream response the test keeps writing to: send() text, end() the stream. */
export function eventStream() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    send(text: string) {
      controller.enqueue(encoder.encode(text))
    },
    end() {
      controller.close()
    },
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `admin/test/lib/live.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readToken, SESSION_ENDED_EVENT, writeToken } from '@/lib/api'
import { connectLive, createSseParser, type LiveEvent, type LiveStatus } from '@/lib/live'
import { eventStream, json, mockFetch } from '../helpers'

/** Lets fetch and stream promises run, without moving the fake clock. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

function connect() {
  const events: LiveEvent[] = []
  const statuses: LiveStatus[] = []
  let readies = 0
  const connection = connectLive({
    onEvent: (e) => events.push(e),
    onReady: () => {
      readies += 1
    },
    onStatus: (s) => statuses.push(s),
  })
  return { events, statuses, readies: () => readies, connection }
}

describe('createSseParser', () => {
  it('splits events across chunks, and ignores comments and retry hints', () => {
    const got: Array<[string, string]> = []
    const push = createSseParser((type, data) => got.push([type, data]))
    push('retry: 5000\n\nevent: ready\ndata: {}\n\n: ping\n\nevent: request.cre')
    push('ated\ndata: {"topics":["requests"]}\n')
    expect(got).toEqual([['ready', '{}']])
    push('\n')
    expect(got).toEqual([
      ['ready', '{}'],
      ['request.created', '{"topics":["requests"]}'],
    ])
  })

  it('joins multi-line data', () => {
    const got: string[] = []
    createSseParser((_, data) => got.push(data))('data: a\ndata: b\n\n')
    expect(got).toEqual(['a\nb'])
  })
})

describe('connectLive', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    writeToken('t')
  })
  afterEach(() => vi.useRealTimers())

  it('connects with the token, goes live on ready, and passes events on', async () => {
    const stream = eventStream()
    const fetch = mockFetch({ 'GET /admin/events': () => stream.response })
    const live = connect()
    expect(live.statuses).toEqual(['connecting'])
    await settle()
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')

    stream.send('retry: 5000\n\nevent: ready\ndata: {}\n\n')
    await settle()
    expect(live.readies()).toBe(1)
    expect(live.statuses.at(-1)).toBe('live')

    stream.send('event: request.created\ndata: {"topics":["requests"],"kind":"borrow","summary":"A wants B"}\n\n')
    await settle()
    expect(live.events).toEqual([{ type: 'request.created', topics: ['requests'], kind: 'borrow', summary: 'A wants B' }])
    live.connection.close()
  })

  it('reconnects 1 second after the server ends the stream, and is ready again', async () => {
    const streams = [eventStream(), eventStream()]
    let opened = 0
    mockFetch({ 'GET /admin/events': () => streams[opened++].response })
    const live = connect()
    await settle()
    streams[0].send('event: ready\ndata: {}\n\n')
    await settle()

    streams[0].end()
    await settle()
    expect(live.statuses.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(999)
    expect(opened).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(opened).toBe(2)

    streams[1].send('event: ready\ndata: {}\n\n')
    await settle()
    expect(live.readies()).toBe(2)
    expect(live.statuses.at(-1)).toBe('live')
    live.connection.close()
  })

  it('backs off 1, 2, 5, 10, then 30 seconds while the server is unreachable', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetch)
    const live = connect()
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)

    for (const [delay, calls] of [[1_000, 2], [2_000, 3], [5_000, 4], [10_000, 5], [30_000, 6], [30_000, 7]] as const) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(fetch).toHaveBeenCalledTimes(calls - 1)
      await vi.advanceTimersByTimeAsync(1)
      await settle()
      expect(fetch).toHaveBeenCalledTimes(calls)
    }
    expect(live.statuses.at(-1)).toBe('reconnecting')
    live.connection.close()
  })

  it('treats a minute of silence as a dropped connection, but not a minute of heartbeats', async () => {
    const streams = [eventStream(), eventStream()]
    let opened = 0
    mockFetch({ 'GET /admin/events': () => streams[opened++].response })
    const live = connect()
    await settle()
    streams[0].send('event: ready\ndata: {}\n\n')
    await settle()

    await vi.advanceTimersByTimeAsync(30_000)
    streams[0].send(': ping\n\n')
    await settle()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(live.statuses.at(-1)).toBe('live')
    await vi.advanceTimersByTimeAsync(1)
    expect(live.statuses.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    expect(opened).toBe(2)
    live.connection.close()
  })

  it.each([
    [401, 'expired'],
    [403, 'not-admin'],
  ])('ends the session on a %i, and stops', async (status, reason) => {
    const ended: string[] = []
    const onEnded = (e: Event) => ended.push((e as CustomEvent<string>).detail)
    window.addEventListener(SESSION_ENDED_EVENT, onEnded)
    const fetch = mockFetch({ 'GET /admin/events': () => json(status, { error: 'no' }) })

    connect()
    await settle()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(readToken()).toBeNull()
    expect(ended).toEqual([reason])
    expect(fetch).toHaveBeenCalledOnce()
    window.removeEventListener(SESSION_ENDED_EVENT, onEnded)
  })

  it('stops reconnecting once closed', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetch)
    const live = connect()
    await settle()
    live.connection.close()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run (in `admin/`): `npx vitest run test/lib/live.test.ts`
Expected: FAIL, cannot resolve `@/lib/live`.

- [ ] **Step 4: Implement the client**

Create `admin/lib/live.ts`:

```ts
// The console's live connection: GET /admin/events, read as a stream of
// Server-Sent Events. fetch rather than EventSource, because EventSource
// can't send the Authorization header. Events only say what changed and views
// refetch (lib/liveContext.tsx), so a dropped connection loses nothing.
import { apiBaseUrl, endSession, readToken } from './api'

export type LiveTopic = 'requests' | 'metrics'
export type LiveEventType = 'request.created' | 'request.decided' | 'request.expired' | 'request.cancelled' | 'activity'

export interface LiveEvent {
  type: LiveEventType
  topics: LiveTopic[]
  kind?: 'borrow' | 'room'
  summary?: string
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

/** The wait before each reconnect attempt; the last value repeats. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
/** The server sends a heartbeat every 25 s, so this long without a byte means the connection is gone. */
export const DEAD_AFTER_MS = 60_000

/**
 * Splits a text/event-stream into events. Feed it text as it arrives; it calls
 * `onEvent(type, data)` for every complete event. Comments (the heartbeats)
 * and `retry:` hints are ignored.
 */
export function createSseParser(onEvent: (type: string, data: string) => void): (text: string) => void {
  let buffer = ''
  return (text) => {
    buffer += text
    let end = buffer.indexOf('\n\n')
    while (end !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let type = 'message'
      const data: string[] = []
      for (const raw of block.split('\n')) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (line === '' || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') type = value
        else if (field === 'data') data.push(value)
      }
      if (data.length > 0) onEvent(type, data.join('\n'))
      end = buffer.indexOf('\n\n')
    }
  }
}

export interface LiveHandlers {
  onEvent(event: LiveEvent): void
  /** The stream is (re)connected. Anything may have been missed, so views should refetch. */
  onReady(): void
  onStatus(status: LiveStatus): void
}

type Attempt = { controller: AbortController; reader?: ReadableStreamDefaultReader<Uint8Array> }

export function connectLive(handlers: LiveHandlers): { close(): void } {
  let closed = false
  let failures = 0
  let current: Attempt | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let deadTimer: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    clearTimeout(deadTimer)
    if (!current) return
    current.controller.abort()
    current.reader?.cancel().catch(() => {})
    current = null
  }

  const retry = (delay: number) => {
    if (closed) return
    handlers.onStatus('reconnecting')
    retryTimer = setTimeout(() => void open(), delay)
  }

  const retryAfterFailure = () => {
    retry(RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)])
    failures += 1
  }

  async function open(): Promise<void> {
    const token = readToken()
    if (closed || !token) return
    const attempt: Attempt = { controller: new AbortController() }
    current = attempt

    let res: Response
    try {
      res = await fetch(`${apiBaseUrl()}/admin/events`, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        signal: attempt.controller.signal,
      })
    } catch {
      if (current === attempt) {
        current = null
        retryAfterFailure()
      }
      return
    }
    if (current !== attempt) return // closed while connecting
    if (res.status === 401 || res.status === 403) {
      closed = true
      current = null
      endSession(res.status === 401 ? 'expired' : 'not-admin')
      return
    }
    if (!res.ok || !res.body) {
      current = null
      retryAfterFailure()
      return
    }

    const reader = res.body.getReader()
    attempt.reader = reader
    const decoder = new TextDecoder()
    let ready = false
    const parse = createSseParser((type, data) => {
      if (type === 'ready') {
        ready = true
        failures = 0
        handlers.onStatus('live')
        handlers.onReady()
        return
      }
      try {
        handlers.onEvent({ ...(JSON.parse(data) as Omit<LiveEvent, 'type'>), type: type as LiveEventType })
      } catch {
        // Not JSON: nothing a view could act on.
      }
    })
    const armDeadTimer = () => {
      clearTimeout(deadTimer)
      deadTimer = setTimeout(() => {
        if (current !== attempt) return
        stop()
        retryAfterFailure()
      }, DEAD_AFTER_MS)
    }

    armDeadTimer()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        armDeadTimer()
        parse(decoder.decode(value, { stream: true }))
      }
    } catch {
      // Aborted or dropped: handled below.
    }
    if (current !== attempt) return // stopped on purpose: closed, or the dead timer already retried
    clearTimeout(deadTimer)
    current = null
    // The server ends every stream after 15 minutes: reconnect at once. A
    // stream that ended before it was ready counts as a failure.
    if (ready) retry(RECONNECT_DELAYS_MS[0])
    else retryAfterFailure()
  }

  handlers.onStatus('connecting')
  void open()
  return {
    close() {
      closed = true
      clearTimeout(retryTimer)
      stop()
    },
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/lib/live.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Hand off the commit**

```bash
git add lib/live.ts test/helpers.ts test/lib/live.test.ts
git commit -m "admin: add the reconnecting live event client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Live providers and the console shell

**Files:**
- Create: `admin/lib/liveContext.tsx`
- Create: `admin/lib/requestsContext.tsx`
- Create: `admin/components/Toasts.tsx`
- Create: `admin/components/RequestToasts.tsx`
- Modify: `admin/components/Sidebar.tsx`
- Modify: `admin/components/TopBar.tsx`
- Modify: `admin/app/(console)/layout.tsx`
- Modify: `admin/styles/console.css`
- Test: `admin/test/lib/liveContext.test.tsx`, `admin/test/lib/requestsContext.test.tsx`, `admin/test/components/Toasts.test.tsx` (new); `admin/test/components/Sidebar.test.tsx`, `admin/test/components/TopBar.test.tsx` (modify); `admin/test/app/console-shell.test.tsx` (new)

**Interfaces:**
- Consumes: `connectLive`, `LiveEvent`, `LiveStatus`, `LiveTopic`, `LiveHandlers` (Task 9); `fetchPendingRequests`, `PendingRequests` (Task 8); `LIBRARY_TIMEZONE` (Task 8).
- Produces: `RESYNC_EVERY_MS = 300_000`, `REFRESH_DEBOUNCE_MS = 1_000`, `type LiveMessage = LiveEvent | { type: 'resync' }`, `LiveProvider`, `useLiveStatus(): LiveStatus`, `useLiveMessages(listener)`, `useLiveRefresh(topics: LiveTopic[], refresh: () => void)` (`lib/liveContext.tsx`); `type RequestsState`, `RequestsProvider`, `useRequests(): { state; refresh(): Promise<void>; retry(): void }`, `waitingCount(state): number` (`lib/requestsContext.tsx`); `TOAST_MS = 6_000`, `MAX_TOASTS = 3`, `interface ToastInput { title?; message; action?: { label; href } }`, `ToastProvider`, `useToast()` (`components/Toasts.tsx`); `RequestToasts`; `Sidebar({ userName, onLogOut, requestCount })`; `TopBar({ title, liveStatus? })`.

- [ ] **Step 1: Write the failing tests**

Create `admin/test/lib/liveContext.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider, RESYNC_EVERY_MS, useLiveRefresh, useLiveStatus } from '@/lib/liveContext'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null, close: vi.fn() }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: live.close }
  },
}))

function Status() {
  return <p>{useLiveStatus()}</p>
}

function Refresher({ onRefresh }: { onRefresh: () => void }) {
  useLiveRefresh(['metrics'], onRefresh)
  return null
}

describe('LiveProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    live.close.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the connection status', () => {
    render(<LiveProvider><Status /></LiveProvider>)
    expect(screen.getByText('connecting')).toBeInTheDocument()
    act(() => live.handlers!.onStatus('live'))
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('refreshes a view one second after the last event on its topic', () => {
    const onRefresh = vi.fn()
    render(<LiveProvider><Refresher onRefresh={onRefresh} /></LiveProvider>)
    act(() => {
      live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] })
      live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] })
    })
    act(() => vi.advanceTimersByTime(999))
    expect(onRefresh).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('ignores events on other topics', () => {
    const onRefresh = vi.fn()
    render(<LiveProvider><Refresher onRefresh={onRefresh} /></LiveProvider>)
    act(() => live.handlers!.onEvent({ type: 'request.created', topics: ['requests'], kind: 'borrow', summary: 'x' }))
    act(() => vi.advanceTimersByTime(5_000))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('refreshes every view on ready and every 5 minutes', () => {
    const onRefresh = vi.fn()
    render(<LiveProvider><Refresher onRefresh={onRefresh} /></LiveProvider>)
    act(() => live.handlers!.onReady())
    act(() => vi.advanceTimersByTime(1_000))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(RESYNC_EVERY_MS))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('closes the connection when the console unmounts', () => {
    const { unmount } = render(<LiveProvider><Status /></LiveProvider>)
    unmount()
    expect(live.close).toHaveBeenCalledOnce()
  })
})
```

Create `admin/test/lib/requestsContext.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { writeToken } from '@/lib/api'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { PendingRequests } from '@/lib/requests'
import { RequestsProvider, useRequests, waitingCount } from '@/lib/requestsContext'
import { json, mockFetch } from '../helpers'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

const ONE: PendingRequests = {
  requests: [
    {
      id: 'br-1',
      kind: 'borrow',
      student: { id: 'u1', name: 'Aditi Sharma', email: 'aditi.sharma@thapar.edu' },
      requestedAt: '2026-10-22T08:00:00.000Z',
      expiresAt: '2026-10-23T08:00:00.000Z',
      book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 1, totalCopies: 4 },
    },
  ],
  counts: { all: 1, borrow: 1, room: 0 },
}

function Probe() {
  const { state, retry } = useRequests()
  if (state.kind === 'loading') return <p>loading</p>
  if (state.kind === 'error') return <button type="button" onClick={retry}>Retry</button>
  return <p>{waitingCount(state)} waiting</p>
}

describe('RequestsProvider', () => {
  it('loads the pending requests', async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/requests': () => json(200, ONE) })
    render(<RequestsProvider><Probe /></RequestsProvider>)
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()
  })

  it('keeps the last list when a background refresh fails', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/requests': () => (++calls === 1 ? json(200, ONE) : json(500, { error: 'Something went wrong.' })) })
    render(<LiveProvider><RequestsProvider><Probe /></RequestsProvider></LiveProvider>)
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'request.cancelled', topics: ['requests'], kind: 'borrow' }))
    await waitFor(() => expect(calls).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('1 waiting')).toBeInTheDocument()
  })

  it('shows an error when the first load fails, and Retry loads again', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/requests': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, ONE)) })
    render(<RequestsProvider><Probe /></RequestsProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()
  })
})
```

Create `admin/test/components/Toasts.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOASTS, TOAST_MS, ToastProvider, useToast, type ToastInput } from '@/components/Toasts'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

let push: (toast: ToastInput) => void = () => {}
function Grab() {
  push = useToast()
  return null
}

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a toast with its title, message and link, then hides it after six seconds', () => {
    render(<ToastProvider><Grab /></ToastProvider>)
    act(() =>
      push({ title: 'New borrow request', message: 'Aditi Sharma wants to borrow Clean Code', action: { label: 'Review', href: '/requests' } }),
    )
    expect(screen.getByText('New borrow request')).toBeInTheDocument()
    expect(screen.getByText('Aditi Sharma wants to borrow Clean Code')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/requests')

    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(screen.queryByText('Aditi Sharma wants to borrow Clean Code')).toBeNull()
  })

  it('shows at most three at a time, dropping the oldest', () => {
    render(<ToastProvider><Grab /></ToastProvider>)
    act(() => {
      for (let i = 1; i <= MAX_TOASTS + 1; i++) push({ message: `Toast ${i}` })
    })
    expect(screen.queryByText('Toast 1')).toBeNull()
    expect(screen.getByText('Toast 4')).toBeInTheDocument()
  })
})
```

In `admin/test/components/Sidebar.test.tsx`, change the helper to pass a count, and add two tests:

```tsx
const renderSidebar = (onLogOut = vi.fn(), requestCount = 0) => {
  render(<Sidebar userName="Librarian One" onLogOut={onLogOut} requestCount={requestCount} />)
  return onLogOut
}
```

```tsx
  it('links to Requests with the number waiting', () => {
    renderSidebar(vi.fn(), 3)
    const link = screen.getByRole('link', { name: /Requests/ })
    expect(link).toHaveAttribute('href', '/requests')
    expect(link).toHaveTextContent('3')
  })

  it('shows no count when nothing is waiting', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Requests' })).toBeInTheDocument()
  })
```

In `admin/test/components/TopBar.test.tsx`, add:

```tsx
  it('says whether the console is live', () => {
    const { rerender } = render(<TopBar title="Requests" liveStatus="live" />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    rerender(<TopBar title="Requests" liveStatus="reconnecting" />)
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
    rerender(<TopBar title="Requests" liveStatus="connecting" />)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })
```

Create `admin/test/app/console-shell.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConsoleLayout from '@/app/(console)/layout'
import { writeToken } from '@/lib/api'
import type { PendingRequests } from '@/lib/requests'
import { eventStream, json, mockFetch } from '../helpers'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/dashboard' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const ADMIN = { id: 'a1', name: 'Librarian One', email: 'lib@thapar.edu', roll: 'Pending', role: 'admin' }
const student = (n: number) => ({ id: `u${n}`, name: `Student ${n}`, email: `s${n}@thapar.edu` })
const WAITING: PendingRequests = {
  requests: [
    {
      id: 'br-1', kind: 'borrow', student: student(1), requestedAt: '2026-10-22T08:00:00.000Z', expiresAt: '2026-10-23T08:00:00.000Z',
      book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 1, totalCopies: 4 },
    },
    {
      id: 'bk-1', kind: 'room', student: student(2), requestedAt: '2026-10-22T08:05:00.000Z', expiresAt: '2026-10-22T08:45:00.000Z',
      room: { resourceId: 'r1', name: 'Group Room 201', location: null, startTime: '2026-10-22T08:30:00.000Z', endTime: '2026-10-22T09:30:00.000Z' },
    },
  ],
  counts: { all: 2, borrow: 1, room: 1 },
}

describe('console shell', () => {
  afterEach(() => {
    document.title = ''
  })

  it('shows the waiting count, goes live, and toasts a new request', async () => {
    writeToken('t')
    const stream = eventStream()
    mockFetch({
      'GET /auth/me': () => json(200, ADMIN),
      'GET /admin/requests': () => json(200, WAITING),
      'GET /admin/events': () => stream.response,
    })

    render(<ConsoleLayout><p>page</p></ConsoleLayout>)

    expect(await screen.findByText('page')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('(2) SmartLib Admin'))
    expect(screen.getByRole('link', { name: /Requests/ })).toHaveTextContent('2')
    expect(screen.getByText('Connecting…')).toBeInTheDocument()

    act(() => stream.send('event: ready\ndata: {}\n\n'))
    expect(await screen.findByText('Live')).toBeInTheDocument()

    act(() =>
      stream.send('event: request.created\ndata: {"topics":["requests"],"kind":"borrow","summary":"Aditi Sharma wants to borrow Sapiens"}\n\n'),
    )
    expect(await screen.findByText('Aditi Sharma wants to borrow Sapiens')).toBeInTheDocument()
    expect(screen.getByText('New borrow request')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/requests')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `admin/`): `npx vitest run test/lib/liveContext.test.tsx test/lib/requestsContext.test.tsx test/components test/app/console-shell.test.tsx`
Expected: FAIL. The new modules can't be resolved; the sidebar has no Requests link; the top bar has no live indicator.

- [ ] **Step 3: Implement the live context**

Create `admin/lib/liveContext.tsx`:

```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { connectLive, type LiveEvent, type LiveStatus, type LiveTopic } from './live'

/** Every view refetches this often regardless: a safety net, and it keeps Render awake. */
export const RESYNC_EVERY_MS = 5 * 60_000
/** A burst of events inside this window causes one refetch. */
export const REFRESH_DEBOUNCE_MS = 1_000

/** A server event, or 'resync': the stream (re)connected, or the safety net fired. */
export type LiveMessage = LiveEvent | { type: 'resync' }
type Listener = (message: LiveMessage) => void

interface LiveContextValue {
  status: LiveStatus
  subscribe(listener: Listener): () => void
}

// Outside a LiveProvider nothing is live: views still load, they just never
// refresh on their own.
const LiveContext = createContext<LiveContextValue>({ status: 'connecting', subscribe: () => () => {} })

/** One live connection for the whole console; views subscribe to it. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const listeners = useRef(new Set<Listener>())

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    const emit = (message: LiveMessage) => {
      for (const listener of [...listeners.current]) listener(message)
    }
    const connection = connectLive({ onEvent: emit, onReady: () => emit({ type: 'resync' }), onStatus: setStatus })
    const timer = setInterval(() => emit({ type: 'resync' }), RESYNC_EVERY_MS)
    return () => {
      connection.close()
      clearInterval(timer)
    }
  }, [])

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe])
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveContext).status
}

/** Calls `listener` with every live message while the component is mounted. */
export function useLiveMessages(listener: Listener): void {
  const { subscribe } = useContext(LiveContext)
  const latest = useRef(listener)
  useEffect(() => {
    latest.current = listener
  })
  useEffect(() => subscribe((message) => latest.current(message)), [subscribe])
}

/** Calls `refresh` once, a second after the last event on one of `topics` or a resync. */
export function useLiveRefresh(topics: LiveTopic[], refresh: () => void): void {
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const topicKey = topics.join(',')
  useLiveMessages((message) => {
    if (message.type !== 'resync' && !message.topics.some((topic) => topicKey.split(',').includes(topic))) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current(), REFRESH_DEBOUNCE_MS)
  })
  useEffect(() => () => clearTimeout(timer.current), [])
}
```

- [ ] **Step 4: Implement the shared request state**

Create `admin/lib/requestsContext.tsx`:

```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from './api'
import { useLiveRefresh } from './liveContext'
import { fetchPendingRequests, type PendingRequests } from './requests'

export type RequestsState = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; data: PendingRequests }

interface RequestsContextValue {
  state: RequestsState
  /** Refetches in the background: the current list stays on screen meanwhile, and if it fails. */
  refresh(): Promise<void>
  /** From the error state: show loading, then refetch. */
  retry(): void
}

const RequestsContext = createContext<RequestsContextValue | null>(null)

/** The pending requests, shared by the sidebar badge, the tab title, the Dashboard panel and the Requests page. */
export function RequestsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RequestsState>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPendingRequests()
      setState({ kind: 'loaded', data })
    } catch (error) {
      // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
      setState((current) => (current.kind === 'loaded' ? current : { kind: 'error' }))
    }
  }, [])

  const retry = useCallback(() => {
    setState({ kind: 'loading' })
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useLiveRefresh(['requests'], () => void refresh())

  const value = useMemo(() => ({ state, refresh, retry }), [state, refresh, retry])
  return <RequestsContext.Provider value={value}>{children}</RequestsContext.Provider>
}

export function useRequests(): RequestsContextValue {
  const value = useContext(RequestsContext)
  if (!value) throw new Error('useRequests must be used inside <RequestsProvider>')
  return value
}

/** How many requests are waiting: 0 while loading or on error. */
export function waitingCount(state: RequestsState): number {
  return state.kind === 'loaded' ? state.data.counts.all : 0
}
```

- [ ] **Step 5: Implement the toasts**

Create `admin/components/Toasts.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ToastInput {
  title?: string
  message: string
  action?: { label: string; href: string }
}

export const TOAST_MS = 6_000
export const MAX_TOASTS = 3

type Toast = ToastInput & { id: number }

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})

/** The console's toasts: newest at the bottom, at most three, each for six seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++
    setToasts((list) => [...list, { ...toast, id }].slice(-MAX_TOASTS))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts((list) => list.filter((t) => t.id !== id))
    }, TOAST_MS)
    timers.current.add(timer)
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="sla-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="sla-toast card elev-md">
            {t.title && <strong className="sla-toast-title">{t.title}</strong>}
            <span>{t.message}</span>
            {t.action && (
              <Link href={t.action.href} className="sla-toast-link">
                {t.action.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext)
}
```

Create `admin/components/RequestToasts.tsx`:

```tsx
'use client'

import { useLiveMessages } from '@/lib/liveContext'
import { useToast } from './Toasts'

/** A toast for every new request, on any console page. */
export function RequestToasts() {
  const toast = useToast()
  useLiveMessages((message) => {
    if (message.type !== 'request.created' || !message.summary) return
    toast({
      title: message.kind === 'room' ? 'New room request' : 'New borrow request',
      message: message.summary,
      action: { label: 'Review', href: '/requests' },
    })
  })
  return null
}
```

- [ ] **Step 6: Add Requests to the sidebar and the live indicator to the top bar**

In `admin/components/Sidebar.tsx`:
- Add `Inbox` to the lucide import.
- Change the `href` doc comment to `/** Absent until the section is built (slices 4 and 5). */`, and the comment above `SECTIONS` to `// "Needs attention" (the moderation queue) is deferred with no slice, so it is left out entirely.`
- Insert `{ label: 'Requests', icon: Inbox, href: '/requests' },` directly after the Dashboard entry.
- Change the signature to `export function Sidebar({ userName, onLogOut, requestCount }: { userName: string; onLogOut: () => void; requestCount: number })`.
- In the `Link` branch, before `return (`, add `const badge = href === '/requests' && requestCount > 0 ? requestCount : null`, and after `<span>{label}</span>` inside the `Link` add `{badge !== null && <span className="sla-badge">{badge}</span>}`.

Replace `admin/components/TopBar.tsx` with:

```tsx
'use client'

import { LIBRARY_TIMEZONE, todayLabel } from '@/lib/format'
import type { LiveStatus } from '@/lib/live'

const LIVE_LABELS: Record<LiveStatus, string> = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' }

export function TopBar({ title, liveStatus = 'connecting' }: { title: string; liveStatus?: LiveStatus }) {
  return (
    <header
      style={{
        flex: 'none', padding: '16px 28px', borderBottom: '1px solid var(--color-divider)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 19, fontFamily: 'var(--font-heading)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
        <span className="sla-live text-muted" data-status={liveStatus}>
          <span className="sla-live-dot" aria-hidden="true">{liveStatus === 'live' ? '●' : '○'}</span>
          {LIVE_LABELS[liveStatus]}
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>{todayLabel(new Date(), LIBRARY_TIMEZONE)}</span>
      </div>
    </header>
  )
}
```

Append to `admin/styles/console.css`:

```css
/* Slice 2: request badge, live indicator, toasts */
.sla-badge { margin-left: auto; min-width: 20px; padding: 1px 6px; border-radius: 999px; background: var(--color-accent-600); color: var(--color-neutral-100); font-size: 11px; font-weight: 600; line-height: 16px; text-align: center }
.sla-live { display: inline-flex; align-items: center; gap: 5px; font-size: 12px }
.sla-live-dot { font-size: 10px; color: var(--color-neutral-500) }
.sla-live[data-status='live'] .sla-live-dot { color: var(--color-accent-2-600) }
.sla-toasts { position: fixed; right: 20px; bottom: 20px; z-index: 50; display: flex; flex-direction: column; gap: 8px; width: min(340px, calc(100vw - 40px)) }
.sla-toast { padding: 12px 14px; gap: 4px; font-size: 13px }
.sla-toast-title { font-size: 13px }
.sla-toast-link { font-size: 12.5px; align-self: flex-start }
```

- [ ] **Step 7: Wire the providers into the console layout**

Replace `admin/app/(console)/layout.tsx` with:

```tsx
'use client'

import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { DashboardSkeleton } from '@/components/dashboard/DashboardStates'
import { RequestToasts } from '@/components/RequestToasts'
import { Sidebar } from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toasts'
import { TopBar } from '@/components/TopBar'
import { LiveProvider, useLiveStatus } from '@/lib/liveContext'
import { RequestsProvider, useRequests, waitingCount } from '@/lib/requestsContext'
import { ConsoleGuard, useSession } from '@/lib/session'

const PAGE_TITLES: Record<string, string> = { '/dashboard': 'Dashboard', '/requests': 'Requests' }
const APP_TITLE = 'SmartLib Admin'

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleGuard fallback={<ConsoleSkeleton />}>
      <LiveProvider>
        <ToastProvider>
          <RequestsProvider>
            <ConsoleFrame>{children}</ConsoleFrame>
          </RequestsProvider>
        </ToastProvider>
      </LiveProvider>
    </ConsoleGuard>
  )
}

// The session check is the first request after the API sleeps, so it can take a
// minute: show the shell's outline and the loading skeleton, never a blank page.
function ConsoleSkeleton() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <div style={{ width: 212, flex: 'none', background: 'var(--color-surface)', borderRight: '1px solid var(--color-divider)' }} />
      <div style={{ flex: 1, minWidth: 0, padding: '22px 28px 40px' }}>
        <DashboardSkeleton />
      </div>
    </div>
  )
}

function ConsoleFrame({ children }: { children: ReactNode }) {
  const { user, logOut } = useSession()
  const pathname = usePathname()
  const liveStatus = useLiveStatus()
  const waiting = waitingCount(useRequests().state)

  // The browser tab shows how many requests are waiting.
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) ${APP_TITLE}` : APP_TITLE
    return () => {
      document.title = APP_TITLE
    }
  }, [waiting])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      <RequestToasts />
      <Sidebar userName={user.name} onLogOut={logOut} requestCount={waiting} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TopBar title={PAGE_TITLES[pathname] ?? 'Dashboard'} liveStatus={liveStatus} />
        <main style={{ flex: 1, overflow: 'auto', padding: '22px 28px 40px' }}>{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/lib/liveContext.test.tsx test/lib/requestsContext.test.tsx test/components test/app/console-shell.test.tsx`
Expected: PASS.
Run: `npm test`
Expected: all files pass.

- [ ] **Step 9: Hand off the commit**

```bash
git add lib/liveContext.tsx lib/requestsContext.tsx components/Toasts.tsx components/RequestToasts.tsx components/Sidebar.tsx components/TopBar.tsx "app/(console)/layout.tsx" styles/console.css test/lib/liveContext.test.tsx test/lib/requestsContext.test.tsx test/components test/app/console-shell.test.tsx
git commit -m "admin: go live: request badge, tab count, live indicator and request toasts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The Requests page

**Files:**
- Create: `admin/lib/useNow.ts`
- Create: `admin/components/requests/requestText.ts`
- Create: `admin/components/requests/useDecision.ts`
- Create: `admin/components/requests/DeclineDialog.tsx`
- Create: `admin/components/requests/RequestCard.tsx`
- Create: `admin/components/requests/RequestsStates.tsx`
- Create: `admin/app/(console)/requests/page.tsx`
- Test: `admin/test/app/requests.test.tsx`

**Interfaces:**
- Consumes: `useRequests` (Task 10); `useToast` (Task 10); `approveRequest`, `declineRequest`, `PendingRequest` (Task 8); `waitingLabel`, `clockTime`, `shortDay`, `timeSpan`, `LIBRARY_TIMEZONE` (Task 8).
- Produces: `useNow(everyMs?: number): number`; `requestTitle`, `requestDetail(r, now)`, `requestSubject`, `requestRow`, `approvedToast`, `declinedToast` (`requestText.ts`); `useDecision(request): { busy: boolean; approve(): Promise<void>; decline(reason: string): Promise<void> }`; `DeclineDialog({ request, onCancel, onConfirm })`; `RequestCard({ request })`.

- [ ] **Step 1: Write the failing tests**

Create `admin/test/app/requests.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import RequestsPage from '@/app/(console)/requests/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { PendingRequest, PendingRequests } from '@/lib/requests'
import { RequestsProvider } from '@/lib/requestsContext'
import { json, mockFetch } from '../helpers'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const BORROW: PendingRequest = {
  id: 'br-1',
  kind: 'borrow',
  student: { id: 'u1', name: 'Aditi Sharma', email: 'aditi.sharma@thapar.edu' },
  requestedAt: minutesAgo(12),
  expiresAt: new Date(Date.now() + 23.5 * 3_600_000).toISOString(),
  book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 2, totalCopies: 4 },
}

const ROOM: PendingRequest = {
  id: 'bk-1',
  kind: 'room',
  student: { id: 'u2', name: 'Rohan Verma', email: 'rohan.verma@thapar.edu' },
  requestedAt: minutesAgo(4),
  expiresAt: '2026-10-22T08:45:00.000Z',
  room: { resourceId: 'r1', name: 'Group Room 201', location: 'Group study rooms', startTime: '2026-10-22T08:30:00.000Z', endTime: '2026-10-22T09:30:00.000Z' },
}

const pending = (...requests: PendingRequest[]): PendingRequests => ({
  requests,
  counts: {
    all: requests.length,
    borrow: requests.filter((r) => r.kind === 'borrow').length,
    room: requests.filter((r) => r.kind === 'room').length,
  },
})

function renderPage() {
  writeToken('t')
  return render(
    <ToastProvider>
      <RequestsProvider>
        <RequestsPage />
      </RequestsProvider>
    </ToastProvider>,
  )
}

describe('Requests page', () => {
  it('shows skeleton cards while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderPage()
    expect(screen.getByLabelText('Loading requests')).toHaveAttribute('aria-busy', 'true')
  })

  it('offers Retry when the requests cannot be loaded', async () => {
    let calls = 0
    mockFetch({ 'GET /admin/requests': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, pending(BORROW))) })
    renderPage()
    expect(await screen.findByText("Couldn't load requests")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Clean Code — Robert C. Martin')).toBeInTheDocument()
  })

  it("says you're all caught up when nothing is waiting", async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending()) })
    renderPage()
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(
      screen.getByText('No requests waiting. New borrow and room requests appear here the moment students send them.'),
    ).toBeInTheDocument()
  })

  it('shows each request with who asked, how long ago, and what for', async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending(BORROW, ROOM)) })
    renderPage()
    expect(await screen.findByText('Borrow request')).toBeInTheDocument()
    expect(screen.getByText('Aditi Sharma')).toBeInTheDocument()
    expect(screen.getByText('waiting 12 min')).toBeInTheDocument()
    expect(screen.getByText('Clean Code — Robert C. Martin')).toBeInTheDocument()
    expect(screen.getByText('2 of 4 copies left · expires in 23 h')).toBeInTheDocument()
    expect(screen.getByText('Room request')).toBeInTheDocument()
    expect(screen.getByText('Group Room 201')).toBeInTheDocument()
    expect(screen.getByText('Thu, Oct 22 · 2–3 PM · slot held until 2:15 PM')).toBeInTheDocument()
  })

  it('filters by kind, and says when a filter has nothing', async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending(BORROW)) })
    renderPage()
    await screen.findByText('Clean Code — Robert C. Martin')
    await userEvent.click(screen.getByRole('button', { name: 'Rooms (0)' }))
    expect(screen.getByText('No room requests waiting.')).toBeInTheDocument()
    expect(screen.queryByText('Clean Code — Robert C. Martin')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'All (1)' }))
    expect(screen.getByText('Clean Code — Robert C. Martin')).toBeInTheDocument()
  })

  it('approves, says so and refreshes the list -- once, however fast the clicks', async () => {
    let lists = 0
    const fetch = mockFetch({
      'GET /admin/requests': () => json(200, ++lists === 1 ? pending(BORROW) : pending()),
      'POST /admin/requests/borrow/br-1/approve': () => json(200, { id: 'br-1', kind: 'borrow', status: 'approved' }),
    })
    renderPage()
    const approve = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    fireEvent.click(approve)
    expect(await screen.findByText("Approved. Aditi Sharma's loan of Clean Code starts now.")).toBeInTheDocument()
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })

  it('declines with an optional reason the student will see', async () => {
    const fetch = mockFetch({
      'GET /admin/requests': () => json(200, pending(ROOM)),
      'POST /admin/requests/room/bk-1/decline': () => json(200, { id: 'bk-1', kind: 'room', status: 'declined' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))
    const dialog = screen.getByRole('dialog', { name: 'Decline this request?' })
    expect(
      within(dialog).getByText('Rohan Verma — Group Room 201 · Thu, Oct 22 · 2–3 PM. The slot goes back to other students.'),
    ).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Reserved for an event')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline request' }))

    expect(await screen.findByText('Declined. Rohan Verma will see it in the app.')).toBeInTheDocument()
    const decline = fetch.mock.calls.find(([input]) => String(input).endsWith('/decline'))!
    expect(decline[1]!.body).toBe('{"reason":"Reserved for an event"}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("a 409 shows the server's message and refreshes the list", async () => {
    let lists = 0
    mockFetch({
      'GET /admin/requests': () => json(200, ++lists === 1 ? pending(BORROW) : pending()),
      'POST /admin/requests/borrow/br-1/approve': () => json(409, { error: 'Already approved by Librarian One.' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Already approved by Librarian One.')).toBeInTheDocument()
    await waitFor(() => expect(lists).toBe(2))
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `admin/`): `npx vitest run test/app/requests.test.tsx`
Expected: FAIL, cannot resolve `@/app/(console)/requests/page`.

- [ ] **Step 3: Add the clock and the request wording**

Create `admin/lib/useNow.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'

/** The current time in ms, re-read every `everyMs`, so "waiting 12 min" keeps counting. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
```

Create `admin/components/requests/requestText.ts`:

```ts
// The words a request is shown with: on its card, in the Dashboard panel, in
// the decline dialog and in the toasts. Times are the library's.
import { LIBRARY_TIMEZONE, clockTime, shortDay, timeSpan, waitingLabel } from '@/lib/format'
import type { PendingRequest } from '@/lib/requests'

function slotText(r: PendingRequest): string {
  const room = r.room!
  return `${shortDay(room.startTime, LIBRARY_TIMEZONE)} · ${timeSpan(room.startTime, room.endTime, LIBRARY_TIMEZONE)}`
}

/** The card's main line: "Clean Code — Robert C. Martin", or the room's name. */
export function requestTitle(r: PendingRequest): string {
  return r.kind === 'borrow' ? `${r.book!.title} — ${r.book!.author}` : r.room!.name
}

/** The card's detail line, as of `now` (ms). */
export function requestDetail(r: PendingRequest, now: number): string {
  if (r.kind === 'borrow') {
    const book = r.book!
    return `${book.availableCopies} of ${book.totalCopies} copies left · expires in ${waitingLabel(Date.parse(r.expiresAt) - now)}`
  }
  return `${slotText(r)} · slot held until ${clockTime(r.expiresAt, LIBRARY_TIMEZONE)}`
}

/** What is asked for: the book's title, or the room and its slot. */
export function requestSubject(r: PendingRequest): string {
  return r.kind === 'borrow' ? r.book!.title : `${r.room!.name} · ${slotText(r)}`
}

/** A Dashboard row: "Aditi Sharma · Clean Code", "Rohan Verma · Group Room 201 · 2–3 PM". */
export function requestRow(r: PendingRequest): string {
  if (r.kind === 'borrow') return `${r.student.name} · ${r.book!.title}`
  const room = r.room!
  return `${r.student.name} · ${room.name} · ${timeSpan(room.startTime, room.endTime, LIBRARY_TIMEZONE)}`
}

export function approvedToast(r: PendingRequest): string {
  return r.kind === 'borrow'
    ? `Approved. ${r.student.name}'s loan of ${r.book!.title} starts now.`
    : `Approved. ${r.room!.name} is booked for ${r.student.name}.`
}

export function declinedToast(r: PendingRequest): string {
  return `Declined. ${r.student.name} will see it in the app.`
}
```

- [ ] **Step 4: Add the decision hook and the decline dialog**

Create `admin/components/requests/useDecision.ts`:

```ts
'use client'

import { useCallback, useRef, useState } from 'react'
import { useToast } from '@/components/Toasts'
import { ApiError } from '@/lib/api'
import { approveRequest, declineRequest, type PendingRequest } from '@/lib/requests'
import { useRequests } from '@/lib/requestsContext'
import { approvedToast, declinedToast } from './requestText'

/**
 * Approve and decline for one request. A second click while a decision is in
 * flight sends nothing. Either way the queue is refetched afterwards, so a
 * request someone else settled disappears, with the server's 409 as a toast.
 */
export function useDecision(request: PendingRequest) {
  const toast = useToast()
  const { refresh } = useRequests()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      try {
        await action()
        toast({ message: success })
      } catch (error) {
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
        if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          toast({ message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' })
        }
      } finally {
        inFlight.current = false
        setBusy(false)
        void refresh()
      }
    },
    [toast, refresh],
  )

  return {
    busy,
    approve: () => run(() => approveRequest(request), approvedToast(request)),
    decline: (reason: string) => run(() => declineRequest(request, reason), declinedToast(request)),
  }
}
```

Create `admin/components/requests/DeclineDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { PendingRequest } from '@/lib/requests'
import { requestSubject } from './requestText'

/** The canvas's decline dialog, with an optional reason the student will see. */
export function DeclineDialog({
  request, onCancel, onConfirm,
}: {
  request: PendingRequest
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const held = request.kind === 'borrow' ? 'copy' : 'slot'
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="decline-title">
        <div className="dialog-title" id="decline-title">Decline this request?</div>
        <div className="dialog-body">{`${request.student.name} — ${requestSubject(request)}. The ${held} goes back to other students.`}</div>
        <div className="field">
          <label htmlFor="decline-reason">Reason (optional)</label>
          <textarea
            id="decline-reason"
            className="input"
            rows={2}
            maxLength={300}
            autoFocus
            placeholder="Shown to the student, e.g. the room is reserved for an event"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(reason)}>Decline request</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add the card, the page states and the page**

Create `admin/components/requests/RequestCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { waitingLabel } from '@/lib/format'
import type { PendingRequest } from '@/lib/requests'
import { useNow } from '@/lib/useNow'
import { DeclineDialog } from './DeclineDialog'
import { requestDetail, requestTitle } from './requestText'
import { useDecision } from './useDecision'

/** One request on the Requests page, in the canvas's "Needs attention" card layout. */
export function RequestCard({ request }: { request: PendingRequest }) {
  const now = useNow()
  const { busy, approve, decline } = useDecision(request)
  const [declining, setDeclining] = useState(false)
  const borrow = request.kind === 'borrow'

  return (
    <div className="card elev-sm" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`tag ${borrow ? 'tag-accent' : 'tag-accent-2'}`}>{borrow ? 'Borrow request' : 'Room request'}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{request.student.name}</span>
          <span className="text-muted" style={{ fontSize: 11.5 }}>waiting {waitingLabel(now - Date.parse(request.requestedAt))}</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{requestTitle(request)}</div>
        <div className="text-muted" style={{ fontSize: 12.5 }}>{requestDetail(request, now)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none', minWidth: 150 }}>
        <button type="button" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={busy} onClick={() => void approve()}>
          Approve
        </button>
        <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={busy} onClick={() => setDeclining(true)}>
          Decline
        </button>
      </div>
      {declining && (
        <DeclineDialog
          request={request}
          onCancel={() => setDeclining(false)}
          onConfirm={(reason) => {
            setDeclining(false)
            void decline(reason)
          }}
        />
      )}
    </div>
  )
}
```

Create `admin/components/requests/RequestsStates.tsx`:

```tsx
import { CircleCheckBig, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { RequestKind } from '@/lib/requests'

const centered: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '70px 20px', textAlign: 'center',
}

export function RequestsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading requests" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map((i) => <div key={i} className="sla-skel" style={{ height: 84 }} />)}
    </div>
  )
}

export function RequestsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" style={centered}>
      <TriangleAlert size={30} strokeWidth={2.5} color="var(--color-neutral-600)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>Couldn&apos;t load requests</h3>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function RequestsEmpty() {
  return (
    <div style={centered}>
      <CircleCheckBig size={34} strokeWidth={2.5} color="var(--color-accent-2-700)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>You&apos;re all caught up</h3>
      <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: '38ch' }}>
        No requests waiting. New borrow and room requests appear here the moment students send them.
      </p>
    </div>
  )
}

export function FilterEmpty({ kind }: { kind: RequestKind }) {
  return (
    <p className="text-muted" style={{ margin: '40px 0', textAlign: 'center', fontSize: 13 }}>
      {kind === 'room' ? 'No room requests waiting.' : 'No borrow requests waiting.'}
    </p>
  )
}
```

Create `admin/app/(console)/requests/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { RequestCard } from '@/components/requests/RequestCard'
import { FilterEmpty, RequestsEmpty, RequestsError, RequestsSkeleton } from '@/components/requests/RequestsStates'
import type { RequestKind } from '@/lib/requests'
import { useRequests } from '@/lib/requestsContext'

type Filter = 'all' | RequestKind

export default function RequestsPage() {
  const { state, retry } = useRequests()
  const [filter, setFilter] = useState<Filter>('all')

  if (state.kind === 'loading') return <RequestsSkeleton />
  if (state.kind === 'error') return <RequestsError onRetry={retry} />

  const { requests, counts } = state.data
  const shown = filter === 'all' ? requests : requests.filter((r) => r.kind === filter)
  const chips: { value: Filter; label: string }[] = [
    { value: 'all', label: `All (${counts.all})` },
    { value: 'borrow', label: `Borrows (${counts.borrow})` },
    { value: 'room', label: `Rooms (${counts.room})` },
  ]

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`tag sla-chip ${filter === chip.value ? 'tag-accent' : 'tag-neutral'}`}
            aria-pressed={filter === chip.value}
            onClick={() => setFilter(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {requests.length === 0 ? (
        <RequestsEmpty />
      ) : shown.length === 0 ? (
        <FilterEmpty kind={filter === 'room' ? 'room' : 'borrow'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((r) => <RequestCard key={`${r.kind}:${r.id}`} request={r} />)}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/app/requests.test.tsx`
Expected: PASS (8 tests).
Run: `npm test`
Expected: all files pass.

- [ ] **Step 7: Hand off the commit**

```bash
git add lib/useNow.ts components/requests "app/(console)/requests/page.tsx" test/app/requests.test.tsx
git commit -m "admin: add the Requests page with approve and decline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The Dashboard goes live

**Files:**
- Create: `admin/components/dashboard/WaitingPanel.tsx`
- Modify: `admin/app/(console)/dashboard/page.tsx`
- Modify: `admin/test/app/dashboard.test.tsx`

**Interfaces:**
- Consumes: `useRequests` (Task 10); `useLiveRefresh` (Task 10); `useDecision`, `DeclineDialog`, `requestRow` (Task 11); `useNow` (Task 11); `waitingLabel` (Task 8).
- Produces: `WaitingPanel()`; the Dashboard page refetching metrics on the `metrics` topic without its skeleton.

- [ ] **Step 1: Write the failing tests**

In `admin/test/app/dashboard.test.tsx`:

1. Replace the imports, and add the mocks and helpers, so the top of the file reads:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import DashboardPage from '@/app/(console)/dashboard/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { DashboardMetrics } from '@/lib/metrics'
import type { PendingRequest, PendingRequests } from '@/lib/requests'
import { RequestsProvider } from '@/lib/requestsContext'
import { json, mockFetch } from '../helpers'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))
```

2. Keep `METRICS` and `EMPTY` as they are. After them, add:

```tsx
const NONE: PendingRequests = { requests: [], counts: { all: 0, borrow: 0, room: 0 } }

function renderDashboard() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <RequestsProvider>
          <DashboardPage />
        </RequestsProvider>
      </ToastProvider>
    </LiveProvider>,
  )
}
```

and change `serve` so it also answers the request queue:

```tsx
function serve(m: DashboardMetrics, status = 200, requests: PendingRequests = NONE) {
  const reply = (body: unknown) => () => (status === 200 ? json(200, body) : json(status, { error: 'Something went wrong.' }))
  return mockFetch({
    'GET /admin/metrics/utilization': reply(m.utilization),
    'GET /admin/metrics/circulation': reply(m.circulation),
    'GET /admin/metrics/overdue': reply(m.overdue),
    'GET /admin/metrics/demand': reply(m.demand),
    'GET /admin/requests': () => json(200, requests),
  })
}
```

3. In every existing test, replace `render(<DashboardPage />)` with `renderDashboard()`. In `copes with no busiest slot and with no resources at all`, replace the first `const { unmount } = render(<DashboardPage />)` with `const { unmount } = renderDashboard()`. In `leaves an ended session to the session guard instead of showing an error`, change `toHaveBeenCalledTimes(4)` to `toHaveBeenCalledTimes(5)` (the four metrics and the request queue).

4. Append inside `describe('Dashboard', ...)`:

```tsx
  it('lists the three oldest waiting requests, with View all', async () => {
    const asking = (id: string, name: string, minutes: number): PendingRequest => ({
      id,
      kind: 'borrow',
      student: { id: `u-${id}`, name, email: `${id}@thapar.edu` },
      requestedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 1, totalCopies: 4 },
    })
    serve(METRICS, 200, {
      requests: [asking('1', 'Aditi Sharma', 40), asking('2', 'Rohan Verma', 30), asking('3', 'Priya Nair', 20), asking('4', 'Karan Mehta', 10)],
      counts: { all: 4, borrow: 4, room: 0 },
    })
    renderDashboard()
    expect(await screen.findByText('Waiting for approval (4)')).toBeInTheDocument()
    expect(screen.getByText('Aditi Sharma · Clean Code')).toBeInTheDocument()
    expect(screen.getByText('Priya Nair · Clean Code')).toBeInTheDocument()
    expect(screen.queryByText('Karan Mehta · Clean Code')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/requests')
  })

  it('says when no requests are waiting', async () => {
    serve(METRICS)
    renderDashboard()
    expect(await screen.findByText('No requests waiting.')).toBeInTheDocument()
  })

  it('refreshes the numbers on a metrics event without the skeleton', async () => {
    let round = 0
    mockFetch({
      'GET /admin/metrics/utilization': () =>
        json(200, { ...METRICS.utilization, today: { ...METRICS.utilization.today, percent: ++round === 1 ? 74 : 80 } }),
      'GET /admin/metrics/circulation': () => json(200, METRICS.circulation),
      'GET /admin/metrics/overdue': () => json(200, METRICS.overdue),
      'GET /admin/metrics/demand': () => json(200, METRICS.demand),
      'GET /admin/requests': () => json(200, NONE),
    })
    renderDashboard()
    expect(await screen.findByText('74%')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] }))
    expect(screen.queryByLabelText('Loading dashboard metrics')).toBeNull()

    expect(await screen.findByText('80%', {}, { timeout: 2_000 })).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading dashboard metrics')).toBeNull()
  })

  it('keeps the numbers on screen when a live refresh fails', async () => {
    let round = 0
    mockFetch({
      'GET /admin/metrics/utilization': () => (++round === 1 ? json(200, METRICS.utilization) : json(500, { error: 'x' })),
      'GET /admin/metrics/circulation': () => json(200, METRICS.circulation),
      'GET /admin/metrics/overdue': () => json(200, METRICS.overdue),
      'GET /admin/metrics/demand': () => json(200, METRICS.demand),
      'GET /admin/requests': () => json(200, NONE),
    })
    renderDashboard()
    expect(await screen.findByText('74%')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] }))
    await waitFor(() => expect(round).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('74%')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load dashboard metrics")).toBeNull()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `admin/`): `npx vitest run test/app/dashboard.test.tsx`
Expected: FAIL. There's no "Waiting for approval" panel, and a metrics event doesn't refetch.

- [ ] **Step 3: Add the panel**

Create `admin/components/dashboard/WaitingPanel.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { DeclineDialog } from '@/components/requests/DeclineDialog'
import { requestRow } from '@/components/requests/requestText'
import { useDecision } from '@/components/requests/useDecision'
import { waitingLabel } from '@/lib/format'
import type { PendingRequest } from '@/lib/requests'
import { useRequests } from '@/lib/requestsContext'
import { useNow } from '@/lib/useNow'

const SHOWN = 3

/** The Dashboard's "Waiting for approval" card: the oldest requests, decided in place. */
export function WaitingPanel() {
  const { state, retry } = useRequests()
  const count = state.kind === 'loaded' ? state.data.counts.all : 0
  return (
    <section className="card elev-sm" aria-labelledby="waiting-title" style={{ padding: '14px 16px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span id="waiting-title" className="card-title" style={{ fontSize: 14 }}>
          Waiting for approval ({count})
        </span>
        <Link href="/requests" style={{ fontSize: 12.5 }}>View all</Link>
      </div>
      {state.kind === 'loading' && <div className="sla-skel" aria-busy="true" aria-label="Loading requests" style={{ height: 22 }} />}
      {state.kind === 'error' && (
        <span className="text-muted" style={{ fontSize: 12.5 }}>
          Couldn&apos;t load requests.{' '}
          <button type="button" className="sla-link-btn" onClick={retry}>Retry</button>
        </span>
      )}
      {state.kind === 'loaded' &&
        (state.data.requests.length === 0 ? (
          <span className="text-muted" style={{ fontSize: 12.5 }}>No requests waiting.</span>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {state.data.requests.slice(0, SHOWN).map((r) => (
              <WaitingRow key={`${r.kind}:${r.id}`} request={r} />
            ))}
          </ul>
        ))}
    </section>
  )
}

function WaitingRow({ request }: { request: PendingRequest }) {
  const now = useNow()
  const { busy, approve, decline } = useDecision(request)
  const [declining, setDeclining] = useState(false)
  const borrow = request.kind === 'borrow'
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--color-divider)' }}>
      <span className={`tag ${borrow ? 'tag-accent' : 'tag-accent-2'}`} style={{ flex: 'none' }}>{borrow ? 'Borrow' : 'Room'}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {requestRow(request)}
      </span>
      <span className="text-muted" style={{ fontSize: 11.5, flex: 'none' }}>{waitingLabel(now - Date.parse(request.requestedAt))}</span>
      <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12, flex: 'none' }} disabled={busy} onClick={() => void approve()}>
        Approve
      </button>
      <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, flex: 'none' }} disabled={busy} onClick={() => setDeclining(true)}>
        Decline
      </button>
      {declining && (
        <DeclineDialog
          request={request}
          onCancel={() => setDeclining(false)}
          onConfirm={(reason) => {
            setDeclining(false)
            void decline(reason)
          }}
        />
      )}
    </li>
  )
}
```

- [ ] **Step 4: Refresh the numbers live**

Replace `admin/app/(console)/dashboard/page.tsx` with:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardEmpty, DashboardError, DashboardSkeleton } from '@/components/dashboard/DashboardStates'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { WaitingPanel } from '@/components/dashboard/WaitingPanel'
import { ApiError } from '@/lib/api'
import { useLiveRefresh } from '@/lib/liveContext'
import { fetchDashboardMetrics, isEmpty, type DashboardMetrics } from '@/lib/metrics'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; metrics: DashboardMetrics }

export default function DashboardPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  // `quiet` is a live refresh: no skeleton, and a failure keeps the numbers on screen.
  const load = useCallback((quiet = false) => {
    if (!quiet) setState({ kind: 'loading' })
    fetchDashboardMetrics()
      .then((metrics) => setState({ kind: 'loaded', metrics }))
      .catch((error: unknown) => {
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
        if (!quiet) setState({ kind: 'error' })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useLiveRefresh(['metrics'], () => load(true))

  return (
    <>
      <WaitingPanel />
      {state.kind === 'loading' ? (
        <DashboardSkeleton />
      ) : state.kind === 'error' ? (
        <DashboardError onRetry={() => load()} />
      ) : isEmpty(state.metrics) ? (
        <DashboardEmpty />
      ) : (
        <DashboardView metrics={state.metrics} />
      )}
    </>
  )
}
```

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run test/app/dashboard.test.tsx`
Expected: PASS (10 tests).
Run: `npm test`
Expected: all files pass.
Run: `npm run build`
Expected: completes; the route list includes `/requests`.

- [ ] **Step 6: Hand off the commit**

```bash
git add components/dashboard/WaitingPanel.tsx "app/(console)/dashboard/page.tsx" test/app/dashboard.test.tsx
git commit -m "admin: show waiting requests on the Dashboard and refresh its numbers live" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Capture the new payloads

**Files:**
- Modify: `frontend/tool/capture_fixtures.dart` (whole file)
- Create (captured): `frontend/test/fixtures/borrow_request_created.json`, `borrow_requests_me.json`, `booking_room_requested.json`, `bookings_me_requests.json`, `loans_create_409.json`
- Modify (recaptured): every other file in `frontend/test/fixtures/`
- Delete: `frontend/test/fixtures/loan_created.json`
- Modify: `frontend/test/features/loans/http_loan_repository_test.dart`, `frontend/test/models/loan_json_test.dart` (drop the two tests that read `loan_created`)

**Interfaces:**
- Consumes: the backend from Tasks 1–7, running locally with migrations applied and freshly seeded; a dev admin account.
- Produces: the five new fixtures above, which Tasks 14–15 parse.

- [ ] **Step 1: Prepare the backend and a dev admin**

Run (in `backend/`): `npx prisma migrate deploy && npm run seed`
Expected: no pending migrations; the seed's three lines.

Generate a throwaway password for the dev admin into the session scratchpad (`$SCRATCH`), never printing it:

```bash
SCRATCH="C:/Users/ragha/AppData/Local/Temp/claude/c--Users-ragha-project-SmartLib/5085a232-4d7a-422a-a5a9-c59ea926f657/scratchpad"
node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))" > "$SCRATCH/dev-admin-password.txt"
```

Create `backend/zz-dev-admin.ts` (temporary):

```ts
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { prisma } from './src/lib/prisma'
import { createOrPromoteAdmin } from './src/services/adminAccountService'

const password = readFileSync(process.argv[2], 'utf8')
createOrPromoteAdmin({ name: 'Dev Librarian', email: 'dev.admin@thapar.edu', password }, async () => true)
  .then((result) => console.log(result))
  .finally(() => prisma.$disconnect())
```

Run: `npx tsx zz-dev-admin.ts "$SCRATCH/dev-admin-password.txt"`, then delete `backend/zz-dev-admin.ts`.
Expected: `promoted` (the account exists from slice 1, and now has the new password), or `created`.

Start the backend in the background: `npm run dev`, and wait for `Node backend running on port 3000`.

- [ ] **Step 2: Rewrite the capture tool**

Replace `frontend/tool/capture_fixtures.dart` with:

```dart
// tool/capture_fixtures.dart
//
// Captures real backend responses into test/fixtures/ so the model
// serialization tests parse bytes that actually came off the wire, rather
// than a hand-typed guess at the DTOs. Re-run it whenever a backend DTO
// changes.
//
// It MUTATES the dev database -- creates bookings and requests, checks in,
// renews a loan, and has an admin decide requests -- so run it against a
// freshly seeded backend and re-seed afterwards. The decisions need an admin
// account. Its password is read from a file, so it never appears in a command
// line or a log:
//
//   cd ../backend && npm run seed && npm run dev      # separate terminal
//   SMARTLIB_ADMIN_EMAIL=dev.admin@thapar.edu \
//   SMARTLIB_ADMIN_PASSWORD_FILE=/path/to/password.txt \
//     dart run tool/capture_fixtures.dart             # from frontend/
//   cd ../backend && npm run seed                     # restore demo state
//
// Set SMARTLIB_API_BASE_URL to target something other than localhost:3000.
//
// The login token is redacted before it's written: the demo account has a
// fixed id ('u1'), so a real token would keep working against the dev
// database for its full 7-day lifetime if it were committed.
import 'dart:convert';
import 'dart:io';

final _baseUrl = Platform.environment['SMARTLIB_API_BASE_URL'] ?? 'http://localhost:3000';
final _out = Directory('test/fixtures');
final _client = HttpClient();
const _encoder = JsonEncoder.withIndent('  ');

typedef _Response = ({int status, Object? body});

Future<_Response> _call(String method, String path, {Object? body, String? token}) async {
  final req = await _client.openUrl(method, Uri.parse('$_baseUrl$path'));
  req.headers.contentType = ContentType.json;
  if (token != null) req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
  if (body != null) req.write(jsonEncode(body));
  final res = await req.close();
  final text = await res.transform(utf8.decoder).join();
  return (status: res.statusCode, body: text.isEmpty ? null : jsonDecode(text));
}

/// Fails loudly unless [r] came back with [expect].
void _check(String what, _Response r, int expect) {
  if (r.status != expect) throw StateError('$what returned ${r.status}, expected $expect: ${r.body}');
}

String _idOf(_Response r) => (r.body! as Map<String, dynamic>)['id'] as String;

/// Calls the endpoint, fails loudly if the status isn't [expect], and writes
/// the (optionally [redact]ed) body to `test/fixtures/<name>.json`.
Future<Object?> _save(
  String name,
  String method,
  String path, {
  required int expect,
  Object? body,
  String? token,
  Object? Function(Object? body)? redact,
}) async {
  final r = await _call(method, path, body: body, token: token);
  _check('$method $path', r, expect);
  final written = redact == null ? r.body : redact(r.body);
  File('${_out.path}/$name.json').writeAsStringSync('${_encoder.convert(written)}\n');
  stdout.writeln('  $name.json  <- $method $path (${r.status})');
  return r.body;
}

// The backend's zod schema requires an offset, so every outgoing timestamp is
// UTC ('...Z'). Truncated to whole seconds to keep the payloads tidy.
String _iso(DateTime local) =>
    DateTime.fromMillisecondsSinceEpoch(local.millisecondsSinceEpoch ~/ 1000 * 1000).toUtc().toIso8601String();

String _ymd(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Logs in the admin who decides requests during the capture.
Future<String> _adminToken() async {
  final email = Platform.environment['SMARTLIB_ADMIN_EMAIL'];
  final passwordFile = Platform.environment['SMARTLIB_ADMIN_PASSWORD_FILE'];
  if (email == null || passwordFile == null) {
    throw StateError('Set SMARTLIB_ADMIN_EMAIL, and SMARTLIB_ADMIN_PASSWORD_FILE to a file holding that account\'s password.');
  }
  final r = await _call('POST', '/auth/login', body: {'email': email, 'password': File(passwordFile).readAsStringSync().trim()});
  // Only the status: nothing about a failed admin login belongs in a log.
  if (r.status != 200) throw StateError('Admin login returned ${r.status}.');
  return (r.body! as Map<String, dynamic>)['token'] as String;
}

Future<void> main() async {
  _out.createSync(recursive: true);
  stdout.writeln('Capturing from $_baseUrl into ${_out.path}/');

  // --- Auth ---------------------------------------------------------------
  final login = await _save('auth_login', 'POST', '/auth/login',
      expect: 200,
      body: {'email': 'aditi.sharma@thapar.edu', 'password': 'password123'},
      redact: (b) => {...b! as Map<String, dynamic>, 'token': '<redacted-jwt>'});
  final token = (login! as Map<String, dynamic>)['token'] as String;
  await _save('auth_me', 'GET', '/auth/me', expect: 200, token: token);
  final adminToken = await _adminToken();

  // --- Catalog ------------------------------------------------------------
  await _save('books_search', 'GET', '/books/search', expect: 200);
  await _save('book_by_id', 'GET', '/books/b1', expect: 200);

  // --- Loans (read first, so the list reflects the untouched seed) -------
  final loans = await _save('loans_me', 'GET', '/loans/me', expect: 200, token: token);

  // --- Borrow requests ------------------------------------------------------
  // b12 stays pending. b5 is declined by the admin, with a reason.
  await _save('borrow_request_created', 'POST', '/borrow-requests', expect: 201, token: token, body: {'bookId': 'b12'});
  final b5 = await _call('POST', '/borrow-requests', token: token, body: {'bookId': 'b5'});
  _check('requesting b5', b5, 201);
  _check('declining it', await _call('POST', '/admin/requests/borrow/${_idOf(b5)}/decline',
      token: adminToken, body: {'reason': 'This copy is set aside for a course reserve.'}), 200);
  await _save('borrow_requests_me', 'GET', '/borrow-requests/me', expect: 200, token: token);

  // --- Resources ----------------------------------------------------------
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final tomorrow = today.add(const Duration(days: 1));
  await _save('resources_availability_seats', 'GET', '/resources/availability?type=seat&date=${_ymd(today)}',
      expect: 200);
  await _save('resources_availability_rooms', 'GET', '/resources/availability?type=room&date=${_ymd(today)}',
      expect: 200);

  // --- Bookings -----------------------------------------------------------
  // s3 (Silent Zone Desk 3) has no seeded bookings, so both of these land.
  // One far in the future (upcomingFar); one that started two minutes ago so
  // it reads as inWindow with a live graceRemainingSeconds.
  await _save('booking_created', 'POST', '/bookings',
      expect: 201,
      token: token,
      body: {
        'resourceId': 's3',
        'startTime': _iso(tomorrow.add(const Duration(hours: 10))),
        'endTime': _iso(tomorrow.add(const Duration(hours: 11))),
      });
  final inWindow = await _call('POST', '/bookings', token: token, body: {
    'resourceId': 's3',
    'startTime': _iso(now.subtract(const Duration(minutes: 2))),
    'endTime': _iso(now.add(const Duration(minutes: 58))),
  });
  _check('in-window booking', inWindow, 201);
  await _save('bookings_me', 'GET', '/bookings/me', expect: 200, token: token);

  // --- Room requests --------------------------------------------------------
  // Rooms are requests now. The conflict holder (r1, tomorrow 2 PM) stays
  // pending; asking for the same slot again is the 409, which yields both
  // alternative kinds: r1 at another hour, and another room at 2 PM. Made
  // tomorrow so it works at any time of day.
  final conflictSlot = {
    'resourceId': 'r1',
    'startTime': _iso(tomorrow.add(const Duration(hours: 14))),
    'endTime': _iso(tomorrow.add(const Duration(hours: 15))),
  };
  await _save('booking_room_requested', 'POST', '/bookings', expect: 201, token: token, body: conflictSlot);
  await _save('booking_conflict_409', 'POST', '/bookings', expect: 409, token: token, body: conflictSlot);

  // r1 tomorrow at 10 AM, declined without a reason.
  final toDecline = await _call('POST', '/bookings', token: token, body: {
    'resourceId': 'r1',
    'startTime': _iso(tomorrow.add(const Duration(hours: 10))),
    'endTime': _iso(tomorrow.add(const Duration(hours: 11))),
  });
  _check('requesting r1 at 10 AM', toDecline, 201);
  _check('declining it', await _call('POST', '/admin/requests/room/${_idOf(toDecline)}/decline',
      token: adminToken, body: <String, dynamic>{}), 200);

  // An expired request: its slot started 14 min 55 s ago, so its 15-minute
  // grace period runs out 5 s later. Today the seed holds r1 from 2 to 4 PM
  // and r3 from 10 AM to noon; an hour-long window overlaps at most one.
  final lapseStart = DateTime.now().subtract(const Duration(minutes: 14, seconds: 55));
  final lapseEnd = lapseStart.add(const Duration(hours: 1));
  bool overlaps(int fromHour, int toHour) =>
      lapseStart.isBefore(today.add(Duration(hours: toHour))) && lapseEnd.isAfter(today.add(Duration(hours: fromHour)));
  final lapsing = await _call('POST', '/bookings', token: token, body: {
    'resourceId': overlaps(14, 16) ? 'r3' : 'r1',
    'startTime': _iso(lapseStart),
    'endTime': _iso(lapseEnd),
  });
  _check('requesting a room about to lapse', lapsing, 201);
  await Future<void>.delayed(const Duration(seconds: 7));
  await _save('bookings_me_requests', 'GET', '/bookings/me', expect: 200, token: token);

  final inWindowId = _idOf(inWindow);
  await _save('booking_checked_in', 'POST', '/bookings/$inWindowId/checkin', expect: 200, token: token);

  // --- Loan mutations -----------------------------------------------------
  final b1Loan = (loans! as List).cast<Map<String, dynamic>>().firstWhere((l) => l['bookId'] == 'b1');
  await _save('loan_renewed', 'POST', '/loans/${b1Loan['id']}/renew', expect: 200, token: token);

  // --- Waitlist -----------------------------------------------------------
  // A held copy needs someone else to return one while Aditi is first in
  // line: a seed student requests b9's last copy and the admin approves it,
  // Aditi queues for b9, and the student returns it -- the backend then holds
  // that copy for Aditi. The seed's history may already have lent b9 to some
  // seed students, so the first one who can request it is used. b2 has no
  // copies free and two students already queued, so Aditi joins that one third.
  String? studentToken;
  String? studentRequestId;
  for (var i = 1; i <= 6 && studentRequestId == null; i++) {
    final student = await _call('POST', '/auth/login',
        body: {'email': 'seed.student$i@thapar.edu', 'password': 'password123'});
    _check('seed student $i login', student, 200);
    final t = (student.body! as Map<String, dynamic>)['token'] as String;
    final asked = await _call('POST', '/borrow-requests', token: t, body: {'bookId': 'b9'});
    if (asked.status == 201) {
      studentToken = t;
      studentRequestId = _idOf(asked);
    }
  }
  if (studentToken == null || studentRequestId == null) throw StateError('No seed student could request b9.');
  _check('approving it', await _call('POST', '/admin/requests/borrow/$studentRequestId/approve', token: adminToken), 200);
  await _save('reservation_created', 'POST', '/reservations', expect: 201, token: token, body: {'bookId': 'b9'});
  final studentLoans = await _call('GET', '/loans/me', token: studentToken);
  _check('student loans', studentLoans, 200);
  final studentLoanId =
      (studentLoans.body! as List).cast<Map<String, dynamic>>().firstWhere((l) => l['bookId'] == 'b9')['id'];
  _check('student return', await _call('POST', '/loans/$studentLoanId/return', token: studentToken), 200);
  final queued = await _call('POST', '/reservations', token: token, body: {'bookId': 'b2'});
  _check('joining b2', queued, 201);
  await _save('reservations_me', 'GET', '/reservations/me', expect: 200, token: token);
  await _save('book_held', 'GET', '/books/b9', expect: 200);

  // --- Profile & recommendations (after the check-in, so history carries
  // both an 'ok' and a 'miss') ------------------------------------------
  await _save('profile_reliability', 'GET', '/profile/reliability', expect: 200, token: token);
  await _save('recommendations_me', 'GET', '/recommendations/me', expect: 200, token: token);

  // --- Error shapes -------------------------------------------------------
  await _save('error_400', 'POST', '/bookings', expect: 400, token: token, body: <String, dynamic>{});
  await _save('error_401', 'GET', '/loans/me', expect: 401);
  await _save('error_404', 'GET', '/books/does-not-exist', expect: 404);
  // Aditi already has b1 on loan.
  await _save('error_409', 'POST', '/borrow-requests', expect: 409, token: token, body: {'bookId': 'b1'});
  // What an older app version gets when it tries to borrow.
  await _save('loans_create_409', 'POST', '/loans', expect: 409, token: token, body: {'bookId': 'b1'});

  _client.close();
  stdout.writeln('Done. Now re-seed the backend: cd ../backend && npm run seed');
}
```

- [ ] **Step 3: Capture**

Run (in `frontend/`):

```bash
SMARTLIB_ADMIN_EMAIL=dev.admin@thapar.edu SMARTLIB_ADMIN_PASSWORD_FILE="$SCRATCH/dev-admin-password.txt" dart run tool/capture_fixtures.dart
```

Expected: one `<name>.json <- METHOD path (status)` line per fixture, including `borrow_request_created`, `borrow_requests_me`, `booking_room_requested`, `bookings_me_requests` and `loans_create_409`, then `Done.`

- [ ] **Step 4: Retire the instant-borrow fixture**

Delete `frontend/test/fixtures/loan_created.json`. In `frontend/test/features/loans/http_loan_repository_test.dart` delete the test `createLoan borrows the book and returns the new loan`; in `frontend/test/models/loan_json_test.dart` delete the test `parses the loan returned by POST /loans`.

- [ ] **Step 5: Restore the dev data, which also proves the seed copes with requests**

Run (in `backend/`): `npm run seed`
Expected: the seed's three lines. It now deletes the borrow requests the capture made before the copies they hold.

- [ ] **Step 6: Run the student app's suite**

Run (in `frontend/`): `flutter analyze && flutter test`
Expected: no issues; all tests pass. If an existing fixture test fails because the seed's four-week history changed a value it asserts (for example a recommendation), update that assertion to the captured value and record it as a ruling.

- [ ] **Step 7: Hand off the commit**

```bash
git add tool/capture_fixtures.dart test/fixtures test/features/loans/http_loan_repository_test.dart test/models/loan_json_test.dart
git commit -m "frontend: capture request payloads from the real server" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Request statuses in the models

**Files:**
- Create: `frontend/lib/models/borrow_request.dart` (+ generated `borrow_request.g.dart`)
- Modify: `frontend/lib/models/resource_booking.dart`, `loan.dart`, `reservation.dart` (+ their regenerated `.g.dart`)
- Modify: `frontend/lib/features/loans/loans_screen.dart` (the waitlist switch gains its `unknown` arm)
- Test: `frontend/test/models/borrow_request_json_test.dart` (new), `resource_booking_json_test.dart`, `loan_json_test.dart`, `reservation_json_test.dart`

**Interfaces:**
- Consumes: the fixtures from Task 13.
- Produces: `enum BorrowRequestStatus { pending, approved, declined, expired, cancelled, unknown }`; `class BorrowRequest { id, bookId, bookTitle, status, requestedAt, expiresAt, decidedAt?, declineReason? }`; `BookingStatus` gains `requested, declined, expired, unknown`; `ResourceBooking` gains `DateTime? expiresAt` and `String? declineReason`; `LoanStatus.unknown`; `ReservationStatus.unknown`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/models/borrow_request_json_test.dart`:

```dart
// test/models/borrow_request_json_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:smartlib_frontend/models/borrow_request.dart';
import '../support/fixtures.dart';

void main() {
  test('parses a new request: pending, with its 24-hour deadline in local time', () {
    final r = BorrowRequest.fromJson(fixture('borrow_request_created') as Map<String, dynamic>);
    expect(r.bookId, 'b12');
    expect(r.bookTitle, 'Atomic Habits');
    expect(r.status, BorrowRequestStatus.pending);
    expect(r.decidedAt, isNull);
    expect(r.declineReason, isNull);
    expect(r.expiresAt.isUtc, false);
    expect(r.expiresAt.difference(r.requestedAt), const Duration(hours: 24));
  });

  test("parses the student's list: the pending request and the declined one with its reason", () {
    final list = (fixture('borrow_requests_me') as List)
        .map((j) => BorrowRequest.fromJson(j as Map<String, dynamic>))
        .toList();
    expect(list.singleWhere((r) => r.bookId == 'b12').status, BorrowRequestStatus.pending);
    final declined = list.singleWhere((r) => r.bookId == 'b5');
    expect(declined.status, BorrowRequestStatus.declined);
    expect(declined.declineReason, 'This copy is set aside for a course reserve.');
    expect(declined.decidedAt, isNotNull);
  });

  test('parses an expired request (derived from the pending one: the server needs 24 hours to make one)', () {
    final raw = {
      ...fixture('borrow_request_created') as Map<String, dynamic>,
      'status': 'expired',
      'decidedAt': '2026-10-21T09:00:00.000Z',
    };
    final r = BorrowRequest.fromJson(raw);
    expect(r.status, BorrowRequestStatus.expired);
    expect(r.decidedAt!.isUtc, false);
  });

  test("a status this version doesn't know falls back to unknown instead of failing the list", () {
    final raw = {...fixture('borrow_request_created') as Map<String, dynamic>, 'status': 'escalated'};
    expect(BorrowRequest.fromJson(raw).status, BorrowRequestStatus.unknown);
  });
}
```

Append to `frontend/test/models/resource_booking_json_test.dart` (inside `main`):

```dart
  test('parses room requests: requested with its hold deadline, declined, and expired', () {
    final bookings = (fixture('bookings_me_requests') as List)
        .map((j) => ResourceBooking.fromJson(j as Map<String, dynamic>))
        .toList();
    final requested = bookings.singleWhere((b) => b.status == BookingStatus.requested);
    expect(requested.expiresAt, requested.startTime.add(kCheckInGracePeriod));
    final declined = bookings.singleWhere((b) => b.status == BookingStatus.declined);
    expect(declined.declineReason, isNull); // declined without a reason
    expect(bookings.where((b) => b.status == BookingStatus.expired), hasLength(1));
  });

  test('a new room booking comes back as a request, held until the grace period ends', () {
    final b = ResourceBooking.fromJson(fixture('booking_room_requested') as Map<String, dynamic>);
    expect(b.type, ResourceType.room);
    expect(b.status, BookingStatus.requested);
    expect(b.expiresAt!.isUtc, false);
    expect(b.expiresAt, b.startTime.add(kCheckInGracePeriod));
  });

  test("a status this version doesn't know falls back to unknown", () {
    final raw = {...(fixture('bookings_me') as List).first as Map<String, dynamic>, 'frontendStatus': 'paused'};
    expect(ResourceBooking.fromJson(raw).status, BookingStatus.unknown);
  });
```

Append to `frontend/test/models/loan_json_test.dart` (inside `main`):

```dart
  test("a status this version doesn't know falls back to unknown", () {
    final raw = {...(fixture('loans_me') as List).first as Map<String, dynamic>, 'frontendStatus': 'lost'};
    expect(Loan.fromJson(raw).status, LoanStatus.unknown);
  });
```

Append to `frontend/test/models/reservation_json_test.dart` (inside `main`):

```dart
  test("a status this version doesn't know falls back to unknown", () {
    final raw = {...(fixture('reservations_me') as List).first as Map<String, dynamic>, 'status': 'paused'};
    expect(Reservation.fromJson(raw).status, ReservationStatus.unknown);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `frontend/`): `flutter test test/models`
Expected: FAIL to compile. `borrow_request.dart` doesn't exist, and `BookingStatus.requested`, `expiresAt`, `LoanStatus.unknown` and `ReservationStatus.unknown` are undefined.

- [ ] **Step 3: Add the borrow request model**

Create `frontend/lib/models/borrow_request.dart`:

```dart
import 'package:json_annotation/json_annotation.dart';
import 'json_converters.dart';

part 'borrow_request.g.dart';

/// GET /borrow-requests/me sends pending requests and those declined or
/// expired in the last 7 days; approved and withdrawn ones drop off (the loan
/// appears instead). [unknown] stands in for a status this version doesn't
/// know, so one new value never fails the whole list.
enum BorrowRequestStatus { pending, approved, declined, expired, cancelled, unknown }

/// A student's request to borrow a book, waiting for a librarian.
@JsonSerializable(createToJson: false)
class BorrowRequest {
  const BorrowRequest({
    required this.id,
    required this.bookId,
    required this.bookTitle,
    required this.status,
    required this.requestedAt,
    required this.expiresAt,
    this.decidedAt,
    this.declineReason,
  });

  factory BorrowRequest.fromJson(Map<String, dynamic> json) => _$BorrowRequestFromJson(json);

  final String id;
  final String bookId;
  final String bookTitle;

  @JsonKey(unknownEnumValue: BorrowRequestStatus.unknown)
  final BorrowRequestStatus status;

  @JsonKey(fromJson: localDateTime)
  final DateTime requestedAt;

  /// When the held copy goes back to the shelf if no librarian has decided.
  @JsonKey(fromJson: localDateTime)
  final DateTime expiresAt;

  @JsonKey(fromJson: localDateTimeOrNull)
  final DateTime? decidedAt;

  /// Set only on a declined request, and only if the librarian gave one.
  final String? declineReason;
}
```

- [ ] **Step 4: Teach the other models the new statuses**

In `frontend/lib/models/resource_booking.dart`:
- Replace the enum and its doc comment with:

```dart
/// Wire values are the backend's `frontendStatus` strings, which already use
/// these exact names. 'released' is computed server-side at read time (grace
/// window elapsed without check-in) -- it's never persisted. A room booking
/// is 'requested' until a librarian decides; 'declined' and 'expired' are its
/// two unhappy endings. [unknown] stands in for a status this version doesn't
/// know, so one new value never fails the whole list.
enum BookingStatus { upcomingFar, inWindow, checkedIn, released, requested, declined, expired, unknown }
```

- Add `this.expiresAt, this.declineReason,` to the constructor after `this.graceRemainingSeconds = 0,`.
- Change the status annotation to `@JsonKey(name: 'frontendStatus', unknownEnumValue: BookingStatus.unknown)`.
- After `final int graceRemainingSeconds;` add:

```dart
  /// A room request's deadline: its start plus the grace period. Null otherwise.
  @JsonKey(fromJson: localDateTimeOrNull)
  final DateTime? expiresAt;

  /// Set only on a declined request, and only if the librarian gave one.
  final String? declineReason;
```

- In `copyWith`, pass `expiresAt: expiresAt, declineReason: declineReason,` to the constructor.

In `frontend/lib/models/loan.dart`, change the enum to `enum LoanStatus { normal, overdue, unknown }`, with the doc comment `/// [unknown] stands in for a status this version doesn't know, so one new value never fails the whole list.`, and the status annotation to `@JsonKey(name: 'frontendStatus', unknownEnumValue: LoanStatus.unknown)`.

In `frontend/lib/models/reservation.dart`, change the enum's doc comment to `/// GET /reservations/me only returns live entries, so these are the only two it sends today.` and add a third value after `held`:

```dart
  /// A status this version doesn't know; one new value never fails the list.
  unknown,
```

and annotate the field: `@JsonKey(unknownEnumValue: ReservationStatus.unknown)` above `final ReservationStatus status;`.

In `frontend/lib/features/loans/loans_screen.dart`, the waitlist card's `switch (r.status)` is exhaustive, so add its third arm:

```dart
      ReservationStatus.unknown => "Update the app to see this item's status.",
```

- [ ] **Step 5: Regenerate and run the tests**

Run: `dart run build_runner build`
Expected: writes `borrow_request.g.dart` and updates the other three `.g.dart` files.
Run: `flutter test test/models`
Expected: PASS.
Run: `flutter analyze && flutter test`
Expected: no issues; all pass.

- [ ] **Step 6: Hand off the commit**

```bash
git add lib/models/borrow_request.dart lib/models/borrow_request.g.dart lib/models/resource_booking.dart lib/models/resource_booking.g.dart lib/models/loan.dart lib/models/loan.g.dart lib/models/reservation.dart lib/models/reservation.g.dart lib/features/loans/loans_screen.dart test/models
git commit -m "frontend: model borrow requests and the new booking statuses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Borrow request repository and controller

**Files:**
- Create: `frontend/lib/features/borrow_requests/borrow_request_repository.dart`
- Create: `frontend/lib/features/borrow_requests/borrow_requests_controller.dart`
- Modify: `frontend/lib/features/loans/loans_controller.dart` (add `refreshQuietly`)
- Modify: `frontend/lib/features/bookings/bookings_controller.dart` (add `refreshQuietly`)
- Modify: `frontend/test/support/mock_overrides.dart`
- Test: `frontend/test/features/borrow_requests/http_borrow_request_repository_test.dart`, `frontend/test/features/borrow_requests/borrow_requests_controller_test.dart`, `frontend/test/features/quiet_refresh_test.dart`

**Interfaces:**
- Consumes: `BorrowRequest`, `BorrowRequestStatus` (Task 14); `guardApi`, `apiClientProvider`, `ConflictException`, `ApiException` (existing).
- Produces: `abstract class BorrowRequestRepository { mine(); create(bookId); cancel(requestId) }`; `HttpBorrowRequestRepository`; `MockBorrowRequestRepository(BookRepository books, {List<BorrowRequest> requests})` with `decide(bookId, status, {reason})`; `borrowRequestRepositoryProvider`; `BorrowRequestsController` (`request`, `cancel`, `refreshQuietly`); `borrowRequestsControllerProvider`; extension `BorrowRequestLookup` (`latestFor`, `latestPerBook`, `anyPending`); `LoansController.refreshQuietly()`; `BookingsController.refreshQuietly()`; `mockRepositoryOverrides(borrowRequests: ...)`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/features/borrow_requests/http_borrow_request_repository_test.dart`:

```dart
// test/features/borrow_requests/http_borrow_request_repository_test.dart
import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartlib_frontend/core/api_client.dart';
import 'package:smartlib_frontend/core/api_exception.dart';
import 'package:smartlib_frontend/core/auth/token_store.dart';
import 'package:smartlib_frontend/features/borrow_requests/borrow_request_repository.dart';
import 'package:smartlib_frontend/models/borrow_request.dart';
import '../../support/fake_token_store.dart';
import '../../support/fixtures.dart';
import '../../support/stub_http_adapter.dart';

void main() {
  (HttpBorrowRequestRepository, StubHttpAdapter) repo(FutureOr<StubResponse> Function(RequestOptions) respond) {
    final dio = buildApiClient(TokenStore(InMemoryTokenPersistence()));
    final stub = StubHttpAdapter(respond);
    dio.httpClientAdapter = stub;
    return (HttpBorrowRequestRepository(dio), stub);
  }

  test("mine fetches the student's requests", () async {
    final (requests, stub) = repo((_) => StubResponse(200, fixture('borrow_requests_me')));
    final list = await requests.mine();
    expect(stub.requests.single.path, '/borrow-requests/me');
    expect(list.map((r) => r.bookId), containsAll(['b12', 'b5']));
  });

  test('create posts the book and returns the pending request', () async {
    final (requests, stub) = repo((_) => StubResponse(201, fixture('borrow_request_created')));
    final r = await requests.create('b12');
    expect(stub.requests.single.method, 'POST');
    expect(stub.requests.single.path, '/borrow-requests');
    expect(stub.requests.single.data, {'bookId': 'b12'});
    expect(r.status, BorrowRequestStatus.pending);
  });

  test('cancel posts the withdrawal', () async {
    final (requests, stub) = repo((_) => StubResponse(200, fixture('borrow_request_created')));
    await requests.cancel('br-1');
    expect(stub.requests.single.method, 'POST');
    expect(stub.requests.single.path, '/borrow-requests/br-1/cancel');
  });

  test("a refused request carries the server's reason", () async {
    final (requests, _) = repo((_) => const StubResponse(409, {'error': "You've already requested this book."}));
    await expectLater(
      requests.create('b12'),
      throwsA(isA<ConflictException>().having((e) => e.message, 'message', "You've already requested this book.")),
    );
  });
}
```

Create `frontend/test/features/borrow_requests/borrow_requests_controller_test.dart`:

```dart
// test/features/borrow_requests/borrow_requests_controller_test.dart
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartlib_frontend/core/api_exception.dart';
import 'package:smartlib_frontend/features/auth/auth_controller.dart';
import 'package:smartlib_frontend/features/borrow_requests/borrow_request_repository.dart';
import 'package:smartlib_frontend/features/borrow_requests/borrow_requests_controller.dart';
import 'package:smartlib_frontend/features/catalog/book_repository.dart';
import 'package:smartlib_frontend/models/borrow_request.dart';
import '../../support/mock_overrides.dart';

/// The mock, counting calls, with failures, stalls and server answers on demand.
class _ScriptedRequests extends MockBorrowRequestRepository {
  _ScriptedRequests({super.requests}) : super(MockBookRepository());

  int fetches = 0;
  int creates = 0;
  Object? mineError;
  Object? createError;
  Completer<void>? createGate;

  /// When set, fetches return this: what the server says after a decision.
  List<BorrowRequest>? serverSays;

  @override
  Future<List<BorrowRequest>> mine() {
    fetches++;
    if (mineError != null) return Future.error(mineError!);
    final answer = serverSays;
    return answer != null ? Future.value(List.of(answer)) : super.mine();
  }

  @override
  Future<BorrowRequest> create(String bookId) async {
    creates++;
    await createGate?.future;
    if (createError != null) throw createError!;
    return super.create(bookId);
  }
}

BorrowRequest _request(String id, String bookId, BorrowRequestStatus status, {Duration age = Duration.zero}) {
  final requestedAt = DateTime.now().subtract(age);
  return BorrowRequest(
    id: id,
    bookId: bookId,
    bookTitle: 'Title $bookId',
    status: status,
    requestedAt: requestedAt,
    expiresAt: requestedAt.add(const Duration(hours: 24)),
    decidedAt: status == BorrowRequestStatus.pending ? null : requestedAt.add(const Duration(hours: 1)),
  );
}

void main() {
  Future<(ProviderContainer, _ScriptedRequests)> loaded({List<BorrowRequest> requests = const []}) async {
    final repo = _ScriptedRequests(requests: requests);
    final container = ProviderContainer(overrides: mockRepositoryOverrides(borrowRequests: repo));
    addTearDown(container.dispose);
    await container.read(borrowRequestsControllerProvider.future);
    return (container, repo);
  }

  test("loads the student's requests", () async {
    final pending = _request('br-1', 'b12', BorrowRequestStatus.pending);
    final (container, _) = await loaded(requests: [pending]);
    expect(container.read(borrowRequestsControllerProvider).value, [pending]);
  });

  test('requesting puts the new pending request first', () async {
    final (container, _) = await loaded(requests: [_request('br-0', 'b5', BorrowRequestStatus.declined)]);
    await container.read(borrowRequestsControllerProvider.notifier).request('b12');
    final first = container.read(borrowRequestsControllerProvider).value!.first;
    expect(first.bookId, 'b12');
    expect(first.bookTitle, 'Atomic Habits');
    expect(first.status, BorrowRequestStatus.pending);
  });

  test('a double tap requests once', () async {
    final (container, repo) = await loaded();
    repo.createGate = Completer<void>();
    final notifier = container.read(borrowRequestsControllerProvider.notifier);
    final first = notifier.request('b12');
    final second = notifier.request('b12');
    repo.createGate!.complete();
    await Future.wait([first, second]);
    expect(repo.creates, 1);
    expect(container.read(borrowRequestsControllerProvider).value, hasLength(1));
  });

  test('a refused request is reported, and the list is refetched -- it was stale', () async {
    final (container, repo) = await loaded();
    repo.createError = const ConflictException("You've already requested this book.");
    await expectLater(
      container.read(borrowRequestsControllerProvider.notifier).request('b12'),
      throwsA(isA<ConflictException>()),
    );
    await container.read(borrowRequestsControllerProvider.future);
    expect(repo.fetches, 2);
  });

  test('cancelling removes the request', () async {
    final (container, _) = await loaded();
    final notifier = container.read(borrowRequestsControllerProvider.notifier);
    await notifier.request('b12');
    final id = container.read(borrowRequestsControllerProvider).value!.single.id;
    await notifier.cancel(id);
    expect(container.read(borrowRequestsControllerProvider).value, isEmpty);
  });

  test("refreshQuietly shows what the server says now", () async {
    final (container, repo) = await loaded(requests: [_request('br-1', 'b12', BorrowRequestStatus.pending)]);
    repo.serverSays = [];
    await container.read(borrowRequestsControllerProvider.notifier).refreshQuietly();
    expect(container.read(borrowRequestsControllerProvider).value, isEmpty);
  });

  test('refreshQuietly keeps the list when the network fails', () async {
    final pending = _request('br-1', 'b12', BorrowRequestStatus.pending);
    final (container, repo) = await loaded(requests: [pending]);
    repo.mineError = const ApiException(0, ApiException.networkMessage);
    await container.read(borrowRequestsControllerProvider.notifier).refreshQuietly();
    final state = container.read(borrowRequestsControllerProvider);
    expect(state.hasError, false);
    expect(state.value, [pending]);
  });

  test('looks up the newest request per title, and whether any is pending', () {
    final list = [
      _request('br-3', 'b12', BorrowRequestStatus.pending),
      _request('br-2', 'b12', BorrowRequestStatus.declined, age: const Duration(hours: 5)),
      _request('br-1', 'b5', BorrowRequestStatus.expired, age: const Duration(hours: 9)),
    ];
    expect(list.latestPerBook().map((r) => r.id), ['br-3', 'br-1']);
    expect(list.latestFor('b12')!.id, 'br-3');
    expect(list.latestFor('b1'), isNull);
    expect(list.anyPending, true);
    expect([list[1], list[2]].anyPending, false);
  });

  test("a different user logging in gets their own requests, not the last user's", () async {
    final (container, repo) = await loaded();
    final auth = container.read(authControllerProvider.notifier);
    await auth.login('aditi.sharma@thapar.edu', 'anything');
    await container.read(borrowRequestsControllerProvider.future);
    final before = repo.fetches;

    await auth.logOut();
    await auth.register('Second Student', 'second@thapar.edu', 'password123');
    await container.read(borrowRequestsControllerProvider.future);
    expect(repo.fetches, greaterThan(before));
  });
}
```

Create `frontend/test/features/quiet_refresh_test.dart`:

```dart
// test/features/quiet_refresh_test.dart
//
// The 30-second re-check refetches quietly: a failure keeps what's on screen.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartlib_frontend/core/api_exception.dart';
import 'package:smartlib_frontend/features/bookings/booking_repository.dart';
import 'package:smartlib_frontend/features/bookings/bookings_controller.dart';
import 'package:smartlib_frontend/features/loans/loan_repository.dart';
import 'package:smartlib_frontend/features/loans/loans_controller.dart';
import 'package:smartlib_frontend/models/loan.dart';
import 'package:smartlib_frontend/models/resource_booking.dart';
import '../support/mock_overrides.dart';

class _FlakyLoans extends MockLoanRepository {
  bool offline = false;
  @override
  Future<List<Loan>> activeLoans() =>
      offline ? Future.error(const ApiException(0, ApiException.networkMessage)) : super.activeLoans();
}

class _FlakyBookings extends MockBookingRepository {
  bool offline = false;
  @override
  Future<List<ResourceBooking>> myBookings() =>
      offline ? Future.error(const ApiException(0, ApiException.networkMessage)) : super.myBookings();
}

void main() {
  test('loans: refreshQuietly keeps the list when the network fails', () async {
    final repo = _FlakyLoans();
    final container = ProviderContainer(overrides: mockRepositoryOverrides(loans: repo));
    addTearDown(container.dispose);
    final before = await container.read(loansControllerProvider.future);

    repo.offline = true;
    await container.read(loansControllerProvider.notifier).refreshQuietly();

    final state = container.read(loansControllerProvider);
    expect(state.hasError, false);
    expect(state.value!.map((l) => l.id), before.map((l) => l.id));
  });

  test('bookings: refreshQuietly keeps the list when the network fails', () async {
    final repo = _FlakyBookings();
    final container = ProviderContainer(overrides: mockRepositoryOverrides(bookings: repo));
    addTearDown(container.dispose);
    final before = await container.read(bookingsControllerProvider.future);

    repo.offline = true;
    await container.read(bookingsControllerProvider.notifier).refreshQuietly();

    final state = container.read(bookingsControllerProvider);
    expect(state.hasError, false);
    expect(state.value!.map((b) => b.id), before.map((b) => b.id));
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `frontend/`): `flutter test test/features/borrow_requests test/features/quiet_refresh_test.dart`
Expected: FAIL to compile. The borrow request feature, `refreshQuietly` and the `borrowRequests:` override don't exist.

- [ ] **Step 3: Add the repository**

Create `frontend/lib/features/borrow_requests/borrow_request_repository.dart`:

```dart
// lib/features/borrow_requests/borrow_request_repository.dart
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../models/borrow_request.dart';
import '../catalog/book_repository.dart';

/// The student's borrow requests -- the backend's /borrow-requests. Borrowing
/// is a request a librarian approves; the loan appears once they do.
abstract class BorrowRequestRepository {
  /// Pending requests, and those declined or expired in the last 7 days, newest first.
  Future<List<BorrowRequest>> mine();

  /// Asks to borrow [bookId]. The server holds a copy while the request waits.
  Future<BorrowRequest> create(String bookId);

  /// Withdraws a pending request; its copy goes back to the shelf.
  Future<void> cancel(String requestId);
}

class HttpBorrowRequestRepository implements BorrowRequestRepository {
  HttpBorrowRequestRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<BorrowRequest>> mine() async {
    final res = await guardApi(() => _dio.get<List<dynamic>>('/borrow-requests/me'));
    return res.data!.map((j) => BorrowRequest.fromJson(j as Map<String, dynamic>)).toList();
  }

  @override
  Future<BorrowRequest> create(String bookId) async {
    final res = await guardApi(() => _dio.post<Map<String, dynamic>>('/borrow-requests', data: {'bookId': bookId}));
    return BorrowRequest.fromJson(res.data!);
  }

  @override
  Future<void> cancel(String requestId) async {
    await guardApi(() => _dio.post<Object?>('/borrow-requests/${Uri.encodeComponent(requestId)}/cancel'));
  }
}

/// Test double. Mirrors the server's refusals and keeps requests in memory,
/// newest first.
class MockBorrowRequestRepository implements BorrowRequestRepository {
  MockBorrowRequestRepository(this._books, {List<BorrowRequest> requests = const []}) : _mine = List.of(requests);

  final BookRepository _books;
  final List<BorrowRequest> _mine;
  int _nextId = 1;

  @override
  Future<List<BorrowRequest>> mine() async => List.of(_mine);

  @override
  Future<BorrowRequest> create(String bookId) async {
    if (_mine.any((r) => r.bookId == bookId && r.status == BorrowRequestStatus.pending)) {
      throw const ConflictException("You've already requested this book.");
    }
    final now = DateTime.now();
    final r = BorrowRequest(
      id: 'br-${_nextId++}',
      bookId: bookId,
      bookTitle: (await _books.getById(bookId))?.title ?? '',
      status: BorrowRequestStatus.pending,
      requestedAt: now,
      expiresAt: now.add(const Duration(hours: 24)),
    );
    _mine.insert(0, r);
    return r;
  }

  @override
  Future<void> cancel(String requestId) async {
    final i = _mine.indexWhere((r) => r.id == requestId && r.status == BorrowRequestStatus.pending);
    if (i == -1) throw const ConflictException('This request is no longer pending.');
    _mine.removeAt(i);
  }

  /// Plays a librarian's decision on the pending request for [bookId], as the
  /// server then reports it: an approved request drops off the list.
  void decide(String bookId, BorrowRequestStatus status, {String? reason}) {
    final i = _mine.indexWhere((r) => r.bookId == bookId && r.status == BorrowRequestStatus.pending);
    final r = _mine.removeAt(i);
    if (status == BorrowRequestStatus.approved) return;
    _mine.insert(
      i,
      BorrowRequest(
        id: r.id,
        bookId: r.bookId,
        bookTitle: r.bookTitle,
        status: status,
        requestedAt: r.requestedAt,
        expiresAt: r.expiresAt,
        decidedAt: DateTime.now(),
        declineReason: reason,
      ),
    );
  }
}

final borrowRequestRepositoryProvider =
    Provider<BorrowRequestRepository>((ref) => HttpBorrowRequestRepository(ref.watch(apiClientProvider)));
```

- [ ] **Step 4: Add the controller**

Create `frontend/lib/features/borrow_requests/borrow_requests_controller.dart`:

```dart
// lib/features/borrow_requests/borrow_requests_controller.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_exception.dart';
import '../../models/borrow_request.dart';
import '../auth/auth_controller.dart';
import 'borrow_request_repository.dart';

/// The logged-in student's borrow requests, shared by the book pages and My Loans.
class BorrowRequestsController extends AsyncNotifier<List<BorrowRequest>> {
  // Titles with a request in flight. A second tap would come back "already
  // requested" and read as a failure.
  final _requesting = <String>{};

  @override
  Future<List<BorrowRequest>> build() {
    // Keyed on who is logged in, like the loans: a different user gets a
    // fresh fetch, never the previous user's requests.
    ref.watch(authControllerProvider.select((s) => s.user?.id));
    return ref.read(borrowRequestRepositoryProvider).mine();
  }

  Future<void> request(String bookId) async {
    if (!_requesting.add(bookId)) return;
    try {
      final r = await ref.read(borrowRequestRepositoryProvider).create(bookId);
      state = AsyncValue.data([r, ...(state.value ?? [])]);
    } on ApiException catch (e) {
      _refetchIfStale(e);
      rethrow;
    } finally {
      _requesting.remove(bookId);
    }
  }

  Future<void> cancel(String requestId) async {
    try {
      await ref.read(borrowRequestRepositoryProvider).cancel(requestId);
    } on ApiException catch (e) {
      _refetchIfStale(e);
      rethrow;
    }
    state = AsyncValue.data((state.value ?? []).where((r) => r.id != requestId).toList());
  }

  /// The 30-second re-check: shows what the server says now, and keeps what
  /// it had if the request fails -- a network blip must not turn the screen
  /// into an error page. The next re-check tries again.
  Future<void> refreshQuietly() async {
    try {
      final fresh = await ref.read(borrowRequestRepositoryProvider).mine();
      state = AsyncValue.data(fresh);
    } on ApiException {
      // Keep what's shown.
    }
  }

  // The caller reports the failure; this keeps the list true to the server.
  void _refetchIfStale(ApiException e) {
    if (e.meansStaleState) ref.invalidateSelf();
  }
}

extension BorrowRequestLookup on List<BorrowRequest> {
  /// The newest request for [bookId] the student can still see, if any.
  BorrowRequest? latestFor(String bookId) {
    for (final r in this) {
      if (r.bookId == bookId) return r;
    }
    return null;
  }

  /// The newest request per title: an old answer is moot once the student asks again.
  List<BorrowRequest> latestPerBook() {
    final seen = <String>{};
    return [for (final r in this) if (seen.add(r.bookId)) r];
  }

  bool get anyPending => any((r) => r.status == BorrowRequestStatus.pending);
}

final borrowRequestsControllerProvider =
    AsyncNotifierProvider<BorrowRequestsController, List<BorrowRequest>>(BorrowRequestsController.new);
```

- [ ] **Step 5: Add quiet refreshes to the loans and bookings controllers**

In `frontend/lib/features/loans/loans_controller.dart`, add to `LoansController`:

```dart
  /// The 30-second re-check while a request waits (an approval adds a loan):
  /// shows what the server says now, and keeps the list if the request fails.
  Future<void> refreshQuietly() async {
    try {
      final fresh = await ref.read(loanRepositoryProvider).activeLoans();
      state = AsyncValue.data(fresh);
    } on ApiException {
      // Keep what's shown; the next re-check tries again.
    }
  }
```

In `frontend/lib/features/bookings/bookings_controller.dart`, add to `BookingsController`:

```dart
  /// The 30-second re-check while a room request waits: shows what the server
  /// says now, and keeps the list if the request fails.
  Future<void> refreshQuietly() async {
    try {
      final fresh = await ref.read(bookingRepositoryProvider).myBookings();
      state = AsyncValue.data(fresh);
    } on ApiException {
      // Keep what's shown; the next re-check tries again.
    }
  }
```

- [ ] **Step 6: Pin the new repository in tests**

In `frontend/test/support/mock_overrides.dart`:
- Add `import 'package:smartlib_frontend/features/borrow_requests/borrow_request_repository.dart';`.
- Change "all seven repositories" and "all seven repository providers" in the comments to "all eight".
- Add the parameter `BorrowRequestRepository? borrowRequests,` after `WaitlistRepository? waitlist,`.
- Add, after the waitlist override:

```dart
    // Wired to the same books override, so a request's title follows it.
    borrowRequestRepositoryProvider.overrideWith(
      (ref) => borrowRequests ?? MockBorrowRequestRepository(ref.watch(bookRepositoryProvider)),
    ),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `flutter test test/features/borrow_requests test/features/quiet_refresh_test.dart`
Expected: PASS.
Run: `flutter analyze && flutter test`
Expected: no issues; all pass.

- [ ] **Step 8: Hand off the commit**

```bash
git add lib/features/borrow_requests lib/features/loans/loans_controller.dart lib/features/bookings/bookings_controller.dart test/support/mock_overrides.dart test/features/borrow_requests test/features/quiet_refresh_test.dart
git commit -m "frontend: add the borrow request repository and controller" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Requesting books: the book page and My Loans

**Files:**
- Create: `frontend/lib/widgets/pending_refresh.dart`
- Modify: `frontend/lib/features/catalog/book_detail_screen.dart` (whole file)
- Modify: `frontend/lib/features/loans/loans_screen.dart` (whole file)
- Modify: `frontend/lib/features/loans/loan_repository.dart` (drop `createLoan`)
- Modify: `frontend/lib/features/loans/loans_controller.dart` (drop `prependLoan`)
- Test: `frontend/test/widgets/pending_refresh_test.dart` (new), `frontend/test/features/catalog/book_detail_screen_test.dart` (rewrite), `frontend/test/features/loans/loans_screen_test.dart`, `frontend/test/e2e_smoke_test.dart`

**Interfaces:**
- Consumes: `borrowRequestsControllerProvider`, `BorrowRequestLookup`, `MockBorrowRequestRepository.decide`, `refreshQuietly` (Task 15); `BorrowRequest`, `BorrowRequestStatus`, `LoanStatus.unknown` (Task 14).
- Produces: `kPendingRecheckInterval = Duration(seconds: 30)`; `PendingRefresh({required bool active, required VoidCallback onTick, required Widget child, Duration interval})`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/widgets/pending_refresh_test.dart`:

```dart
// test/widgets/pending_refresh_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartlib_frontend/widgets/pending_refresh.dart';

void main() {
  Widget host({required bool active, required VoidCallback onTick}) =>
      PendingRefresh(active: active, onTick: onTick, child: const SizedBox());

  testWidgets('re-checks every 30 seconds while something is pending', (tester) async {
    var ticks = 0;
    await tester.pumpWidget(host(active: true, onTick: () => ticks++));
    await tester.pump(const Duration(seconds: 29));
    expect(ticks, 0);
    await tester.pump(const Duration(seconds: 1));
    expect(ticks, 1);
    await tester.pump(const Duration(seconds: 30));
    expect(ticks, 2);
  });

  testWidgets('stops when nothing is pending, and starts again when something is', (tester) async {
    var ticks = 0;
    await tester.pumpWidget(host(active: true, onTick: () => ticks++));
    await tester.pumpWidget(host(active: false, onTick: () => ticks++));
    await tester.pump(const Duration(minutes: 2));
    expect(ticks, 0);
    await tester.pumpWidget(host(active: true, onTick: () => ticks++));
    await tester.pump(const Duration(seconds: 30));
    expect(ticks, 1);
  });

  testWidgets('stops when the screen goes away', (tester) async {
    var ticks = 0;
    await tester.pumpWidget(host(active: true, onTick: () => ticks++));
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(minutes: 2));
    expect(ticks, 0);
  });
}
```

Replace `frontend/test/features/catalog/book_detail_screen_test.dart` with:

```dart
// test/features/catalog/book_detail_screen_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartlib_frontend/core/api_exception.dart';
import 'package:smartlib_frontend/core/theme/smartlib_theme.dart';
import 'package:smartlib_frontend/core/ui/toast_overlay.dart';
import 'package:smartlib_frontend/features/borrow_requests/borrow_request_repository.dart';
import 'package:smartlib_frontend/features/catalog/book_detail_screen.dart';
import 'package:smartlib_frontend/features/catalog/book_repository.dart';
import 'package:smartlib_frontend/features/loans/loan_repository.dart';
import 'package:smartlib_frontend/features/waitlist/waitlist_repository.dart';
import 'package:smartlib_frontend/models/book.dart';
import 'package:smartlib_frontend/models/borrow_request.dart';
import 'package:smartlib_frontend/models/loan.dart';
import 'package:smartlib_frontend/models/reservation.dart';
import '../../support/mock_overrides.dart';

/// The demo student's loans without b1, so b1 can be requested.
class _CleanLoanRepository implements LoanRepository {
  _CleanLoanRepository() {
    final now = DateTime.now();
    _loans = [
      Loan(id: 'loan2', bookId: 'b3', dueDate: now.add(const Duration(days: 2)), status: LoanStatus.normal, fineAmount: 0, canRenew: true),
      Loan(id: 'loan3', bookId: 'b4', dueDate: now.subtract(const Duration(days: 3)), status: LoanStatus.overdue, fineAmount: 30, canRenew: true),
      Loan(id: 'loan4', bookId: 'b8', dueDate: now.add(const Duration(days: 5)), status: LoanStatus.normal, fineAmount: 0, canRenew: false, blockedReason: '1 student is waiting for this title.'),
    ];
  }

  late List<Loan> _loans;

  @override
  Future<List<Loan>> activeLoans() async => List.of(_loans);

  @override
  Future<Loan> renew(String loanId) async => _loans.firstWhere((l) => l.id == loanId);

  @override
  Future<void> returnLoan(String loanId) async => _loans.removeWhere((l) => l.id == loanId);

  /// Stands in for a librarian approving: the request becomes this loan.
  void approve(String bookId) => _loans.insert(
        0,
        Loan(id: 'loan-$bookId', bookId: bookId, dueDate: DateTime.now().add(const Duration(days: 14)), status: LoanStatus.normal, fineAmount: 0, canRenew: true),
      );
}

/// The mock, recording what was requested and refusing on demand.
class _Requests extends MockBorrowRequestRepository {
  _Requests({super.requests}) : super(MockBookRepository());

  final createdFor = <String>[];
  Object? refuseWith;

  @override
  Future<BorrowRequest> create(String bookId) async {
    createdFor.add(bookId);
    if (refuseWith != null) throw refuseWith!;
    return super.create(bookId);
  }
}

BorrowRequest _answered(BorrowRequestStatus status, {String? reason}) {
  final requestedAt = DateTime.now().subtract(const Duration(hours: 3));
  return BorrowRequest(
    id: 'br-old', bookId: 'b1', bookTitle: 'Introduction to Algorithms', status: status,
    requestedAt: requestedAt, expiresAt: requestedAt.add(const Duration(hours: 24)),
    decidedAt: requestedAt.add(const Duration(hours: 1)), declineReason: reason,
  );
}

/// b9 with its one shelf copy held for a student on the waitlist.
class _HeldCopyBookRepository extends MockBookRepository {
  @override
  Future<Book?> getById(String id) async => const Book(
      id: 'b9', title: 'The Midnight Library', author: 'Matt Haig', genre: 'Fiction', description: 'd',
      totalCopies: 2, availableCopies: 1, heldCopies: 1, waitlistCount: 0);
}

void main() {
  testWidgets('an available book offers Request to borrow and its copy count', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(loans: _CleanLoanRepository()),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    expect(find.text('1 of 4 copies available'), findsOneWidget);
    expect(find.text('Request to borrow'), findsOneWidget);
  });

  testWidgets('requesting shows the pending state with its deadline, after exactly one request', (tester) async {
    final requests = _Requests();
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(loans: _CleanLoanRepository(), borrowRequests: requests),
      child: MaterialApp(theme: buildSmartLibTheme(), builder: withToasts, home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request to borrow'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Requested — waiting for a librarian. Expires tomorrow, '), findsOneWidget);
    expect(find.text('Cancel request'), findsOneWidget);
    expect(find.text('Request sent. A librarian will review it soon.'), findsOneWidget);
    expect(requests.createdFor, ['b1']);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('a refused request says why, and does not claim it was sent', (tester) async {
    final requests = _Requests()..refuseWith = const ConflictException('No available copies right now.');
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(loans: _CleanLoanRepository(), borrowRequests: requests),
      child: MaterialApp(theme: buildSmartLibTheme(), builder: withToasts, home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request to borrow'));
    await tester.pump();
    await tester.pump();

    expect(find.text('No available copies right now.'), findsOneWidget);
    expect(find.textContaining('Requested —'), findsNothing);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('Cancel request withdraws it', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(loans: _CleanLoanRepository()),
      child: MaterialApp(theme: buildSmartLibTheme(), builder: withToasts, home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request to borrow'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 3));
    await tester.tap(find.text('Cancel request'));
    await tester.pumpAndSettle();

    expect(find.text('Request cancelled.'), findsOneWidget);
    expect(find.text('Request to borrow'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('a declined request says why, and offers Request again', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(
        loans: _CleanLoanRepository(),
        borrowRequests: _Requests(requests: [_answered(BorrowRequestStatus.declined, reason: 'Reserved for a course')]),
      ),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Your request was declined: Reserved for a course'), findsOneWidget);
    expect(find.text('Request again'), findsOneWidget);
  });

  testWidgets('a decline without a reason says the library declined it', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(
        loans: _CleanLoanRepository(),
        borrowRequests: _Requests(requests: [_answered(BorrowRequestStatus.declined)]),
      ),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Your request was declined by the library.'), findsOneWidget);
  });

  testWidgets('an expired request says so, and offers Request again', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(
        loans: _CleanLoanRepository(),
        borrowRequests: _Requests(requests: [_answered(BorrowRequestStatus.expired)]),
      ),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Your request expired before a librarian approved it.'), findsOneWidget);
    expect(find.text('Request again'), findsOneWidget);
  });

  testWidgets('while a request waits, the page re-checks every 30 seconds and shows the loan once approved', (tester) async {
    final loans = _CleanLoanRepository();
    final requests = _Requests();
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(loans: loans, borrowRequests: requests),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b1')),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request to borrow'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Requested —'), findsOneWidget);

    loans.approve('b1');
    requests.decide('b1', BorrowRequestStatus.approved);
    await tester.pump(const Duration(seconds: 30));
    await tester.pumpAndSettle();

    expect(find.text('Borrowed — see My Loans for the due date'), findsOneWidget);
  });

  testWidgets('an unavailable book shows the waitlist copy and Join Waitlist button', (tester) async {
    await tester.pumpWidget(ProviderScope(overrides: mockRepositoryOverrides(), child: MaterialApp(
      theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b2'),
    )));
    await tester.pumpAndSettle();
    expect(find.text('2 people ahead of you on the waitlist.'), findsOneWidget);
    expect(find.text('Join Waitlist'), findsOneWidget);
  });

  group('the waitlist', () {
    testWidgets('after joining, the screen shows your place in line -- and still does when you come back', (tester) async {
      // It used to forget as soon as you left the screen, and offer Join again.
      final container = ProviderContainer(overrides: mockRepositoryOverrides(loans: _CleanLoanRepository()));
      addTearDown(container.dispose);
      Widget app(Widget home) => UncontrolledProviderScope(
          container: container, child: MaterialApp(theme: buildSmartLibTheme(), home: home));

      await tester.pumpWidget(app(const BookDetailScreen(bookId: 'b2')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Join Waitlist'));
      await tester.pumpAndSettle();
      // b2 already has two students queued.
      expect(find.text("You're #3 in line."), findsOneWidget);

      await tester.pumpWidget(app(const SizedBox()));
      await tester.pumpWidget(app(const BookDetailScreen(bookId: 'b2')));
      await tester.pumpAndSettle();
      expect(find.text("You're #3 in line."), findsOneWidget);
      expect(find.text('Join Waitlist'), findsNothing);
    });

    testWidgets('Leave waitlist takes you out of the queue', (tester) async {
      final waitlist = MockWaitlistRepository(MockBookRepository(), reservations: const [
        Reservation(id: 'res-b2', bookId: 'b2', status: ReservationStatus.waiting, queuePosition: 3),
      ]);
      await tester.pumpWidget(ProviderScope(
        overrides: mockRepositoryOverrides(loans: _CleanLoanRepository(), waitlist: waitlist),
        child: MaterialApp(theme: buildSmartLibTheme(), builder: withToasts, home: const BookDetailScreen(bookId: 'b2')),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Leave waitlist'));
      await tester.pumpAndSettle();

      expect(find.text("You've left the waitlist."), findsOneWidget);
      expect(find.text('Join Waitlist'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('a copy held for you says until when, and Request to borrow asks for it', (tester) async {
      // Nobody else can take it, so it's the one case where the request button
      // shows even though the shelf copy is held.
      final waitlist = MockWaitlistRepository(MockBookRepository(), reservations: [
        Reservation(id: 'res-b9', bookId: 'b9', status: ReservationStatus.held, claimExpiresAt: DateTime.now().add(const Duration(hours: 30))),
      ]);
      await tester.pumpWidget(ProviderScope(
        overrides: mockRepositoryOverrides(loans: _CleanLoanRepository(), books: _HeldCopyBookRepository(), waitlist: waitlist),
        child: MaterialApp(theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b9')),
      ));
      await tester.pumpAndSettle();
      expect(find.textContaining('A copy is held for you until'), findsOneWidget);
      expect(find.text('Join Waitlist'), findsNothing);

      await tester.tap(find.text('Request to borrow'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Requested — waiting for a librarian'), findsOneWidget);
    });

    testWidgets("copies held for other students aren't offered -- it's Join Waitlist instead", (tester) async {
      // The server refuses anyone but the claimant, so a request button here
      // could only ever fail.
      await tester.pumpWidget(ProviderScope(
        overrides: mockRepositoryOverrides(loans: _CleanLoanRepository(), books: _HeldCopyBookRepository()),
        child: MaterialApp(theme: buildSmartLibTheme(), home: const BookDetailScreen(bookId: 'b9')),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Request to borrow'), findsNothing);
      expect(find.text('Every copy on the shelf is held for a student on the waitlist.'), findsOneWidget);
      expect(find.text('Join Waitlist'), findsOneWidget);
    });
  });
}
```

In `frontend/test/features/loans/loans_screen_test.dart`, add these imports:

```dart
import 'package:smartlib_frontend/features/borrow_requests/borrow_request_repository.dart';
import 'package:smartlib_frontend/models/borrow_request.dart';
```

and, above `void main()`:

```dart
BorrowRequest _request(String id, String bookId, String title, BorrowRequestStatus status, {Duration age = Duration.zero, String? reason}) {
  final requestedAt = DateTime.now().subtract(age);
  return BorrowRequest(
    id: id, bookId: bookId, bookTitle: title, status: status, requestedAt: requestedAt,
    expiresAt: requestedAt.add(const Duration(hours: 24)),
    decidedAt: status == BorrowRequestStatus.pending ? null : requestedAt.add(const Duration(hours: 1)),
    declineReason: reason,
  );
}

/// The mock, with the network failing on demand.
class _FlakyRequests extends MockBorrowRequestRepository {
  _FlakyRequests({super.requests}) : super(MockBookRepository());
  bool offline = false;
  @override
  Future<List<BorrowRequest>> mine() =>
      offline ? Future.error(const ApiException(0, ApiException.networkMessage)) : super.mine();
}

class _NoLoans extends MockLoanRepository {
  @override
  Future<List<Loan>> activeLoans() async => [];
}

class _UnknownLoan extends MockLoanRepository {
  @override
  Future<List<Loan>> activeLoans() async => [
        Loan(id: 'loan9', bookId: 'b1', dueDate: DateTime.now(), status: LoanStatus.unknown, fineAmount: 0, canRenew: false),
      ];
}
```

and append inside `main`:

```dart
  testWidgets('shows requests above the waitlist and loans, the newest per title', (tester) async {
    final requests = _FlakyRequests(requests: [
      _request('br-3', 'b12', 'Atomic Habits', BorrowRequestStatus.pending),
      _request('br-2', 'b12', 'Atomic Habits', BorrowRequestStatus.declined, age: const Duration(hours: 5)),
      _request('br-1', 'b5', 'Data Structures and Algorithms in Java', BorrowRequestStatus.declined, reason: 'Reserved for a course'),
      _request('br-0', 'b11', 'Sapiens', BorrowRequestStatus.expired),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(borrowRequests: requests),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const LoansScreen()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Requests'), findsOneWidget);
    expect(find.textContaining('Waiting for a librarian · expires '), findsOneWidget);
    expect(find.text('Cancel request'), findsOneWidget);
    expect(find.text('Declined — Reserved for a course'), findsOneWidget);
    expect(find.text('Expired — no librarian approved it in time'), findsOneWidget);
    // The older answer for b12 is hidden by the newer request.
    expect(find.text('Declined by the library'), findsNothing);
  });

  testWidgets('Cancel request withdraws it', (tester) async {
    final requests = _FlakyRequests(requests: [_request('br-3', 'b12', 'Atomic Habits', BorrowRequestStatus.pending)]);
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(borrowRequests: requests),
      child: MaterialApp(theme: buildSmartLibTheme(), builder: withToasts, home: const LoansScreen()),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel request'));
    await tester.pumpAndSettle();

    expect(find.text('Request cancelled.'), findsOneWidget);
    expect(find.text('Requests'), findsNothing);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('a network blip during the re-check keeps the list on screen', (tester) async {
    final requests = _FlakyRequests(requests: [_request('br-3', 'b12', 'Atomic Habits', BorrowRequestStatus.pending)]);
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(borrowRequests: requests),
      child: MaterialApp(theme: buildSmartLibTheme(), builder: withToasts, home: const LoansScreen()),
    ));
    await tester.pumpAndSettle();

    requests.offline = true;
    await tester.pump(const Duration(seconds: 30));
    await tester.pumpAndSettle();

    expect(find.textContaining('Waiting for a librarian'), findsOneWidget);
    expect(find.text("Couldn't load your loans"), findsNothing);
    expect(find.text(ApiException.networkMessage), findsNothing);
  });

  testWidgets('the empty state waits until there are no loans, waitlist or requests', (tester) async {
    final requests = _FlakyRequests(requests: [_request('br-3', 'b12', 'Atomic Habits', BorrowRequestStatus.pending)]);
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(loans: _NoLoans(), borrowRequests: requests),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const LoansScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Requests'), findsOneWidget);
    expect(find.text('No active loans.'), findsOneWidget);
    expect(find.text('Browse the catalog'), findsNothing);
  });

  testWidgets("a loan with a status this version doesn't know says to update the app", (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(loans: _UnknownLoan()),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const LoansScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.text("Update the app to see this item's status."), findsOneWidget);
    expect(find.text('Renew'), findsNothing);
  });
```

In `frontend/test/e2e_smoke_test.dart`, rename the test to `'login, request a book, recover from a booking conflict, see the booking land'` and replace the borrow part (from the comment `// Home -> Search -> ...` through the Loans check) with:

```dart
    // Home -> Search -> open a book that's currently available -> request it.
    await tester.tap(find.text('Search').first);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Atomic Habits');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Atomic Habits'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request to borrow'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Requested — waiting for a librarian'), findsOneWidget);

    // Loans lists it under Requests.
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Loans').first);
    await tester.pumpAndSettle();
    expect(find.text('Atomic Habits'), findsOneWidget);
    expect(find.textContaining('Waiting for a librarian'), findsOneWidget);
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `frontend/`): `flutter test test/widgets/pending_refresh_test.dart test/features/catalog/book_detail_screen_test.dart test/features/loans/loans_screen_test.dart test/e2e_smoke_test.dart`
Expected: FAIL. `pending_refresh.dart` doesn't exist, and the screens still say *Borrow this copy* and have no Requests section.

- [ ] **Step 3: Add the re-check widget**

Create `frontend/lib/widgets/pending_refresh.dart`:

```dart
// lib/widgets/pending_refresh.dart
import 'dart:async';
import 'package:flutter/widgets.dart';

/// How often a screen with a request waiting for a librarian re-checks it.
const kPendingRecheckInterval = Duration(seconds: 30);

/// While [active], calls [onTick] every [interval], so a librarian's answer
/// shows up without a manual refresh. Stops as soon as [active] turns false or
/// the screen goes away.
class PendingRefresh extends StatefulWidget {
  const PendingRefresh({
    super.key,
    required this.active,
    required this.onTick,
    required this.child,
    this.interval = kPendingRecheckInterval,
  });

  final bool active;
  final VoidCallback onTick;
  final Widget child;
  final Duration interval;

  @override
  State<PendingRefresh> createState() => _PendingRefreshState();
}

class _PendingRefreshState extends State<PendingRefresh> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(PendingRefresh oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    if (widget.active && _timer == null) {
      // Reads widget.onTick on every tick, so a rebuilt callback is used.
      _timer = Timer.periodic(widget.interval, (_) => widget.onTick());
    } else if (!widget.active) {
      _timer?.cancel();
      _timer = null;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
```

- [ ] **Step 4: Rewrite the book page around requests**

Replace `frontend/lib/features/catalog/book_detail_screen.dart` with:

```dart
// lib/features/catalog/book_detail_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/clock.dart';
import '../../core/time_format.dart';
import '../../core/ui/ui_controller.dart';
import '../../models/borrow_request.dart';
import '../../models/reservation.dart';
import '../../widgets/book_cover.dart';
import '../../widgets/error_state.dart';
import '../../widgets/loading_skeleton.dart';
import '../../widgets/pending_refresh.dart';
import '../borrow_requests/borrow_requests_controller.dart';
import '../loans/loans_controller.dart';
import '../waitlist/waitlist_controller.dart';
import 'catalog_providers.dart';

class BookDetailScreen extends ConsumerStatefulWidget {
  const BookDetailScreen({super.key, required this.bookId});
  final String bookId;
  @override
  ConsumerState<BookDetailScreen> createState() => _BookDetailScreenState();
}

class _BookDetailScreenState extends ConsumerState<BookDetailScreen> {
  Future<void> _request() async {
    final error = await ref.read(uiControllerProvider.notifier).attempt(
          () => ref.read(borrowRequestsControllerProvider.notifier).request(widget.bookId),
          success: 'Request sent. A librarian will review it soon.',
        );
    if (!mounted) return;
    // A request holds a copy, and a copy held for you from the waitlist turns
    // into the request. Not worth a refetch when the server couldn't be reached.
    if (error == null || error.meansStaleState) {
      _refreshAvailability();
      ref.invalidate(waitlistControllerProvider);
    }
  }

  Future<void> _cancelRequest(BorrowRequest r) async {
    final error = await ref.read(uiControllerProvider.notifier).attempt(
          () => ref.read(borrowRequestsControllerProvider.notifier).cancel(r.id),
          success: 'Request cancelled.',
        );
    if (!mounted) return;
    if (error == null || error.meansStaleState) _refreshAvailability();
  }

  // The 30-second re-check while a request waits. An approval turns it into a
  // loan, so both lists are refetched -- quietly, keeping what's shown if the
  // network blips.
  void _recheck() {
    ref.read(borrowRequestsControllerProvider.notifier).refreshQuietly();
    ref.read(loansControllerProvider.notifier).refreshQuietly();
  }

  Future<void> _joinWaitlist() async {
    final error = await ref.read(uiControllerProvider.notifier).attempt(
          () => ref.read(waitlistControllerProvider.notifier).join(widget.bookId),
        );
    if (!mounted) return;
    // The queue length changed -- or was stale. Not worth a refetch when the
    // server couldn't be reached.
    if (error == null || error.meansStaleState) _refreshAvailability();
  }

  Future<void> _leaveWaitlist(Reservation r) async {
    final error = await ref.read(uiControllerProvider.notifier).attempt(
          () => ref.read(waitlistControllerProvider.notifier).leave(r.id),
          success: r.status == ReservationStatus.held
              ? 'Released. It goes to the next student in line.'
              : "You've left the waitlist.",
        );
    if (!mounted) return;
    if (error == null || error.meansStaleState) _refreshAvailability();
  }

  String _heldLine(Reservation r) {
    final until = r.claimExpiresAt;
    if (until == null) return 'A copy is held for you.';
    return 'A copy is held for you until ${dayTimeLabel(until, now: ref.read(clockProvider)())}.';
  }

  String _outcomeLine(BorrowRequest r) => switch (r.status) {
        BorrowRequestStatus.declined => r.declineReason == null
            ? 'Your request was declined by the library.'
            : 'Your request was declined: ${r.declineReason}',
        BorrowRequestStatus.expired => 'Your request expired before a librarian approved it.',
        _ => '',
      };

  // Availability lives on the server now: refetch this book, and the search
  // list still mounted underneath, so neither shows a stale count.
  void _refreshAvailability() {
    ref.invalidate(bookByIdProvider(widget.bookId));
    ref.invalidate(searchResultsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final bookAsync = ref.watch(bookByIdProvider(widget.bookId));
    final loans = ref.watch(loansControllerProvider).value ?? [];
    final alreadyBorrowed = loans.any((l) => l.bookId == widget.bookId);
    final waitlist = ref.watch(waitlistControllerProvider);
    final mine = waitlist.value?.forBook(widget.bookId);
    final latest = ref.watch(borrowRequestsControllerProvider).value?.latestFor(widget.bookId);
    final pending = latest?.status == BorrowRequestStatus.pending ? latest : null;
    final outcome = latest != null &&
            (latest.status == BorrowRequestStatus.declined || latest.status == BorrowRequestStatus.expired)
        ? latest
        : null;
    final requestLabel = outcome == null ? 'Request to borrow' : 'Request again';

    return PendingRefresh(
      active: pending != null,
      onTick: _recheck,
      child: Scaffold(
        appBar: AppBar(),
        body: bookAsync.when(
          loading: () => const Padding(padding: EdgeInsets.all(20), child: LoadingSkeleton(height: 210, borderRadius: 16)),
          error: (e, st) => ErrorState(title: "Couldn't load this book", onRetry: () => ref.invalidate(bookByIdProvider(widget.bookId))),
          data: (book) {
            if (book == null) return const Center(child: Text('Select a book to view its details.'));
            final copiesLine = Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.check_circle, size: 15),
              const SizedBox(width: 6),
              Text('${book.freeCopies} of ${book.totalCopies} copies available'),
            ]);
            return SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              child: Column(children: [
                BookCover(book: book, width: 148, height: 208),
                const SizedBox(height: 14),
                Text(book.title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
                Text(book.author, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Chip(label: Text(book.genre)),
                const SizedBox(height: 12),
                Text(book.description),
                const SizedBox(height: 16),
                if (alreadyBorrowed) ...[
                  copiesLine,
                  const SizedBox(height: 10),
                  TextButton(
                      onPressed: () => context.go('/loans'),
                      child: const Text('Borrowed — see My Loans for the due date')),
                ] else if (pending != null) ...[
                  Text(
                    'Requested — waiting for a librarian. Expires ${dayTimeLabel(pending.expiresAt, now: ref.read(clockProvider)())}.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 10),
                  TextButton(onPressed: () => _cancelRequest(pending), child: const Text('Cancel request')),
                ] else ...[
                  if (outcome != null) ...[
                    Text(_outcomeLine(outcome), textAlign: TextAlign.center),
                    const SizedBox(height: 10),
                  ],
                  if (mine?.status == ReservationStatus.held) ...[
                    // Held copies are refused to everyone else, so this is the
                    // one case where the request button shows although the
                    // shelf copy is held.
                    Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.bookmark_added, size: 15),
                      const SizedBox(width: 6),
                      Flexible(child: Text(_heldLine(mine!))),
                    ]),
                    const SizedBox(height: 10),
                    FilledButton(onPressed: _request, child: Text(requestLabel)),
                    TextButton(onPressed: () => _leaveWaitlist(mine), child: const Text('Release it to the next student')),
                  ] else if (mine != null) ...[
                    const Text('Currently unavailable'),
                    Text(mine.queuePosition != null ? "You're #${mine.queuePosition} in line." : "You're on the waitlist."),
                    const SizedBox(height: 10),
                    TextButton(onPressed: () => _leaveWaitlist(mine), child: const Text('Leave waitlist')),
                  ] else if (book.freeCopies > 0) ...[
                    copiesLine,
                    const SizedBox(height: 10),
                    FilledButton(onPressed: _request, child: Text(requestLabel)),
                  ] else ...[
                    Text(book.availableCopies > 0
                        ? 'Every copy on the shelf is held for a student on the waitlist.'
                        : 'Currently unavailable'),
                    Text(book.waitlistCount > 0
                        ? '${book.waitlistCount} ${book.waitlistCount == 1 ? 'person' : 'people'} ahead of you on the waitlist.'
                        : "You'll be first in line."),
                    const SizedBox(height: 10),
                    // Disabled until the waitlist has loaded: until then the screen
                    // can't know whether you're already on it.
                    OutlinedButton(onPressed: waitlist.isLoading ? null : _joinWaitlist, child: const Text('Join Waitlist')),
                  ],
                ],
              ]),
            );
          },
        ),
      ),
    );
  }
}
```

- [ ] **Step 5: Add Requests to My Loans**

Replace `frontend/lib/features/loans/loans_screen.dart` with:

```dart
// lib/features/loans/loans_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/clock.dart';
import '../../core/time_format.dart';
import '../../core/ui/ui_controller.dart';
import '../../models/borrow_request.dart';
import '../../models/loan.dart';
import '../../models/reservation.dart';
import '../../widgets/book_cover.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/error_state.dart';
import '../../widgets/loading_skeleton.dart';
import '../../widgets/pending_refresh.dart';
import '../borrow_requests/borrow_requests_controller.dart';
import '../catalog/catalog_providers.dart';
import '../waitlist/waitlist_controller.dart';
import 'loans_controller.dart';

const _updateTheApp = "Update the app to see this item's status.";

class LoansScreen extends ConsumerStatefulWidget {
  const LoansScreen({super.key});
  @override
  ConsumerState<LoansScreen> createState() => _LoansScreenState();
}

class _LoansScreenState extends ConsumerState<LoansScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(uiControllerProvider.notifier).onConfirmReturnLoan =
          (id) => ref.read(loansControllerProvider.notifier).returnLoan(id);
    });
  }

  String _dueLabel(DateTime d) => '${d.month}/${d.day}';

  // The 30-second re-check while a request waits: an approval turns it into
  // a loan, so both lists are refetched, quietly.
  void _recheck() {
    ref.read(borrowRequestsControllerProvider.notifier).refreshQuietly();
    ref.read(loansControllerProvider.notifier).refreshQuietly();
  }

  Future<void> _cancelRequest(BorrowRequest r) => ref
      .read(uiControllerProvider.notifier)
      .attempt(() => ref.read(borrowRequestsControllerProvider.notifier).cancel(r.id), success: 'Request cancelled.');

  @override
  Widget build(BuildContext context) {
    final loans = ref.watch(loansControllerProvider);
    // Held copies first: they pass to the next student when the hold runs out.
    final waitlist = [...?ref.watch(waitlistControllerProvider).value]
      ..sort((a, b) => a.status == b.status ? 0 : (a.status == ReservationStatus.held ? -1 : 1));
    final requests = (ref.watch(borrowRequestsControllerProvider).value ?? const <BorrowRequest>[]).latestPerBook();
    return PendingRefresh(
      active: requests.anyPending,
      onTick: _recheck,
      child: Scaffold(
        appBar: AppBar(title: const Text('My Loans')),
        body: loans.when(
          loading: () => ListView(padding: const EdgeInsets.all(20), children: const [
            LoadingSkeleton(height: 84), SizedBox(height: 10), LoadingSkeleton(height: 84),
          ]),
          error: (e, st) => ErrorState(title: "Couldn't load your loans", onRetry: () => ref.invalidate(loansControllerProvider)),
          data: (items) {
            if (items.isEmpty && waitlist.isEmpty && requests.isEmpty) {
              return EmptyState(
                icon: Icons.menu_book, title: 'No active loans',
                body: 'Search the catalog to borrow your first book.',
                actionLabel: 'Browse the catalog',
                onAction: () => context.go('/search'),
              );
            }
            final heading = Theme.of(context).textTheme.titleSmall;
            // Headings only when there's more than the loans to tell apart.
            final sectioned = requests.isNotEmpty || waitlist.isNotEmpty;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (requests.isNotEmpty) ...[
                  Text('Requests', style: heading),
                  const SizedBox(height: 6),
                  for (final r in requests) _requestCard(context, r),
                  const SizedBox(height: 14),
                ],
                if (waitlist.isNotEmpty) ...[
                  Text('Waitlist', style: heading),
                  const SizedBox(height: 6),
                  for (final r in waitlist) _waitlistCard(context, r),
                  const SizedBox(height: 14),
                ],
                if (sectioned) ...[
                  Text('On loan', style: heading),
                  const SizedBox(height: 6),
                  if (items.isEmpty) const Text('No active loans.'),
                ],
                for (final l in items) _loanCard(context, l),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _requestCard(BuildContext context, BorrowRequest r) {
    final book = ref.watch(bookByIdProvider(r.bookId)).value;
    final status = switch (r.status) {
      BorrowRequestStatus.pending =>
        'Waiting for a librarian · expires ${dayTimeLabel(r.expiresAt, now: ref.read(clockProvider)())}',
      BorrowRequestStatus.declined => r.declineReason == null ? 'Declined by the library' : 'Declined — ${r.declineReason}',
      BorrowRequestStatus.expired => 'Expired — no librarian approved it in time',
      _ => _updateTheApp,
    };
    return Card(child: ListTile(
      leading: book == null ? null : BookCover(book: book, width: 30, height: 42),
      title: Text(r.bookTitle),
      subtitle: Text(status),
      trailing: r.status == BorrowRequestStatus.pending
          ? TextButton(onPressed: () => _cancelRequest(r), child: const Text('Cancel request'))
          : null,
      onTap: () => context.push('/book/${r.bookId}'),
    ));
  }

  Widget _waitlistCard(BuildContext context, Reservation r) {
    final book = ref.watch(bookByIdProvider(r.bookId)).value;
    final until = r.claimExpiresAt;
    final status = switch (r.status) {
      ReservationStatus.held => until == null
          ? 'Held for you — borrow it soon'
          : 'Held for you until ${dayTimeLabel(until, now: ref.read(clockProvider)())} — borrow it before then',
      ReservationStatus.waiting => r.queuePosition == null ? 'On the waitlist' : '#${r.queuePosition} in line',
      ReservationStatus.unknown => _updateTheApp,
    };
    return Card(child: ListTile(
      leading: book == null ? null : BookCover(book: book, width: 30, height: 42),
      title: Text(book?.title ?? ''),
      subtitle: Text(status, style: r.status == ReservationStatus.held ? const TextStyle(fontWeight: FontWeight.w600) : null),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push('/book/${r.bookId}'),
    ));
  }

  Widget _loanCard(BuildContext context, Loan l) {
    final book = ref.watch(bookByIdProvider(l.bookId)).value;
    if (l.status == LoanStatus.unknown) {
      return Card(child: ListTile(title: Text(book?.title ?? ''), subtitle: const Text(_updateTheApp)));
    }
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (book != null) BookCover(book: book, width: 36, height: 50),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(book?.title ?? '', style: Theme.of(context).textTheme.titleSmall),
            Text(book?.author ?? ''),
            Text(
              l.status == LoanStatus.overdue ? 'Overdue — was due ${_dueLabel(l.dueDate)}' : 'Due ${_dueLabel(l.dueDate)}',
              style: TextStyle(color: l.status == LoanStatus.overdue ? Theme.of(context).colorScheme.error : null, fontWeight: FontWeight.w600),
            ),
            if (l.status == LoanStatus.overdue) Text('Fine: ₹${l.fineAmount} and counting'),
          ])),
        ]),
        if (l.justRenewed) Text('Renewed — now due ${_dueLabel(l.dueDate)}'),
        if (l.canRenew == false) Text('Renewal unavailable — ${l.blockedReason}'),
        Row(children: [
          Expanded(child: OutlinedButton(
            onPressed: l.canRenew
                ? () => ref.read(uiControllerProvider.notifier).attempt(() => ref.read(loansControllerProvider.notifier).renew(l.id))
                : null,
            child: const Text('Renew'),
          )),
          const SizedBox(width: 8),
          Expanded(child: TextButton(
            onPressed: () => ref.read(uiControllerProvider.notifier).askReturnLoan(l.id),
            child: const Text('Return'),
          )),
        ]),
      ]),
    ));
  }
}
```

- [ ] **Step 6: Remove instant borrowing from the loans layer**

In `frontend/lib/features/loans/loan_repository.dart`, delete `Future<Loan> createLoan(String bookId);` from `LoanRepository`, and the `createLoan` overrides from `HttpLoanRepository` and `MockLoanRepository`. In `frontend/lib/features/loans/loans_controller.dart`, delete `prependLoan`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `flutter test test/widgets/pending_refresh_test.dart test/features/catalog/book_detail_screen_test.dart test/features/loans/loans_screen_test.dart test/e2e_smoke_test.dart`
Expected: PASS.
Run: `flutter analyze && flutter test`
Expected: no issues; all pass.

- [ ] **Step 8: Hand off the commit**

```bash
git add lib/widgets/pending_refresh.dart lib/features/catalog/book_detail_screen.dart lib/features/loans test/widgets/pending_refresh_test.dart test/features/catalog/book_detail_screen_test.dart test/features/loans/loans_screen_test.dart test/e2e_smoke_test.dart
git commit -m "frontend: request books instead of borrowing them, with the answer on the book page and My Loans" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Room requests in booking and My Bookings

**Files:**
- Modify: `frontend/lib/features/bookings/booking_flow_screen.dart`
- Modify: `frontend/lib/features/bookings/bookings_screen.dart` (whole file)
- Modify: `frontend/lib/features/bookings/booking_repository.dart` (`MockBookingRepository.createBooking`)
- Test: `frontend/test/features/bookings/booking_flow_screen_test.dart`, `frontend/test/features/bookings/bookings_screen_test.dart`

**Interfaces:**
- Consumes: `BookingStatus.requested/declined/expired/unknown`, `ResourceBooking.expiresAt/declineReason` (Task 14); `BookingsController.refreshQuietly` (Task 15); `PendingRefresh` (Task 16).
- Produces: the room booking flow and My Bookings in their request states.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/test/features/bookings/booking_flow_screen_test.dart` (inside `main`):

```dart
  testWidgets('booking a room sends a request, and says how long the slot is held', (tester) async {
    await tester.pumpWidget(ProviderScope(overrides: mockRepositoryOverrides(), child: MaterialApp(
      theme: buildSmartLibTheme(), home: const BookingFlowScreen(),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Rooms'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('dateChip-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('9:00 AM').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('Confirm your request'), findsOneWidget);
    expect(
      find.text('A librarian approves room bookings. If none does before your 15-minute grace period ends, the request expires.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Send request'));
    await tester.pumpAndSettle();

    expect(find.text('Request sent'), findsOneWidget);
    expect(find.text("We'll hold the slot until tomorrow, 9:15 AM. Check My Bookings for the librarian's answer."), findsOneWidget);
    expect(find.text('View My Bookings'), findsOneWidget);
  });
```

In `frontend/test/features/bookings/bookings_screen_test.dart` (its existing imports already cover these), add above `void main()`:

```dart
/// Serves exactly these bookings, with the network failing on demand.
class _ListedBookings extends MockBookingRepository {
  _ListedBookings(this.bookings);
  List<ResourceBooking> bookings;
  bool offline = false;

  @override
  Future<List<ResourceBooking>> myBookings() async {
    if (offline) throw const ApiException(0, ApiException.networkMessage);
    return List.of(bookings);
  }
}

ResourceBooking _room(String id, BookingStatus status, {String? reason}) {
  final start = DateTime.now().add(const Duration(hours: 20));
  return ResourceBooking(
    id: id, resourceName: 'Group Room 201', type: ResourceType.room, startTime: start,
    endTime: start.add(const Duration(hours: 1)), status: status,
    expiresAt: status == BookingStatus.requested ? start.add(kCheckInGracePeriod) : null,
    declineReason: reason,
  );
}
```

and append inside `main`:

```dart
  testWidgets('shows room requests: waiting with its deadline and Cancel, declined, expired and unknown', (tester) async {
    final repo = _ListedBookings([
      _room('bk-1', BookingStatus.requested),
      _room('bk-2', BookingStatus.declined, reason: 'Reserved for an event'),
      _room('bk-3', BookingStatus.declined),
      _room('bk-4', BookingStatus.expired),
      _room('bk-5', BookingStatus.unknown),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(bookings: repo),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookingsScreen()),
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('Waiting for a librarian · held until '), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'Cancel'), findsOneWidget);
    expect(find.text('Declined — Reserved for an event'), findsOneWidget);
    expect(find.text('Declined by the library'), findsOneWidget);
    expect(find.text('Expired — no librarian approved it in time'), findsOneWidget);
    expect(find.text("Update the app to see this item's status."), findsOneWidget);
  });

  testWidgets('while a room request waits, the list re-checks every 30 seconds and shows the answer', (tester) async {
    final repo = _ListedBookings([_room('bk-1', BookingStatus.requested)]);
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(bookings: repo),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookingsScreen()),
    ));
    await tester.pumpAndSettle();

    repo.bookings = [_room('bk-1', BookingStatus.upcomingFar)];
    await tester.pump(const Duration(seconds: 30));
    await tester.pumpAndSettle();

    expect(find.textContaining('check-in opens at the start time'), findsOneWidget);
  });

  testWidgets('a network blip during the re-check keeps the list on screen', (tester) async {
    final repo = _ListedBookings([_room('bk-1', BookingStatus.requested)]);
    await tester.pumpWidget(ProviderScope(
      overrides: mockRepositoryOverrides(bookings: repo),
      child: MaterialApp(theme: buildSmartLibTheme(), home: const BookingsScreen()),
    ));
    await tester.pumpAndSettle();

    repo.offline = true;
    await tester.pump(const Duration(seconds: 30));
    await tester.pumpAndSettle();

    expect(find.textContaining('Waiting for a librarian'), findsOneWidget);
    expect(find.text("Couldn't load your bookings"), findsNothing);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `frontend/`): `flutter test test/features/bookings/booking_flow_screen_test.dart test/features/bookings/bookings_screen_test.dart`
Expected: FAIL. The room flow still says *Confirm booking* and *Booked*; My Bookings shows the released text for the new statuses and never re-checks.

- [ ] **Step 3: Make the mock book rooms as requests**

In `frontend/lib/features/bookings/booking_repository.dart`, replace the `booking` construction at the end of `MockBookingRepository.createBooking` with:

```dart
    // Rooms wait for a librarian, as on the server; seats are booked at once.
    final isRoom = resource.type == ResourceType.room;
    final booking = ResourceBooking(
      id: 'bk-${DateTime.now().microsecondsSinceEpoch}', resourceName: resource.name, type: resource.type,
      startTime: start, endTime: end,
      status: isRoom ? BookingStatus.requested : BookingStatus.upcomingFar,
      expiresAt: isRoom ? start.add(kCheckInGracePeriod) : null,
    );
```

- [ ] **Step 4: Say "request" in the room booking flow**

In `frontend/lib/features/bookings/booking_flow_screen.dart`:
- Replace `import '../../models/resource.dart';` with `import '../../models/resource_booking.dart';` (it exports `resource.dart`), and add `import '../../core/time_format.dart';`.
- In `_buildConfirm`, replace the `if (flow.result != null) { ... }` block with:

```dart
    final result = flow.result;
    if (result != null) {
      final requested = result.status == BookingStatus.requested;
      return Center(child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(requested ? Icons.schedule : Icons.check_circle, size: 56),
          const SizedBox(height: 10),
          Text(requested ? 'Request sent' : 'Booked', style: Theme.of(context).textTheme.titleLarge),
          Text('${flow.selectedResource?.name}, ${_dateLabel(flow.dateIndex)} · ${flow.selectedSlot}'),
          if (requested) ...[
            const SizedBox(height: 8),
            Text(
              "We'll hold the slot until ${dayTimeLabel(result.expiresAt ?? result.startTime.add(kCheckInGracePeriod), now: ref.read(clockProvider)())}. Check My Bookings for the librarian's answer.",
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 12),
          FilledButton(
              onPressed: () {
                notifier.reset();
                context.go('/bookings');
              },
              child: const Text('View My Bookings')),
        ]),
      ));
    }
```

- Replace the final `return Padding(...)` of `_buildConfirm` with:

```dart
    // Rooms wait for a librarian, so their confirm step asks rather than books.
    final room = flow.selectedResource?.type == ResourceType.room;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(room ? 'Confirm your request' : 'Confirm your booking', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        Card(child: Padding(
          padding: const EdgeInsets.all(12),
          child: Text('${flow.selectedResource?.name}\n${_dateLabel(flow.dateIndex)} · ${flow.selectedSlot}'),
        )),
        const SizedBox(height: 12),
        Text(room
            ? 'A librarian approves room bookings. If none does before your 15-minute grace period ends, the request expires.'
            : 'Check in within 15 minutes of your start time, or the slot is released automatically for someone else.'),
        const SizedBox(height: 16),
        // A conflict is handled in the flow itself; any other refusal (say, the
        // slot passed while the user sat here) is reported as a toast.
        FilledButton(
          onPressed: () => ref.read(uiControllerProvider.notifier).attempt(notifier.confirm),
          child: Text(room ? 'Send request' : 'Confirm booking'),
        ),
        TextButton(onPressed: notifier.backToPicker, child: const Text('Change slot')),
      ]),
    );
```

- [ ] **Step 5: Show request states in My Bookings**

Replace `frontend/lib/features/bookings/bookings_screen.dart` with:

```dart
// lib/features/bookings/bookings_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/clock.dart';
import '../../core/time_format.dart';
import '../../core/ui/ui_controller.dart';
import '../../models/resource_booking.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/error_state.dart';
import '../../widgets/loading_skeleton.dart';
import '../../widgets/pending_refresh.dart';
import 'bookings_controller.dart';

class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});
  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(uiControllerProvider.notifier).onConfirmCancelBooking =
          (id) => ref.read(bookingsControllerProvider.notifier).cancel(id);
    });
  }

  String _startsIn(DateTime start) {
    final d = start.difference(DateTime.now());
    if (d.inMinutes <= 0) return 'now';
    final h = d.inHours;
    final m = d.inMinutes % 60;
    return h > 0 ? 'in ${h}h ${m}m' : 'in ${m}m';
  }

  String _graceLabel(int seconds) {
    final mm = seconds ~/ 60;
    final ss = seconds % 60;
    return '$mm:${ss < 10 ? '0' : ''}$ss';
  }

  Widget _cancelButton(ResourceBooking b) => Expanded(child: TextButton(
        onPressed: () => ref.read(uiControllerProvider.notifier).askCancelBooking(b.id),
        child: const Text('Cancel'),
      ));

  List<Widget> _statusLines(ResourceBooking b) => switch (b.status) {
        BookingStatus.requested => [
            Text('Waiting for a librarian · held until '
                '${dayTimeLabel(b.expiresAt ?? b.startTime.add(kCheckInGracePeriod), now: ref.read(clockProvider)())}'),
            Row(children: [_cancelButton(b)]),
          ],
        BookingStatus.declined => [
            Text(b.declineReason == null ? 'Declined by the library' : 'Declined — ${b.declineReason}'),
          ],
        BookingStatus.expired => [const Text('Expired — no librarian approved it in time')],
        BookingStatus.upcomingFar => [
            // Matches the server: check-in opens AT the start time, for
            // kCheckInGracePeriod -- not before it.
            Text('Starts ${_startsIn(b.startTime)} · check-in opens at the start time'),
            Row(children: [
              const Expanded(child: OutlinedButton(onPressed: null, child: Text('Check In'))),
              const SizedBox(width: 8),
              _cancelButton(b),
            ]),
          ],
        BookingStatus.inWindow => [
            Text('Check in within ${_graceLabel(b.graceRemainingSeconds)}'),
            Row(children: [
              Expanded(child: FilledButton(
                onPressed: () => ref.read(uiControllerProvider.notifier).attempt(() => ref.read(bookingsControllerProvider.notifier).checkIn(b.id)),
                child: const Text('Check In'),
              )),
              const SizedBox(width: 8),
              _cancelButton(b),
            ]),
          ],
        BookingStatus.checkedIn => [const Text('Enjoy your session.')],
        BookingStatus.released => [const Text('This booking was released after the grace period.')],
        BookingStatus.unknown => [const Text("Update the app to see this item's status.")],
      };

  @override
  Widget build(BuildContext context) {
    final bookings = ref.watch(bookingsControllerProvider);
    final waiting = bookings.value?.any((b) => b.status == BookingStatus.requested) ?? false;
    return PendingRefresh(
      active: waiting,
      // A librarian's answer shows up within half a minute.
      onTick: () => ref.read(bookingsControllerProvider.notifier).refreshQuietly(),
      child: Scaffold(
        appBar: AppBar(title: const Text('My Bookings'), actions: [
          TextButton(onPressed: () => context.push('/booking/new'), child: const Text('New')),
        ]),
        body: bookings.when(
          loading: () => ListView(padding: const EdgeInsets.all(20), children: const [
            LoadingSkeleton(height: 90), SizedBox(height: 10), LoadingSkeleton(height: 90),
          ]),
          error: (e, st) => ErrorState(title: "Couldn't load your bookings", onRetry: () => ref.invalidate(bookingsControllerProvider)),
          data: (items) {
            if (items.isEmpty) {
              return EmptyState(
                icon: Icons.event_busy, title: 'No upcoming bookings',
                body: 'Reserve a seat or room to get started.',
                actionLabel: 'Book a resource', onAction: () => context.push('/booking/new'),
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              itemBuilder: (context, i) {
                final b = items[i];
                return Card(child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(b.resourceName, style: Theme.of(context).textTheme.titleSmall),
                    Text(b.timeSlot),
                    ..._statusLines(b),
                  ]),
                ));
              },
            );
          },
        ),
      ),
    );
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `flutter test test/features/bookings`
Expected: PASS.
Run: `flutter analyze && flutter test`
Expected: no issues; all pass.
Run: `flutter build web`
Expected: completes.

- [ ] **Step 7: Hand off the commit**

```bash
git add lib/features/bookings test/features/bookings
git commit -m "frontend: request rooms, with the answer in My Bookings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Live check, documentation and hand-off

**Files:**
- Modify: `frontend/README.md`, `admin/README.md`, `admin/CLAUDE.md`

**Interfaces:**
- Consumes: everything above, running together.

- [ ] **Step 1: Start all three apps**

In `backend/`: `npx prisma migrate deploy && npm run seed`, then in the background `npm run dev`; wait for `Node backend running on port 3000`.
In `admin/`: in the background `npm run dev`; wait for the ready line on port 3001.
In `frontend/`: in the background `flutter run -d web-server --web-port 8090`; wait for `is being served at http://localhost:8090`.

If `$SCRATCH/dev-admin-password.txt` is gone, recreate it and the dev admin as in Task 13 Step 1.

- [ ] **Step 2: The librarian logs in**

Ask the owner to log in to `http://localhost:3001` as `dev.admin@thapar.edu`, with the password in `$SCRATCH/dev-admin-password.txt`. Reading that file into this session is blocked as credential materialization, so the owner types it. Then confirm in that tab that the top bar shows `● Live` and the Dashboard shows `Waiting for approval (0)` with `No requests waiting.`

- [ ] **Step 3: Requests arrive live**

With the Claude in Chrome tools (load them in one ToolSearch call), open `http://localhost:8090` in a new tab and log in as `aditi.sharma@thapar.edu` / `password123` (seed demo data).

1. Search *Atomic Habits* → **Request to borrow**. Expected in the student tab: `Requested — waiting for a librarian. Expires …`. Expected in the console tab within 2 seconds, without reloading: a toast `New borrow request` with `Aditi Sharma wants to borrow Atomic Habits`; the sidebar badge `1`; the tab title `(1) SmartLib Admin`; the Dashboard row `Aditi Sharma · Atomic Habits`.
2. Bookings → New → Rooms → Tomorrow → pick a free slot → Continue → **Send request**. Expected: `Request sent` with the hold time; in the console a `New room request` toast, and the badge `2`.

Take one screenshot of the console with both requests waiting.

- [ ] **Step 4: Decisions reach the student**

1. Ask the owner to **Approve** the borrow request in the console. Expected in the student tab (book page open) within 30 seconds: `Borrowed — see My Loans for the due date`.
2. Ask the owner to **Decline** the room request with the reason `Reserved for an event`. Expected in My Bookings within 30 seconds: `Declined — Reserved for an event`.
3. As the student, book a seat for today's next free slot. Expected: the Dashboard's utilisation changes within 2 seconds.

- [ ] **Step 5: The console survives a restart**

Stop the backend. Expected within about a minute: `○ Reconnecting…` in the console. Start the backend again (`npm run dev`). Expected: `● Live` again, and the Dashboard numbers and badge match the database (the badge shows `0`).

- [ ] **Step 6: Stop everything and clean up**

Stop the three dev servers; if anything still listens on 3000, 3001 or 8090, stop that listener. Delete `$SCRATCH/dev-admin-password.txt`. Re-seed the dev data: `cd backend && npm run seed`.

- [ ] **Step 7: Update the documentation**

In `frontend/README.md`:

1. In *Tests*, replace the fixture command block with:

````markdown
```bash
cd ../backend && npm run seed && npm run dev    # separate terminal
SMARTLIB_ADMIN_EMAIL=you@thapar.edu \
SMARTLIB_ADMIN_PASSWORD_FILE=/path/to/password.txt \
  dart run tool/capture_fixtures.dart           # from frontend/
cd ../backend && npm run seed                   # restore the demo data
```

The capture has an admin approve and decline requests, so it needs an admin
account (`cd ../backend && npm run create-admin`). Its password is read from a
file so it never lands in your shell history.
````

2. Replace the whole *Manual acceptance checklist* table with:

```markdown
| # | Do | Expect | Chrome | Windows | Android |
|---|---|---|---|---|---|
| 1 | Launch for the first time | Splash, then **Log in** | ☐ | ☐ | ☐ |
| 2 | *Create account* with a new email and an 8+ character password | Lands on Home | ☐ | ☐ | ☐ |
| 3 | Profile → **Log out** | Back on Log in | ☐ | ☐ | ☐ |
| 4 | Log in as the demo user | Home: *Welcome back, Aditi* | ☐ | ☐ | ☐ |
| 5 | My Loans | 4 loans; one overdue showing *Fine: ₹30.0 and counting*; one showing *Renewal unavailable — 1 student is waiting for this title.* | ☐ | ☐ | ☐ |
| 6 | Search for a title, open a book with copies available, **Request to borrow** | *Requested — waiting for a librarian. Expires …*; the available count drops; My Loans lists it under **Requests** | ☐ | ☐ | ☐ |
| 7 | In the admin console, **Approve** that request; keep the book open | Within 30 seconds: *Borrowed — see My Loans…*, and the loan is in My Loans | ☐ | ☐ | ☐ |
| 8 | **Request to borrow** another book; in the console, **Decline** it with a reason | Within 30 seconds: *Your request was declined: …* and **Request again** | ☐ | ☐ | ☐ |
| 9 | **Renew** a renewable loan | *Renewed — now due …* | ☐ | ☐ | ☐ |
| 10 | **Return** a loan → confirm | Toast *Returned.*; the loan leaves the list | ☐ | ☐ | ☐ |
| 11 | Open *Operating System Concepts* (no copies free) → **Join Waitlist**; go back, then open it again | *You're #3 in line.* is still there; My Loans lists it under **Waitlist** | ☐ | ☐ | ☐ |
| 12 | On that book, **Leave waitlist** | Toast *You've left the waitlist.*; *Join Waitlist* is back | ☐ | ☐ | ☐ |
| 13 | **Held copy**: on another client, log in as `seed.student1@thapar.edu` (same password), request *The Midnight Library*, and approve it in the console. As Aditi, join its waitlist. Then return it as the other student | Aditi's My Loans shows *Held for you until …* and the book offers **Request to borrow**; the other student sees *Every copy on the shelf is held for a student on the waitlist.* | ☐ | ☐ | ☐ |
| 14 | Bookings → New → Seats → Tomorrow → pick a slot → Continue → **Confirm booking** | *Booked*; it appears under Bookings with *check-in opens at the start time* | ☐ | ☐ | ☐ |
| 15 | Bookings → New → Rooms → Tomorrow → pick a slot → Continue → **Send request**; then approve it in the console | *Request sent*; My Bookings shows *Waiting for a librarian · held until …*, then within 30 seconds *check-in opens at the start time* | ☐ | ☐ | ☐ |
| 16 | **Conflict**: on this platform, get to the confirm screen for a seat and slot. On another platform or browser tab, book that same seat and slot first. Then tap Confirm here | *That slot was just taken* with alternatives; tapping one books it | ☐ | ☐ | ☐ |
| 17 | **Check in**: between :00 and :15 past the hour (9 AM–7 PM), book today's current slot, open Bookings, tap **Check In** | *Enjoy your session.* | ☐ | ☐ | ☐ |
| 18 | **Cancel** a booking → confirm | Toast *Booking canceled.*; it leaves the list | ☐ | ☐ | ☐ |
| 19 | Profile | Reliability ring at 50, *Building back up*; **How reliability works** opens a dialog | ☐ | ☐ | ☐ |
| 20 | Home → Recommended for You → See all | A list of books | ☐ | ☐ | ☐ |
| 21 | **Relaunch** (web: reload the page; Windows: close the window and run again; Android: swipe it away from Recents and reopen) | Splash, then Home, **without logging in** | ☐ | ☐ | ☐ |
| 22 | **Expired session**: restart the backend with a throwaway secret (below), then type in Search | Back on Log in with *Your session has expired. Please log in again.* | ☐ | ☐ | ☐ |
| 23 | Restart the backend normally and log in again | Home | ☐ | ☐ | ☐ |
```

3. Below the table, change `**Steps 11 and 13 need two clients.**` to `**Steps 13 and 16 need two clients.**`, add the paragraph `**Steps 7, 8, 13 and 15 need the admin console** (\`../admin\`), logged in with an admin account.`, change `**Step 19**` to `**Step 22**`, and in the PowerShell block change `# step 20: stop it, then` to `# step 23: stop it, then`.

4. In *Layout*, change `catalog/               # search, book detail, borrow` to `catalog/               # search, book detail, borrow requests`, add the line `    ├── borrow_requests/       # borrow requests: repository and controller` after it, and change `# login → borrow → booking conflict, on mocks` to `# login → request → booking conflict, on mocks`.

In `admin/README.md`, replace the opening paragraph with:

```markdown
The librarian console for SmartLib: log in with an admin account, approve or
decline the borrow and room requests students send, and see live utilisation,
circulation, overdue and demand metrics. Everything updates live, without
reloading. Built with Next.js and the Organic design system; talks only to the
SmartLib API (`../backend`).
```

and add before *Design*:

```markdown
## Live updates

The console keeps one Server-Sent Events connection to `GET /admin/events`
(`lib/live.ts`). Events only say what changed; the views refetch, a second
after the last event. On every reconnect, and every 5 minutes, everything
refetches, so a dropped connection loses nothing. The top bar shows
`● Live` or `○ Reconnecting…`.
```

In `admin/CLAUDE.md`, add to *Conventions*:

```markdown
- Live updates come from `lib/liveContext.tsx`: refetch with
  `useLiveRefresh(topics, refetch)` or react with `useLiveMessages`. Never poll.
- Pending requests live in `RequestsProvider` (`lib/requestsContext.tsx`); read
  them with `useRequests()` instead of fetching them again.
```

- [ ] **Step 8: Run every suite one last time**

Run in `backend/`: `npm test`. Expected: all pass.
Run in `admin/`: `npm test && npm run build`. Expected: all pass; the build completes.
Run in `frontend/`: `flutter analyze && flutter test`. Expected: no issues; all pass.

- [ ] **Step 9: Hand off the commits and the release**

Per the batching ruling, one commit per repository. In `backend/`:

```bash
git add prisma src test README.md CLAUDE.md
git commit -m "backend: approve borrow and room requests, live events for the admin console" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

In `admin/`:

```bash
git add .
git commit -m "admin: add the live Requests queue and a live Dashboard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

In `frontend/`:

```bash
git add lib test tool README.md
git commit -m "frontend: request books and rooms, with the librarian's answer in the app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
git tag v1.1.0 && git push origin v1.1.0
```

Then tell the owner, in order:
1. Push the backend first: Render applies both migrations during its build (they are safe on live data; existing bookings keep their statuses).
2. Push the console and the student app; Vercel and GitHub Pages redeploy them.
3. The `v1.1.0` tag builds the new APK in the Release workflow; ask testers to install it. On older APKs, *Borrow* answers with the update message, and My Bookings fails to load once it contains a room request.
4. Check production once: request a book from the web app and watch it arrive in the Vercel console. If the stream never shows `● Live` there, Render may be buffering it; send the browser console output.
