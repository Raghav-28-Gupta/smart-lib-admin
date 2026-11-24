'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import { disputeSummary, type FineDisputeItem } from '@/lib/attention'
import { StudentWords } from '@/components/attention/StudentWords'

/**
 * "Uphold this fine?": the dispute is closed and the fine stands; the student is told, with the librarian's optional note.
 * It repeats the student's reason in full, so the one dispute a fine can have is never closed on a cut-short card.
 * `onConfirm` is given the note as typed and resolves true once the dispute is closed and the page closes the dialog; on
 * false it stays open with the note (the page has toasted the server's reason, for example that someone else resolved
 * the dispute). Confirm is disabled while the write is in flight.
 */
export function UpholdDialog({
  item, onCancel, onConfirm,
}: {
  item: FineDisputeItem
  onCancel: () => void
  onConfirm: (note: string) => Promise<boolean>
}) {
  const [note, setNote] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onConfirm)

  return (
    <Dialog title="Uphold this fine?" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(note)
        }}
      >
        <div className="dialog-body">
          {`The dispute is closed and the fine stands. ${disputeSummary(item.dispute)}.`}
        </div>
        <StudentWords label="The student's reason" words={item.dispute.studentReason} />
        <div className="field">
          <label htmlFor={`${id}-note`}>Note (optional)</label>
          <textarea
            id={`${id}-note`}
            className="input"
            rows={2}
            maxLength={300}
            autoFocus
            placeholder="Added to the notice the student receives"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={submitting}>Uphold fine</button>
        </div>
      </form>
    </Dialog>
  )
}
