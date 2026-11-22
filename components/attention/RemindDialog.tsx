'use client'

import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import type { OverdueItem } from '@/lib/attention'

/**
 * "Send an overdue reminder?": says whether an email goes with the notice in the app (`emailEnabled`, from the queue).
 * `onConfirm` resolves true once the reminder is sent and the page closes the dialog; on false it stays open (the page
 * has toasted the server's reason, for example that a reminder went out a few hours ago). Confirm is disabled while
 * the write is in flight.
 */
export function RemindDialog({
  item, emailEnabled, onCancel, onConfirm,
}: {
  item: OverdueItem
  emailEnabled: boolean
  onCancel: () => void
  onConfirm: () => Promise<boolean>
}) {
  const { submitting, submit, confirmRef } = useDialogSubmit<void>(onConfirm)
  const { name } = item.student
  const { title } = item.overdue

  return (
    <Dialog title="Send an overdue reminder?" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="dialog-body">
          {emailEnabled
            ? `${name} gets a notice in the app and an email about ${title}.`
            : `${name} gets a notice in the app about ${title}. Email isn't set up.`}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" autoFocus disabled={submitting}>Send reminder</button>
        </div>
      </form>
    </Dialog>
  )
}
