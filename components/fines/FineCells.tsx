import { rupees } from '@/lib/format'
import type { AdminFine, FineStatus } from '@/lib/fines'

// The canvas's tag classes for each status.
const STATUS_TAGS: Record<FineStatus, { label: string; cls: string }> = {
  accruing: { label: 'Accruing', cls: 'tag-accent' },
  outstanding: { label: 'Outstanding', cls: 'tag-accent' },
  disputed: { label: 'Disputed', cls: 'tag-accent' },
  adjusted: { label: 'Adjusted', cls: 'tag-accent-2' },
  paid: { label: 'Paid', cls: 'tag-accent-2' },
  waived: { label: 'Waived', cls: 'tag-accent-2' },
}

/**
 * What a fine's amount cell says, on the Fines page and in a student's fine history. A fine that was ever
 * lowered keeps its history after it is paid, so it shows what it was whatever its status: "₹50 (was ₹150)".
 */
export function fineAmountLabel(fine: Pick<AdminFine, 'amount' | 'originalAmount'>): string {
  return fine.originalAmount !== fine.amount ? `${rupees(fine.amount)} (was ${rupees(fine.originalAmount)})` : rupees(fine.amount)
}

/**
 * What a fine's status cell holds: the status tag and, under it, an open dispute's student line and the librarian's reason.
 * A disputed fine shows what the student wrote as `Student: "<reason>"` (the whole text in the tooltip: the line is cut
 * short at two lines). An adjusted or waived row adds who recorded the librarian's note (the library itself when no one),
 * a paid one shows the note alone, because on a paid row `recordedBy` is whoever recorded the payment, not whoever wrote
 * the note; so does a disputed one, whose underlying state this cell cannot tell.
 */
export function FineStatusCell({ fine }: { fine: AdminFine }) {
  // A status this console does not know (a newer server) still shows, as itself.
  const tag = Object.hasOwn(STATUS_TAGS, fine.status) ? STATUS_TAGS[fine.status] : { label: fine.status, cls: 'tag-neutral' }
  const noteBy = fine.status === 'adjusted' || fine.status === 'waived'
  return (
    <>
      <span className={`tag ${tag.cls}`}>{tag.label}</span>
      {fine.dispute && (
        <div
          className="text-muted"
          title={fine.dispute.reason}
          style={{
            fontSize: 11.5, marginTop: 4, maxWidth: 260, overflowWrap: 'anywhere',
            display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden',
          }}
        >
          {`Student: "${fine.dispute.reason}"`}
        </div>
      )}
      {fine.note && (
        <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4, maxWidth: 260, overflowWrap: 'anywhere' }}>
          {noteBy ? `${fine.note} — ${fine.recordedBy ?? 'the library'}` : fine.note}
        </div>
      )}
    </>
  )
}
