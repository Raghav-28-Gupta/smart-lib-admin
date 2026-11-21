import { LIBRARY_TIMEZONE, rupees, shortDay } from '@/lib/format'
import type { AdminFine, FineStatus } from '@/lib/fines'

// The canvas's tag classes for each status.
const STATUS_TAGS: Record<FineStatus, { label: string; cls: string }> = {
  accruing: { label: 'Accruing', cls: 'tag-accent' },
  outstanding: { label: 'Outstanding', cls: 'tag-accent' },
  adjusted: { label: 'Adjusted', cls: 'tag-accent-2' },
  paid: { label: 'Paid', cls: 'tag-accent-2' },
  waived: { label: 'Waived', cls: 'tag-accent-2' },
}

const REASON_LABELS: Record<AdminFine['reason'], string> = {
  overdue: 'Overdue',
  no_show: 'No-show',
  lost: 'Lost book',
}

/**
 * The canvas's fines table. An adjusted or waived row shows the amount it was, and under its tag the
 * librarian's reason and who recorded it. Mark paid and Waive / adjust show only where the server says
 * the fine can still be settled; `busy` disables them all while a change is settling.
 */
export function FinesTable({
  fines, busy, onMarkPaid, onAdjust,
}: {
  fines: AdminFine[]
  busy: boolean
  onMarkPaid: (fine: AdminFine) => void
  onAdjust: (fine: AdminFine) => void
}) {
  return (
    <div style={{ border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
      <table className="table" style={{ width: '100%', minWidth: 640 }}>
        <thead>
          <tr>
            <th>Student</th>
            <th>Reason</th>
            <th>Item</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Date</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {fines.map((f) => {
            // A status or reason this console does not know (a newer server) still shows, as itself.
            const tag = STATUS_TAGS[f.status] ?? { label: f.status, cls: 'tag-neutral' }
            const changed = f.status === 'adjusted' || f.status === 'waived'
            return (
              // An accruing row's id is its loan's, so it can equal a fine's: the kind keeps the keys apart.
              <tr key={`${f.kind}:${f.id}`}>
                <td>{f.student.name}</td>
                <td className="text-muted">{REASON_LABELS[f.reason] ?? f.reason}</td>
                <td className="text-muted">{f.item}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{changed ? `${rupees(f.amount)} (was ${rupees(f.originalAmount)})` : rupees(f.amount)}</td>
                <td>
                  <span className={`tag ${tag.cls}`}>{tag.label}</span>
                  {changed && f.note && (
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4, maxWidth: 260, overflowWrap: 'anywhere' }}>
                      {`${f.note} — ${f.recordedBy ?? 'the library'}`}
                    </div>
                  )}
                </td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{shortDay(f.date, LIBRARY_TIMEZONE)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {f.canSettle && (
                    <>
                      <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => onMarkPaid(f)}>
                        Mark paid
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => onAdjust(f)}>
                        Waive / adjust
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
