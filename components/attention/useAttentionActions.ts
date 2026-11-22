'use client'

import { useWriteAction } from '@/components/useWriteAction'
import { escalateLoan, remindLoan, type OverdueItem } from '@/lib/attention'

/**
 * The Needs attention page's overdue writes, through the console's shared write action: one at a time, the server's
 * refusal ("A reminder was sent 3 hours ago.", "This loan was already escalated.", "This loan is no longer
 * overdue.") as a toast, and `busy` until the queue has been refetched, so a card cannot be acted on twice.
 * Both resolve true when the write went through, false when it was refused or ignored as a second call.
 */
export function useAttentionActions(refresh: () => Promise<void>) {
  const { busy, run } = useWriteAction(refresh)

  return {
    busy,
    remind: (item: OverdueItem) => run(() => remindLoan(item.overdue.loanId), 'Reminder sent.'),
    /** `note` is the librarian's optional line for the student; blank sends none. */
    escalate: (item: OverdueItem, note: string) => run(() => escalateLoan(item.overdue.loanId, note), 'Escalated.'),
  }
}
