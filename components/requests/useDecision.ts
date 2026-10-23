'use client'

import { useCallback, useRef, useState } from 'react'
import { useToast } from '@/components/Toasts'
import { ApiError } from '@/lib/api'
import { approveRequest, declineRequest, type PendingRequest } from '@/lib/requests'
import { useRequests } from '@/lib/requestsContext'
import { approvedToast, declinedToast } from './requestText'

/**
 * Approve and decline for one request. A second click while a decision is in
 * flight sends nothing. Either way the queue is refetched afterwards, so a
 * request someone else settled disappears, with the server's 409 as a toast.
 */
export function useDecision(request: PendingRequest) {
  const toast = useToast()
  const { refresh } = useRequests()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      try {
        await action()
        toast({ message: success })
      } catch (error) {
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
        if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          toast({ message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' })
        }
      } finally {
        inFlight.current = false
        setBusy(false)
        void refresh()
      }
    },
    [toast, refresh],
  )

  return {
    busy,
    approve: () => run(() => approveRequest(request), approvedToast(request)),
    decline: (reason: string) => run(() => declineRequest(request, reason), declinedToast(request)),
  }
}
