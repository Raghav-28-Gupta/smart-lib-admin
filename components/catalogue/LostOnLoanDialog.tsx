'use client'

import { useId, useState } from 'react'
import { useDialogSubmit } from '@/components/catalogue/useDialogSubmit'
import { Dialog } from '@/components/Dialog'
import { MAX_REPLACEMENT_CHARGE, MIN_REPLACEMENT_CHARGE, parseReplacementCharge } from '@/lib/catalogue'
import { LIBRARY_TIMEZONE, shortDay } from '@/lib/format'

/**
 * "Mark this copy as lost?" for a copy a student has on loan: says whose loan closes and asks for the replacement
 * charge, whole rupees from 0 (none) to 10,000, which starts blank. Confirm is disabled until it is a valid amount;
 * the server checks again. `onConfirm` is given the charge and resolves true once the copy is marked and the page
 * closes the dialog; on false it stays open with the charge (the page has toasted the server's reason).
 * `student` is the borrower and `dueAt` the loan's due time (ISO, UTC), shown as a day in the library's time zone.
 * A copy marked borrowed with no open loan has no borrower to charge and uses CopyStatusDialog instead.
 */
export function LostOnLoanDialog({
  student, dueAt, onCancel, onConfirm,
}: {
  student: string
  dueAt: string | null
  onCancel: () => void
  onConfirm: (replacementCharge: number) => Promise<boolean>
}) {
  const [chargeText, setChargeText] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onConfirm)
  const charge = parseReplacementCharge(chargeText)
  const due = dueAt ? `, due ${shortDay(dueAt, LIBRARY_TIMEZONE)}` : ''

  return (
    <Dialog title="Mark this copy as lost?" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (charge !== null) void submit(charge)
        }}
      >
        <div className="dialog-body">
          {`${student} has this copy${due}. Their loan closes, any overdue fine so far is charged, and the replacement charge becomes a Lost book fine they can see.`}
        </div>
        <div className="field">
          <label htmlFor={`${id}-charge`}>Replacement charge (₹)</label>
          <input
            id={`${id}-charge`}
            className="input"
            type="number"
            min={MIN_REPLACEMENT_CHARGE}
            max={MAX_REPLACEMENT_CHARGE}
            step={1}
            autoFocus
            aria-invalid={chargeText.trim() !== '' && charge === null}
            value={chargeText}
            onChange={(e) => setChargeText(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={charge === null || submitting}>Mark as lost</button>
        </div>
      </form>
    </Dialog>
  )
}
