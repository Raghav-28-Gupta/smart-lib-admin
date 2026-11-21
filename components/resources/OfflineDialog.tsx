'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import type { AdminResource } from '@/lib/resources'

/** What happens to the bookings a resource already has when it goes offline: nothing. */
function staysLine(upcoming: number): string {
  if (upcoming === 0) return 'It has no upcoming bookings.'
  return upcoming === 1 ? '1 upcoming booking stays as it is.' : `${upcoming} upcoming bookings stay as they are.`
}

/** The canvas's "Take this resource offline?" dialog, with an optional note the table shows on the row. */
export function OfflineDialog({
  resource, onCancel, onConfirm,
}: {
  resource: AdminResource
  onCancel: () => void
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const id = useId()

  return (
    <Dialog title="Take this resource offline?" onCancel={onCancel}>
      <div className="dialog-body">
        {`${resource.name} will be hidden from the student booking calendar until brought back online. ${staysLine(resource.upcomingBookings)}`}
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>Note (optional)</label>
        <textarea
          id={`${id}-note`}
          className="input"
          rows={2}
          maxLength={300}
          autoFocus
          placeholder="e.g. projector bulb replacement"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onConfirm(note)}>Take offline</button>
      </div>
    </Dialog>
  )
}
