import { useId, type ReactNode } from 'react'
import { bookingStatusTag } from '@/components/bookings/bookingStatus'
import { FineStatusCell, fineAmountLabel } from '@/components/fines/FineCells'
import { LIBRARY_TIMEZONE, shortDay, timeSpan } from '@/lib/format'
import type { AdminStudent, LoanStatus, StudentLoan } from '@/lib/students'

// The canvas's tag classes. The canvas has none for an active loan, so it takes its fallback class.
const LOAN_STATUS_TAGS: Record<LoanStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'tag-neutral' },
  overdue: { label: 'Overdue', cls: 'tag-accent' },
  returned: { label: 'Returned', cls: 'tag-accent-2' },
  lost: { label: 'Lost', cls: 'tag-accent' },
}

function loanTag(status: string): { label: string; cls: string } {
  // A status this console does not know (a newer server) still shows, as itself.
  return Object.hasOwn(LOAN_STATUS_TAGS, status) ? LOAN_STATUS_TAGS[status as LoanStatus] : { label: status, cls: 'tag-neutral' }
}

/** The day a loan ended: when it came back, or when it was lost; a dash while it is still out. */
function endedLabel(loan: StudentLoan): string {
  const ended = loan.returnedAt ?? loan.lostAt
  return ended ? shortDay(ended, LIBRARY_TIMEZONE) : '—'
}

/** One of the canvas's history cards: a title, then either its table or its empty line. */
function HistoryCard({ title, empty, minWidth, isEmpty, children }: {
  title: string
  empty: string
  minWidth: number
  isEmpty: boolean
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="card elev-sm" style={{ padding: '16px 18px' }}>
      <h3 id={titleId} className="card-title" style={{ fontSize: 13.5, margin: '0 0 10px' }}>{title}</h3>
      {isEmpty ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{empty}</p>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="table" style={{ width: '100%', minWidth }}>{children}</table>
        </div>
      )}
    </section>
  )
}

/**
 * The canvas's three history cards, newest first as the server sends them: loans, bookings and fines. Read-only:
 * a fine is settled on the Fines page and a booking managed on the Bookings page. Dates are in the library's time zone.
 * The fine rows share the Fines page's status tags, its "(was ₹X)" amounts and its notes.
 */
export function HistoryTables({ student }: { student: Pick<AdminStudent, 'loans' | 'bookings' | 'fines'> }) {
  return (
    <>
      <HistoryCard title="Loan history" empty="No loan history for this student." minWidth={520} isEmpty={student.loans.length === 0}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Borrowed</th>
            <th>Due</th>
            <th>Returned</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {student.loans.map((loan) => {
            const tag = loanTag(loan.status)
            return (
              <tr key={loan.id}>
                <td>{loan.title}</td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{shortDay(loan.borrowedAt, LIBRARY_TIMEZONE)}</td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{shortDay(loan.dueAt, LIBRARY_TIMEZONE)}</td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{endedLabel(loan)}</td>
                <td><span className={`tag ${tag.cls}`}>{tag.label}</span></td>
              </tr>
            )
          })}
        </tbody>
      </HistoryCard>

      <HistoryCard title="Booking history" empty="No booking history for this student." minWidth={480} isEmpty={student.bookings.length === 0}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Date</th>
            <th>Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {student.bookings.map((booking) => {
            const tag = bookingStatusTag(booking.status)
            return (
              <tr key={booking.id}>
                <td>{booking.resource}</td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{shortDay(booking.startTime, LIBRARY_TIMEZONE)}</td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{timeSpan(booking.startTime, booking.endTime, LIBRARY_TIMEZONE)}</td>
                <td><span className={`tag ${tag.cls}`}>{tag.label}</span></td>
              </tr>
            )
          })}
        </tbody>
      </HistoryCard>

      <HistoryCard title="Fine history" empty="No fine history for this student." minWidth={420} isEmpty={student.fines.length === 0}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {student.fines.map((fine) => (
            // An accruing row's id is its loan's, so it can equal a fine's: the kind keeps the keys apart.
            <tr key={`${fine.kind}:${fine.id}`}>
              <td>{fine.item}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fineAmountLabel(fine)}</td>
              <td><FineStatusCell fine={fine} /></td>
              <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{shortDay(fine.date, LIBRARY_TIMEZONE)}</td>
            </tr>
          ))}
        </tbody>
      </HistoryCard>
    </>
  )
}
