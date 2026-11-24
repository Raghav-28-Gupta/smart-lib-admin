'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { StudentWords } from '@/components/attention/StudentWords'
import { useDialogSubmit } from '@/components/useDialogSubmit'
import { reportSummary, type ReportItem, type ReportOutcome } from '@/lib/attention'

// The canvas's reason select. Damaged and Missing pages both send the copy to maintenance; Lost marks it lost.
const REASONS = [
  { value: 'damaged', label: 'Damaged', outcome: 'maintenance' },
  { value: 'missing_pages', label: 'Missing pages', outcome: 'maintenance' },
  { value: 'lost', label: 'Lost', outcome: 'lost' },
] as const satisfies readonly { value: string; label: string; outcome: ReportOutcome }[]

type Reason = (typeof REASONS)[number]['value']

/** The reason the student's category points at; Lost is the librarian's call and is never the starting choice. */
function startingReason(category: string): Reason {
  return category === 'missing_pages' ? 'missing_pages' : 'damaged'
}

/**
 * "Flag this copy for maintenance?": a copy report confirmed. The librarian picks the reason (it starts at the student's
 * category) and may add a note for the student's notice; confirming never charges the student. The student's own note
 * (the card cuts a long one short) is repeated in full when there is one. `onConfirm` is given the
 * outcome the reason means and the note as typed, and resolves true once the copy is flagged and the page closes the dialog;
 * on false it stays open with the reason and note (the page has toasted the server's reason, for example that the copy was
 * lent out again). Confirm is disabled while the write is in flight.
 */
export function ConfirmCopyReportDialog({
  item, onCancel, onConfirm,
}: {
  item: ReportItem
  onCancel: () => void
  onConfirm: (outcome: ReportOutcome, note: string) => Promise<boolean>
}) {
  const [reason, setReason] = useState<Reason>(() => startingReason(item.report.category))
  const [note, setNote] = useState('')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(async (values: { reason: Reason; note: string }) => {
    const outcome = REASONS.find((r) => r.value === values.reason)!.outcome
    return onConfirm(outcome, values.note)
  })

  return (
    <Dialog title="Flag this copy for maintenance?" onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit({ reason, note })
        }}
      >
        <div className="dialog-body">
          {`${reportSummary(item.report)}. It will be removed from what students see as available. Confirming never charges the student.`}
        </div>
        {item.report.note && <StudentWords label="The student's note" words={item.report.note} />}
        <div className="field">
          <label htmlFor={`${id}-reason`}>Reason</label>
          <select id={`${id}-reason`} className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-note`}>Note (optional)</label>
          <textarea
            id={`${id}-note`}
            className="input"
            rows={2}
            maxLength={300}
            placeholder="Added to the notice the student receives"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={submitting}>Confirm &amp; flag copy</button>
        </div>
      </form>
    </Dialog>
  )
}
