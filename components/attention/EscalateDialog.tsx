'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import type { OverdueItem } from '@/lib/attention'

/**
 * "Escalate to a formal notice?": the student gets a formal overdue notice, with the librarian's optional note.
 * `onConfirm` is given the note as typed and resolves true once the notice is sent and the page closes the dialog; on
 * false it stays open with the note (the page has toasted the server's reason). Confirm is disabled while the write
 * is in flight.
 */
export function EscalateDialog({
  item, onCancel, onConfirm,
}: {
  item: OverdueItem
  onCancel: () => void
  onConfirm: (note: string) => Promise<boolean>
}) {
  const [note, setNote] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onConfirm)

  return (
    <Dialog title="Escalate to a formal notice?" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(note)
        }}
      >
        <div className="dialog-body">
          {`${item.student.name} will receive a formal overdue notice for ${item.overdue.title} (and an email when email is set up). The fine keeps growing at ₹10 a day until the book is back.`}
        </div>
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
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={submitting}>Escalate</button>
        </div>
      </form>
    </Dialog>
  )
}
