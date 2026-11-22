import { bookingStatusTag } from '@/components/bookings/bookingStatus'
import { StudentLink } from '@/components/StudentLink'
import { LIBRARY_TIMEZONE, shortDay, timeSpan } from '@/lib/format'
import type { AdminBooking } from '@/lib/bookings'

/**
 * The canvas's bookings table. A cancelled row says who cancelled it and, if given, why.
 * Reassign and Cancel show only where the server says the booking can still be managed;
 * `busy` disables them all while a change is settling.
 */
export function BookingsTable({
  bookings, busy, onReassign, onCancel,
}: {
  bookings: AdminBooking[]
  busy: boolean
  onReassign: (booking: AdminBooking) => void
  onCancel: (booking: AdminBooking) => void
}) {
  return (
    <div style={{ border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
      <table className="table" style={{ width: '100%', minWidth: 640 }}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Student</th>
            <th>Date</th>
            <th>Time</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const tag = bookingStatusTag(b.status)
            return (
              <tr key={b.id}>
                <td>{b.resource.name}</td>
                <td><StudentLink student={b.student} from="bookings" /></td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{shortDay(b.startTime, LIBRARY_TIMEZONE)}</td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{timeSpan(b.startTime, b.endTime, LIBRARY_TIMEZONE)}</td>
                <td>
                  <span className={`tag ${tag.cls}`}>{tag.label}</span>
                  {b.status === 'cancelled' && b.cancelledBy && (
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>{`by the ${b.cancelledBy}`}</div>
                  )}
                  {b.status === 'cancelled' && b.cancelReason && (
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2, maxWidth: 260, overflowWrap: 'anywhere' }}>
                      {b.cancelReason}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {b.canManage && (
                    <>
                      <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => onReassign(b)}>
                        Reassign
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12, color: 'var(--color-accent-700)' }}
                        disabled={busy}
                        onClick={() => onCancel(b)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
