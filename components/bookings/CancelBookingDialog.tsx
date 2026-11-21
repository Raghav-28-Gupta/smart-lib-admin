'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import type { AdminBooking } from '@/lib/bookings'
import { LIBRARY_TIMEZONE, shortDay, timeSpan } from '@/lib/format'

/** The canvas's "Cancel this booking?" dialog, with an optional reason the student will see. */
export function CancelBookingDialog({
  booking, onCancel, onConfirm,
}: {
  booking: AdminBooking
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const id = useId()
  const when = `${shortDay(booking.startTime, LIBRARY_TIMEZONE)} · ${timeSpan(booking.startTime, booking.endTime, LIBRARY_TIMEZONE)}`

  return (
    <Dialog title="Cancel this booking?" onCancel={onCancel}>
      <div className="dialog-body">{`${booking.resource.name} — ${booking.student.name}, ${when}. The slot reopens immediately.`}</div>
      <div className="field">
        <label htmlFor={`${id}-reason`}>Reason (optional)</label>
        <textarea
          id={`${id}-reason`}
          className="input"
          rows={2}
          maxLength={300}
          autoFocus
          placeholder="Shown to the student, e.g. the room is closed for an event"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onConfirm(reason)}>Cancel booking</button>
      </div>
    </Dialog>
  )
}
