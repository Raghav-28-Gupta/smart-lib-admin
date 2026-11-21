'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import type { AdminFine } from '@/lib/fines'
import { rupees } from '@/lib/format'

/**
 * The canvas's "Waive or adjust this fine" dialog. The new amount starts at what the fine is now and
 * must end up a whole number of rupees from 0 to just below it; 0 waives the fine. A reason is required.
 * Save is disabled until both hold, and the server checks them again.
 */
export function AdjustFineDialog({
  fine, onCancel, onConfirm,
}: {
  fine: AdminFine
  onCancel: () => void
  onConfirm: (amount: number, reason: string) => void
}) {
  const [amountText, setAmountText] = useState(String(fine.amount))
  const [reason, setReason] = useState('')
  const id = useId()

  // Digits only: an empty box, a sign, a fraction or an exponent ("1e1") is not a whole number of rupees.
  const amount = /^\d+$/.test(amountText.trim()) ? Number(amountText.trim()) : NaN
  const valid = amount < fine.amount && reason.trim() !== ''

  return (
    <Dialog title="Waive or adjust this fine" onCancel={onCancel}>
      <div className="dialog-body">
        {`${fine.student.name} — ${fine.item}, currently ${rupees(fine.amount)}. Enter the new amount (₹0 fully waives it) and a reason; this is recorded on the student's fine history.`}
      </div>
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
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => onConfirm(amount, reason)}>Save</button>
      </div>
    </Dialog>
  )
}
