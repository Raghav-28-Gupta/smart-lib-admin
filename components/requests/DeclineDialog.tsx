'use client'

import { useState } from 'react'
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
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="decline-title">
        <div className="dialog-title" id="decline-title">Decline this request?</div>
        <div className="dialog-body">{`${request.student.name} — ${requestSubject(request)}. The ${held} goes back to other students.`}</div>
        <div className="field">
          <label htmlFor="decline-reason">Reason (optional)</label>
          <textarea
            id="decline-reason"
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
      </div>
    </div>
  )
}
