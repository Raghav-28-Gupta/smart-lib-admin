import { LIBRARY_TIMEZONE, shortDay, timeSpan } from '@/lib/format'
import type { AdminBooking, BookingStatus } from '@/lib/bookings'

// The canvas's tag classes for each status.
const STATUS_TAGS: Record<BookingStatus, { label: string; cls: string }> = {
  booked: { label: 'Booked', cls: 'tag-neutral' },
  checked_in: { label: 'Checked in', cls: 'tag-neutral' },
  completed: { label: 'Completed', cls: 'tag-accent-2' },
  released: { label: 'Released', cls: 'tag-neutral' },
  cancelled: { label: 'Cancelled', cls: 'tag-neutral' },
}

/** The canvas's bookings table. A cancelled row says who cancelled it and, if given, why. */
export function BookingsTable({ bookings }: { bookings: AdminBooking[] }) {
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
            // A status this console does not know (a newer server) still shows, as itself.
            const tag = STATUS_TAGS[b.status] ?? { label: b.status, cls: 'tag-neutral' }
            return (
              <tr key={b.id}>
                <td>{b.resource.name}</td>
                <td>{b.student.name}</td>
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
                {/* Where Reassign and Cancel go, for a booking the librarian can manage (b.canManage). */}
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
