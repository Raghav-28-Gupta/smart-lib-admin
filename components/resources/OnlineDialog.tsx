'use client'

import { Dialog } from '@/components/Dialog'
import type { AdminResource } from '@/lib/resources'

/** The canvas's "Bring this resource back online?" dialog: nothing to fill in, so the primary button takes focus. */
export function OnlineDialog({
  resource, onCancel, onConfirm,
}: {
  resource: AdminResource
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog title="Bring this resource back online?" onCancel={onCancel}>
      <div className="dialog-body">{`${resource.name} will reappear on the student booking calendar.`}</div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" autoFocus onClick={onConfirm}>Bring online</button>
      </div>
    </Dialog>
  )
}
