'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import { StudentWords } from '@/components/attention/StudentWords'
import type { NoShowDisputeItem } from '@/lib/attention'

/**
 * "Overturn this no-show flag?": the flag is removed and the student's reliability score is restored; the student is told,
 * with the librarian's reason. The reason is required (Overturn flag stays off until it holds something besides spaces), at
 * most 300 characters: the textarea's own limit counts UTF-16 units, as the server does. The student's words are repeated in
 * full above the field, so a dispute is never settled unread.
 * `onConfirm` is given the reason as typed and resolves true once the dispute is overturned and the page closes the dialog; on
 * false it stays open with the reason (the page has toasted the server's reason, for example that someone else resolved the
 * dispute). Confirm is disabled while the write is in flight.
 */
export function OverturnNoShowDialog({
  item, onCancel, onConfirm,
}: {
  item: NoShowDisputeItem
  onCancel: () => void
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const [reason, setReason] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onConfirm)
  const valid = reason.trim() !== ''

  return (
    <Dialog title="Overturn this no-show flag?" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit(reason)
        }}
      >
        <div className="dialog-body">
          {`${item.student.name}'s reliability score is restored and the flag is removed. A reason is required for the record.`}
        </div>
        <StudentWords label="The student's reason" words={item.noShow.studentReason} />
        <div className="field">
          <label htmlFor={`${id}-reason`}>Reason (required)</label>
          <textarea
            id={`${id}-reason`}
            className="input"
            rows={2}
            maxLength={300}
            autoFocus
            placeholder="Why is this no-show being overturned?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={!valid || submitting}>Overturn flag</button>
        </div>
      </form>
    </Dialog>
  )
}
