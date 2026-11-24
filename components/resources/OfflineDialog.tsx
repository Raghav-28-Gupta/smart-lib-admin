'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import type { AdminResource } from '@/lib/resources'

/** What happens to the bookings a resource already has when it goes offline: nothing. */
function staysLine(upcoming: number): string {
  if (upcoming === 0) return 'It has no upcoming bookings.'
  return upcoming === 1 ? '1 upcoming booking stays as it is.' : `${upcoming} upcoming bookings stay as they are.`
}

/**
 * The canvas's "Take this resource offline?" dialog, with an optional note the table shows on the row.
 *
 * `resource` needs a name; the count of upcoming bookings is optional, and the bookings sentence is left out without it (the
 * Needs attention queue names a reported resource but does not count its bookings). `initialNote` starts the note box
 * with text the librarian can edit (the Needs attention queue starts it with the student's report).
 *
 * `onConfirm` may return nothing (the Resources page closes the dialog and sends the write itself) or a promise of whether
 * the write went through (the Needs attention queue). With a promise the dialog stays open until it resolves true: on false
 * it keeps the note and puts focus back on Take offline, and that button is off while the write is in flight, so a second
 * click sends nothing.
 */
export function OfflineDialog({
  resource, initialNote = '', onCancel, onConfirm,
}: {
  resource: Pick<AdminResource, 'name'> & Partial<Pick<AdminResource, 'upcomingBookings'>>
  initialNote?: string
  onCancel: () => void
  onConfirm: (note: string) => void | Promise<boolean>
}) {
  const [note, setNote] = useState(initialNote)
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(async (value: string) => {
    const result = onConfirm(value)
    return result instanceof Promise ? result : true
  })
  const hidden = `${resource.name} will be hidden from the student booking calendar until brought back online.`

  return (
    <Dialog title="Take this resource offline?" onCancel={onCancel}>
      <div className="dialog-body">
        {resource.upcomingBookings === undefined ? hidden : `${hidden} ${staysLine(resource.upcomingBookings)}`}
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
        <button ref={confirmRef} type="button" className="btn btn-primary" disabled={submitting} onClick={() => void submit(note)}>
          Take offline
        </button>
      </div>
    </Dialog>
  )
}
