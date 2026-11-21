'use client'

import { Dialog } from '@/components/Dialog'
import type { AdminFine } from '@/lib/fines'
import { rupees } from '@/lib/format'

/** "Mark this fine as paid?": the librarian records a payment the student made at the desk. */
export function MarkPaidDialog({
  fine, onCancel, onConfirm,
}: {
  fine: AdminFine
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog title="Mark this fine as paid?" onCancel={onCancel}>
      <div className="dialog-body">
        {`${fine.student.name} — ${fine.item}, ${rupees(fine.amount)}. Record this once the student has paid at the desk.`}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" autoFocus onClick={onConfirm}>Mark paid</button>
      </div>
    </Dialog>
  )
}
