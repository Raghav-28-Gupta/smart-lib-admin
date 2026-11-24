import { FineStatusCell, fineAmountLabel } from '@/components/fines/FineCells'
import { StudentLink } from '@/components/StudentLink'
import { LIBRARY_TIMEZONE, shortDay } from '@/lib/format'
import type { AdminFine } from '@/lib/fines'

const REASON_LABELS: Record<AdminFine['reason'], string> = {
  overdue: 'Overdue',
  no_show: 'No-show',
  lost: 'Lost book',
}

/**
 * The canvas's fines table. A fine that was ever lowered shows the amount it was, and under its tag the
 * librarian's reason; an adjusted or waived row adds who recorded it, a paid one shows the reason alone.
 * Mark paid and Waive / adjust show only where the server says the fine can still be settled, and Mark paid
 * not while the fine is disputed (the server refuses it: the dispute is resolved first, by Waive / adjust here or
 * from Needs attention); `busy` disables them all while a change is settling.
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
            return (
              // An accruing row's id is its loan's, so it can equal a fine's: the kind keeps the keys apart.
              <tr key={`${f.kind}:${f.id}`}>
                <td><StudentLink student={f.student} from="fines" /></td>
                {/* A reason this console does not know (a newer server) still shows, as itself. */}
                <td className="text-muted">{REASON_LABELS[f.reason] ?? f.reason}</td>
                <td className="text-muted">{f.item}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fineAmountLabel(f)}</td>
                <td><FineStatusCell fine={f} /></td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{shortDay(f.date, LIBRARY_TIMEZONE)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {f.canSettle && (
                    <>
                      {!f.dispute && (
                        <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => onMarkPaid(f)}>
                          Mark paid
                        </button>
                      )}
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
