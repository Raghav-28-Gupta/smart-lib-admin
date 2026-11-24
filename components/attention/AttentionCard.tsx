'use client'

import type { CSSProperties, ReactNode } from 'react'
import { StudentLink } from '@/components/StudentLink'
import {
  disputeSummary, overdueDetail, overdueSummary, reportSummary, waitingText,
  type AttentionItem, type FineDisputeItem, type OverdueItem, type ReportItem,
} from '@/lib/attention'
import { useNow } from '@/lib/useNow'

const buttonStyle: CSSProperties = { padding: '6px 12px', fontSize: 12.5 }

// A report's note can run to 300 characters: two lines on the card, the whole text in the tooltip and in full in the Confirm
// and Dismiss dialogs. A dispute's reason is not cut: it is the one thing the librarian reads before a decision the student
// cannot repeat (a fine is disputed once), so it shows whole.
const clamp: CSSProperties = {
  fontSize: 12.5, overflowWrap: 'anywhere',
  display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden',
}

/**
 * One queue item on the Needs attention page, in the canvas's card layout. The page owns the dialogs and the writes:
 * `onRemind`, `onEscalate`, `onAdjust`, `onUphold`, `onConfirmCopy`, `onTakeOffline` and `onDismiss` open them, and `busy`
 * (a write is running, or the queue has not been refetched since) disables the buttons.
 *
 * An escalated overdue loan (`overdue.escalated`: ever escalated, whatever the newest notice is) carries an "Escalated"
 * tag and has no Escalate button (it happens once per loan); it can still be reminded, and the server holds that to
 * once a day. The detail line shows the newest notice, whichever kind it is.
 *
 * A fine dispute shows the student's words as text (never markup), in full, and offers Waive / adjust (the Fines page's
 * adjust dialog) and Uphold fine (a confirmation with an optional note); both dialogs repeat the words.
 *
 * A problem report carries the neutral "Maintenance flag" tag and shows the student's note as text, cut at two lines (the
 * Confirm and Dismiss dialogs show all of it). A copy report offers Confirm & flag copy, a resource report Take offline
 * (its note box starts with the student's words); both offer Dismiss.
 */
export function AttentionCard({
  item, busy, onRemind, onEscalate, onAdjust, onUphold, onConfirmCopy, onTakeOffline, onDismiss,
}: {
  item: AttentionItem
  busy: boolean
  onRemind: (item: OverdueItem) => void
  onEscalate: (item: OverdueItem) => void
  onAdjust: (item: FineDisputeItem) => void
  onUphold: (item: FineDisputeItem) => void
  onConfirmCopy: (item: ReportItem) => void
  onTakeOffline: (item: ReportItem) => void
  onDismiss: (item: ReportItem) => void
}) {
  const now = useNow()

  if (item.kind === 'fine_dispute') {
    const words = item.dispute.studentReason
    return (
      <CardFrame
        tags={<span className="tag tag-accent">Fine dispute</span>}
        student={item.student}
        waiting={waitingText(item.waitingSince, now)}
        summary={disputeSummary(item.dispute)}
        detail={<div className="text-muted" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{words}</div>}
        actions={
          <>
            <button type="button" className="btn btn-primary" style={buttonStyle} disabled={busy} onClick={() => onAdjust(item)}>
              Waive / adjust
            </button>
            <button type="button" className="btn btn-ghost" style={buttonStyle} disabled={busy} onClick={() => onUphold(item)}>
              Uphold fine
            </button>
          </>
        }
      />
    )
  }

  if (item.kind === 'report') {
    const { note, target } = item.report
    return (
      <CardFrame
        tags={<span className="tag tag-neutral">Maintenance flag</span>}
        student={item.student}
        waiting={waitingText(item.waitingSince, now)}
        summary={reportSummary(item.report)}
        detail={note ? <div className="text-muted" title={note} style={clamp}>{note}</div> : null}
        actions={
          <>
            {target === 'copy' ? (
              <button type="button" className="btn btn-primary" style={buttonStyle} disabled={busy} onClick={() => onConfirmCopy(item)}>
                Confirm &amp; flag copy
              </button>
            ) : (
              <button type="button" className="btn btn-primary" style={buttonStyle} disabled={busy} onClick={() => onTakeOffline(item)}>
                Take offline
              </button>
            )}
            <button type="button" className="btn btn-ghost" style={buttonStyle} disabled={busy} onClick={() => onDismiss(item)}>
              Dismiss
            </button>
          </>
        }
      />
    )
  }

  // From the loan's own flag, not the newest notice: a reminder sent after an escalation is the newest notice, and the loan
  // is still an escalated one that cannot be escalated again.
  const { escalated } = item.overdue

  return (
    <CardFrame
      tags={
        <>
          <span className="tag tag-accent">Overdue follow-up</span>
          {escalated && <span className="tag tag-neutral">Escalated</span>}
        </>
      }
      student={item.student}
      waiting={waitingText(item.waitingSince, now)}
      summary={overdueSummary(item.overdue)}
      detail={<div className="text-muted" style={{ fontSize: 12.5 }}>{overdueDetail(item.overdue, now)}</div>}
      actions={
        <>
          <button type="button" className="btn btn-primary" style={buttonStyle} disabled={busy} onClick={() => onRemind(item)}>
            Send reminder
          </button>
          {!escalated && (
            <button type="button" className="btn btn-ghost" style={buttonStyle} disabled={busy} onClick={() => onEscalate(item)}>
              Escalate
            </button>
          )}
        </>
      }
    />
  )
}

/** The canvas's card: tags, the student's link and how long it has waited, a summary and a detail line, and a column of buttons. */
function CardFrame({
  tags, student, waiting, summary, detail, actions,
}: {
  tags: ReactNode
  student: AttentionItem['student']
  waiting: string
  summary: string
  detail: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="card elev-sm" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {tags}
          <span style={{ fontSize: 13, fontWeight: 600 }}><StudentLink student={student} from="attention" /></span>
          <span className="text-muted" style={{ fontSize: 11.5 }}>{waiting}</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{summary}</div>
        {detail}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none', minWidth: 150 }}>{actions}</div>
    </div>
  )
}
