'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import type { PendingRequest } from '@/lib/requests'
import { requestSubject } from './requestText'

/** The canvas's decline dialog, with an optional reason the student will see. */
export function DeclineDialog({
  request, onCancel, onConfirm,
}: {
  request: PendingRequest
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const held = request.kind === 'borrow' ? 'copy' : 'slot'
  const id = useId()

  return (
    <Dialog title="Decline this request?" onCancel={onCancel}>
      <div className="dialog-body">{`${request.student.name} — ${requestSubject(request)}. The ${held} goes back to other students.`}</div>
      <div className="field">
        <label htmlFor={`${id}-reason`}>Reason (optional)</label>
        <textarea
          id={`${id}-reason`}
          className="input"
          rows={2}
          maxLength={300}
          autoFocus
          placeholder="Shown to the student, e.g. the room is reserved for an event"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onConfirm(reason)}>Decline request</button>
      </div>
    </Dialog>
  )
}
