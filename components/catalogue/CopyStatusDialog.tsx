'use client'

import { useId, useState } from 'react'
import type { CopyAction } from '@/components/catalogue/CopyChip'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import type { AdminCopy } from '@/lib/catalogue'
import { rupees } from '@/lib/format'

// The canvas's wording for each confirmation.
const WORDING: Record<CopyAction, { title: string; outcome: string; confirm: string }> = {
  maintenance: { title: 'Mark this copy under maintenance?', outcome: 'is removed from what students see as available.', confirm: 'Confirm' },
  lost: { title: 'Mark this copy as lost?', outcome: 'is removed from what students see as available.', confirm: 'Confirm' },
  restore: { title: 'Return this copy to circulation?', outcome: 'becomes visible to students again.', confirm: 'Restore' },
}

/**
 * The canvas's copy-status confirmation: Maintenance, Lost (a copy on the shelf, or marked borrowed with no
 * open loan) and Restore. Restoring a copy that was lost on loan, whose replacement charge is still owed, also
 * offers a box, ticked, to waive that charge; `onConfirm` is given whether it was ticked (false when there is no box).
 *
 * `onConfirm` resolves true once the change is made and the page closes the dialog; on false it stays open as
 * the librarian left it (the page has toasted the server's reason). Confirm is disabled while the write is in flight.
 */
export function CopyStatusDialog({
  copy, action, onCancel, onConfirm,
}: {
  copy: AdminCopy
  action: CopyAction
  onCancel: () => void
  onConfirm: (waiveReplacementCharge: boolean) => Promise<boolean>
}) {
  const [waive, setWaive] = useState(true)
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onConfirm)
  const wording = WORDING[action]
  const owed = action === 'restore' ? copy.owedReplacement : null

  return (
    <Dialog title={wording.title} onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(owed !== null && waive)
        }}
      >
        <div className="dialog-body">{`${copy.barcode} ${wording.outcome}`}</div>
        {owed && (
          <label htmlFor={`${id}-waive`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input id={`${id}-waive`} type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
            {`Waive ${owed.student.name}'s ${rupees(owed.amount)} replacement charge`}
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" autoFocus disabled={submitting}>{wording.confirm}</button>
        </div>
      </form>
    </Dialog>
  )
}
