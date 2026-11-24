'use client'

import { useWriteAction } from '@/components/useWriteAction'
import { adjustFine, markFinePaid, type AdminFine } from '@/lib/fines'

/**
 * The Fines page's writes, through the console's shared write action: one at a time, the
 * server's refusal ("This fine is already paid.", "This fine was waived.", "This fine was just changed
 * to ₹X. ...") as a toast, and `busy` until the list has been refetched, so a row cannot be acted on twice.
 * Mark paid sends the amount the dialog showed, so a payment never lands on a fine lowered meanwhile; adjust sends
 * the id of the dispute the row showed (none when it showed none), so a dispute is never closed unread.
 */
export function useFineActions(refresh: () => Promise<void>) {
  const { busy, run } = useWriteAction(refresh)

  return {
    busy,
    markPaid: (fine: AdminFine) => run(() => markFinePaid(fine.id, fine.amount), 'Fine marked as paid.'),
    /** An amount of 0 waives the fine; anything else adjusts it. An open dispute on it is closed by the same call. */
    adjust: (fine: AdminFine, amount: number, reason: string) =>
      run(() => adjustFine(fine.id, amount, reason, fine.dispute?.id), amount === 0 ? 'Fine waived.' : 'Fine adjusted.'),
  }
}
