'use client'

import { useEffect, useId, useRef, useState } from 'react'
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
  const dialogRef = useRef<HTMLDivElement>(null)
  // The button that opened the dialog: read while rendering, before autoFocus moves focus into it.
  const [opener] = useState(() => document.activeElement)

  // Escape cancels, and Tab stays inside the dialog, so Enter can never reach another request's button.
  useEffect(() => {
    const dialog = dialogRef.current!
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)'))
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!dialog.contains(active)) {
        event.preventDefault()
        const edge = event.shiftKey ? last : first
        edge.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  // Closing hands focus back to where it came from. Skipped while the dialog is
  // still in the page, which is only React Strict Mode re-running this effect in development.
  useEffect(() => {
    const dialog = dialogRef.current!
    return () => {
      if (!dialog.isConnected && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [opener])

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="dialog-title" id={`${id}-title`}>Decline this request?</div>
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
      </div>
    </div>
  )
}
