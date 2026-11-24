'use client'

import { useWriteAction } from '@/components/useWriteAction'
import {
  confirmReport, dismissReport, escalateLoan, remindLoan, upholdDispute,
  type FineDisputeItem, type OverdueItem, type ReportItem, type ReportOutcome,
} from '@/lib/attention'
import { adjustFine } from '@/lib/fines'

/**
 * The Needs attention page's writes, through the console's shared write action: one at a time, the server's
 * refusal ("A reminder was sent 3 hours ago.", "This loan was already escalated.", "This dispute was already
 * resolved.", "This copy is now on loan.") as a toast, and `busy` until the queue has been refetched, so a card cannot be
 * acted on twice.
 * Every write resolves true when it went through, false when it was refused or ignored as a second call.
 */
export function useAttentionActions(refresh: () => Promise<void>) {
  const { busy, run } = useWriteAction(refresh)

  return {
    busy,
    remind: (item: OverdueItem) => run(() => remindLoan(item.overdue.loanId), 'Reminder sent.'),
    /** `note` is the librarian's optional line for the student; blank sends none. */
    escalate: (item: OverdueItem, note: string) => run(() => escalateLoan(item.overdue.loanId, note), 'Escalated.'),
    /** Closes the dispute with the fine standing; `note` is optional and goes in the student's notice. */
    uphold: (item: FineDisputeItem, note: string) => run(() => upholdDispute(item.dispute.disputeId, note), 'Fine upheld.'),
    /** An amount of 0 waives the fine; anything else adjusts it. The call names the dispute, which the server closes with it. */
    adjust: (item: FineDisputeItem, amount: number, reason: string) =>
      run(
        () => adjustFine(item.dispute.fine.id, amount, reason, item.dispute.disputeId),
        amount === 0 ? 'Fine waived.' : 'Fine adjusted.',
      ),
    /** A copy report: the copy goes to maintenance or is marked lost, never charging the student. `note` is optional. */
    confirmCopy: (item: ReportItem, outcome: ReportOutcome, note: string) =>
      run(() => confirmReport(item.id, { outcome, note }), 'Copy flagged.'),
    /** A resource report: no outcome, which the server reads as "take the resource offline" and closes the report with. */
    takeResourceOffline: (item: ReportItem, note: string) =>
      run(() => confirmReport(item.id, { note }), 'Resource taken offline.'),
    /** Closes a report with no action; `note` is optional and goes in the student's notice. */
    dismiss: (item: ReportItem, note: string) => run(() => dismissReport(item.id, note), 'Report dismissed.'),
  }
}
