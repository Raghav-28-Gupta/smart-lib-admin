'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import { MAX_COPIES, MIN_COPIES, parseCopies, type AdminBook } from '@/lib/catalogue'

/**
 * The "+ Copies" dialog: how many more copies of `book` to add, 1 to 20. They start out available.
 * `onConfirm` resolves true once they are added and the page closes the dialog; on false it stays open
 * with the count (the page has toasted the server's reason). Confirm is disabled while the write is in flight.
 */
export function AddCopiesDialog({
  book, onCancel, onConfirm,
}: {
  book: AdminBook
  onCancel: () => void
  onConfirm: (count: number) => Promise<boolean>
}) {
  const [copies, setCopies] = useState('1')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onConfirm)
  const count = parseCopies(copies)

  return (
    <Dialog title={`Add copies of ${book.title}`} onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (count !== null) void submit(count)
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-copies`}>Copies</label>
          <input
            id={`${id}-copies`}
            className="input"
            type="number"
            min={MIN_COPIES}
            max={MAX_COPIES}
            step={1}
            autoFocus
            aria-invalid={count === null}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={count === null || submitting}>Add copies</button>
        </div>
      </form>
    </Dialog>
  )
}
