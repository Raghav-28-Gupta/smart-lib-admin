'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import { StudentWords } from '@/components/attention/StudentWords'
import { reportSummary, type ReportItem } from '@/lib/attention'

/**
 * "Dismiss this report?": the report is closed with no action; the student is told no action was needed, with the
 * librarian's optional note. The body is the canvas's sentence, then what the student is told; the student's own note
 * (the card cuts a long one short) is repeated in full when there is one. `onConfirm` is given the note as typed and resolves true once the report is closed and the
 * page closes the dialog; on false it stays open with the note (the page has toasted the server's reason, for example that
 * someone else resolved the report). Confirm is disabled while the write is in flight.
 */
export function DismissDialog({
  item, onCancel, onConfirm,
}: {
  item: ReportItem
  onCancel: () => void
  onConfirm: (note: string) => Promise<boolean>
}) {
  const [note, setNote] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onConfirm)

  return (
    <Dialog title="Dismiss this report?" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(note)
        }}
      >
        <div className="dialog-body">
          {`${reportSummary(item.report)} will be cleared from the queue with no further action. The student is told no action was needed, with your note if you add one.`}
        </div>
        {item.report.note && <StudentWords label="The student's note" words={item.report.note} />}
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
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={submitting}>Dismiss</button>
        </div>
      </form>
    </Dialog>
  )
}
