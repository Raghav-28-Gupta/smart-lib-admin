import { StudentLink } from '@/components/StudentLink'
import type { AdminCopy, CopyStatus } from '@/lib/catalogue'
import { LIBRARY_TIMEZONE, shortDay } from '@/lib/format'

/** What a chip's buttons ask for: the page opens the matching confirmation. */
export type CopyAction = 'maintenance' | 'lost' | 'restore'

// The canvas's tag classes for each copy status.
const STATUS_TAGS: Record<CopyStatus, { label: string; cls: string }> = {
  available: { label: 'Available', cls: 'tag-accent-2' },
  on_loan: { label: 'On loan', cls: 'tag-neutral' },
  held: { label: 'Held', cls: 'tag-neutral' },
  maintenance: { label: 'Maintenance', cls: 'tag-accent' },
  lost: { label: 'Lost', cls: 'tag-accent' },
}

interface ChipButton {
  action: CopyAction
  label: string
  color: string
}

// The canvas's colours: the two that take a copy out of circulation in accent, Restore in the green.
const MAINTENANCE_BUTTON: ChipButton = { action: 'maintenance', label: 'Maintenance', color: 'var(--color-accent-700)' }
const LOST_BUTTON: ChipButton = { action: 'lost', label: 'Lost', color: 'var(--color-accent-700)' }
const RESTORE_BUTTON: ChipButton = { action: 'restore', label: 'Restore', color: 'var(--color-accent-2-800)' }

/**
 * The actions a copy offers, as the spec and canvas have them: a shelf copy can go into maintenance or be
 * lost, one on loan can be lost, one out of service can be restored. A held copy (a pending borrow request)
 * accepts none, and neither does a status this console does not know.
 */
const ACTIONS: Partial<Record<CopyStatus, readonly ChipButton[]>> = {
  available: [MAINTENANCE_BUTTON, LOST_BUTTON],
  on_loan: [LOST_BUTTON],
  maintenance: [RESTORE_BUTTON],
  lost: [RESTORE_BUTTON],
}

/**
 * One copy of a book: its barcode and status tag. A copy on loan also says who has it (a link to the student's
 * page) and when it is due, in the library's time zone; one marked borrowed with no open loan (seed data) shows
 * just the tag.
 * Then the copy's actions as the canvas's text buttons, disabled while `busy` (a change is settling).
 */
export function CopyChip({
  copy, busy, onAction,
}: {
  copy: AdminCopy
  busy: boolean
  onAction: (copy: AdminCopy, action: CopyAction) => void
}) {
  // A status this console does not know (a newer server) still shows, as itself.
  const tag = STATUS_TAGS[copy.status] ?? { label: copy.status, cls: 'tag-neutral' }
  const borrower = copy.status === 'on_loan' ? copy.borrower : null

  return (
    <li
      style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, padding: '5px 10px',
        border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-sm)', fontSize: 11.5,
      }}
    >
      <span className="text-muted">{copy.barcode}</span>
      <span className={`tag ${tag.cls}`} style={{ fontSize: 10 }}>{tag.label}</span>
      {borrower && (
        <span className="text-muted">
          <StudentLink student={borrower} from="catalogue" />
          {copy.dueAt && ` · due ${shortDay(copy.dueAt, LIBRARY_TIMEZONE)}`}
        </span>
      )}
      {(ACTIONS[copy.status] ?? []).map(({ action, label, color }) => (
        <button
          key={action}
          type="button"
          className="sla-chip"
          style={{ background: 'none', padding: 0, color }}
          disabled={busy}
          onClick={() => onAction(copy, action)}
        >
          {label}
        </button>
      ))}
    </li>
  )
}
