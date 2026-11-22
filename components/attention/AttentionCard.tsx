'use client'

import { StudentLink } from '@/components/StudentLink'
import { overdueDetail, overdueSummary, waitingText, type AttentionItem, type OverdueItem } from '@/lib/attention'
import { useNow } from '@/lib/useNow'

/**
 * One queue item on the Needs attention page, in the canvas's card layout. The page owns the dialogs and the writes:
 * `onRemind` and `onEscalate` open them, and `busy` (a write is running, or the queue has not been refetched since)
 * disables the buttons. An escalated overdue loan (`overdue.escalated`: ever escalated, whatever the newest notice is)
 * carries an "Escalated" tag and has no Escalate button (it happens once per loan); it can still be reminded, and the
 * server holds that to once a day. The detail line shows the newest notice, whichever kind it is.
 */
export function AttentionCard({
  item, busy, onRemind, onEscalate,
}: {
  item: AttentionItem
  busy: boolean
  onRemind: (item: OverdueItem) => void
  onEscalate: (item: OverdueItem) => void
}) {
  const now = useNow()

  // The other kinds (fine dispute, problem report) get their own cases with their cards.
  if (item.kind !== 'overdue') return null

  // From the loan's own flag, not the newest notice: a reminder sent after an escalation is the newest notice, and the loan
  // is still an escalated one that cannot be escalated again.
  const { escalated } = item.overdue

  return (
    <div className="card elev-sm" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="tag tag-accent">Overdue follow-up</span>
          {escalated && <span className="tag tag-neutral">Escalated</span>}
          <span style={{ fontSize: 13, fontWeight: 600 }}><StudentLink student={item.student} from="attention" /></span>
          <span className="text-muted" style={{ fontSize: 11.5 }}>{waitingText(item.waitingSince, now)}</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{overdueSummary(item.overdue)}</div>
        <div className="text-muted" style={{ fontSize: 12.5 }}>{overdueDetail(item.overdue, now)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none', minWidth: 150 }}>
        <button type="button" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={busy} onClick={() => onRemind(item)}>
          Send reminder
        </button>
        {!escalated && (
          <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={busy} onClick={() => onEscalate(item)}>
            Escalate
          </button>
        )}
      </div>
    </div>
  )
}
