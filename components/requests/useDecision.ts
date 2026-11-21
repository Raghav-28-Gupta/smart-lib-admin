'use client'

import { useWriteAction } from '@/components/useWriteAction'
import { approveRequest, declineRequest, type PendingRequest } from '@/lib/requests'
import { useRequests } from '@/lib/requestsContext'
import { approvedToast, declinedToast } from './requestText'

/**
 * Approve and decline for one request, through the console's shared write action: a second
 * click while a decision is in flight sends nothing, and either way the queue is refetched
 * afterwards, so a request someone else settled disappears, with the server's 409 as a toast.
 */
export function useDecision(request: PendingRequest) {
  const { refresh } = useRequests()
  const { busy, run } = useWriteAction(refresh)

  return {
    busy,
    approve: () => run(() => approveRequest(request), approvedToast(request)),
    decline: (reason: string) => run(() => declineRequest(request, reason), declinedToast(request)),
  }
}
