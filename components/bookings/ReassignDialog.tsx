'use client'

import { useEffect, useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { ApiError } from '@/lib/api'
import { fetchReassignOptions, type AdminBooking, type ReassignOption } from '@/lib/bookings'

type Options = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'loaded'; options: ReassignOption[] }

const optionLabel = (o: ReassignOption) => (o.location ? `${o.name} · ${o.location}` : o.name)

/**
 * The canvas's "Reassign booking" dialog. The server says which resources are free at the
 * booking's time, so the options are loaded when it opens; it confirms only with a choice.
 */
export function ReassignDialog({
  booking, onCancel, onConfirm,
}: {
  booking: AdminBooking
  onCancel: () => void
  onConfirm: (target: ReassignOption) => void
}) {
  const [options, setOptions] = useState<Options>({ kind: 'loading' })
  const [targetId, setTargetId] = useState('')
  const id = useId()

  useEffect(() => {
    let current = true
    fetchReassignOptions(booking.id).then(
      (list) => {
        if (current) setOptions({ kind: 'loaded', options: list })
      },
      (error: unknown) => {
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
        if (!current || (error instanceof ApiError && (error.status === 401 || error.status === 403))) return
        setOptions({
          kind: 'error',
          message: error instanceof ApiError ? error.message : "Couldn't load the free resources. Try again.",
        })
      },
    )
    return () => {
      current = false
    }
  }, [booking.id])

  const choices = options.kind === 'loaded' ? options.options : []
  const target = choices.find((o) => o.id === targetId)

  return (
    <Dialog title="Reassign booking" onCancel={onCancel}>
      <div className="dialog-body">{`Move ${booking.student.name}'s booking from ${booking.resource.name} to a different resource.`}</div>
      {choices.length > 0 ? (
        <div className="field">
          <label htmlFor={`${id}-target`}>Move to</label>
          {/* Mounting takes focus from Cancel, which holds it while the options load. */}
          <select id={`${id}-target`} className="input" autoFocus value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a resource…</option>
            {choices.map((o) => (
              <option key={o.id} value={o.id}>{optionLabel(o)}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="text-muted" style={{ fontSize: 13 }} role={options.kind === 'error' ? 'alert' : 'status'}>
          {options.kind === 'loading'
            ? 'Loading free resources…'
            : options.kind === 'error'
              ? options.message
              : 'No other resource is free at this time'}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" autoFocus onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!target} onClick={() => target && onConfirm(target)}>
          Reassign
        </button>
      </div>
    </Dialog>
  )
}
