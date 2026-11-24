'use client'

import { useId, useState, type ReactNode } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import type { AdminFine } from '@/lib/fines'
import { rupees } from '@/lib/format'

/**
 * The canvas's "Waive or adjust this fine" dialog. The new amount starts at what the fine is now and
 * must end up a whole number of rupees from 0 to just below it; 0 waives the fine. A reason is required.
 * Save is disabled until both hold, and the server checks them again.
 *
 * `onConfirm` may return nothing (the Fines page closes the dialog and sends the write itself, so a refusal is read
 * from its toast and the refetched row) or a promise of whether the write went through (the Needs attention queue). With
 * a promise the dialog stays open until it resolves true: on false it keeps the amount and reason and puts focus back on
 * Save, and Save is off while the write is in flight, so a second click sends nothing.
 *
 * `context` is an optional block shown straight under the body, before the fields. Only the Needs attention queue passes it
 * (the student's own words, which it must not let a librarian settle unread); the Fines page's dialog has none.
 */
export function AdjustFineDialog({
  fine, onCancel, onConfirm, context,
}: {
  fine: AdminFine
  onCancel: () => void
  onConfirm: (amount: number, reason: string) => void | Promise<boolean>
  context?: ReactNode
}) {
  const [amountText, setAmountText] = useState(String(fine.amount))
  const [reason, setReason] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(async (values: { amount: number; reason: string }) => {
    const result = onConfirm(values.amount, values.reason)
    return result instanceof Promise ? result : true
  })

  // Digits only: an empty box, a sign, a fraction or an exponent ("1e1") is not a whole number of rupees.
  const amount = /^\d+$/.test(amountText.trim()) ? Number(amountText.trim()) : NaN
  const valid = amount < fine.amount && reason.trim() !== ''

  return (
    <Dialog title="Waive or adjust this fine" onCancel={onCancel}>
      <div className="dialog-body">
        {`${fine.student.name} — ${fine.item}, currently ${rupees(fine.amount)}. Enter the new amount (₹0 fully waives it) and a reason; this is recorded on the student's fine history.`}
      </div>
      {context}
      <div className="field">
        <label htmlFor={`${id}-amount`}>New amount (₹)</label>
        <input
          id={`${id}-amount`}
          className="input"
          type="number"
          min="0"
          autoFocus
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-reason`}>Reason (required)</label>
        <textarea
          id={`${id}-reason`}
          className="input"
          rows={2}
          maxLength={300}
          placeholder="Why is this fine being waived or adjusted?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button ref={confirmRef} type="button" className="btn btn-primary" disabled={!valid || submitting} onClick={() => void submit({ amount, reason })}>
          Save
        </button>
      </div>
    </Dialog>
  )
}
