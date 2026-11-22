'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import { MAX_ADJUSTMENT, MIN_ADJUSTMENT } from '@/lib/students'

/** "+3", "−3" (a true minus sign, as the spec writes it) and "0". */
function deltaLabel(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0'
}

/**
 * The canvas's "Adjust reliability score" dialog: a −10 to +10 slider that starts at 0 and a required reason the
 * student will see. Apply is disabled at 0 and while the reason is blank, and while the write is in flight; the server
 * checks again. `onConfirm` resolves true once the score is adjusted and the page closes the dialog; on false it stays
 * open with the slider and the reason (the page has toasted the server's reason, e.g. "The score is already at 100.").
 */
export function AdjustReliabilityDialog({
  currentScore, onCancel, onConfirm,
}: {
  currentScore: number
  onCancel: () => void
  onConfirm: (delta: number, reason: string) => Promise<boolean>
}) {
  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit((values: { delta: number; reason: string }) => onConfirm(values.delta, values.reason))
  const valid = delta !== 0 && reason.trim() !== ''

  return (
    <Dialog title="Adjust reliability score" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit({ delta, reason })
        }}
      >
        <div className="dialog-body">{`Current score: ${currentScore}. This change is logged with your reason and shown to the student.`}</div>
        <div className="field">
          <label htmlFor={`${id}-delta`}>{`Adjustment: ${deltaLabel(delta)}`}</label>
          <input
            id={`${id}-delta`}
            className="input"
            type="range"
            min={MIN_ADJUSTMENT}
            max={MAX_ADJUSTMENT}
            step={1}
            autoFocus
            aria-valuetext={deltaLabel(delta)}
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-reason`}>Reason (required)</label>
          <textarea
            id={`${id}-reason`}
            className="input"
            rows={2}
            maxLength={300}
            placeholder="Why override the automatic score?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={!valid || submitting}>Apply adjustment</button>
        </div>
      </form>
    </Dialog>
  )
}
