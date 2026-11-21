'use client'

import { useCallback, useRef, useState } from 'react'
import { useToast } from '@/components/Toasts'
import { ApiError } from '@/lib/api'

/**
 * The console's shared write action: Approve and Decline, the Resources writes, and
 * Cancel and Reassign all go through `run`.
 *
 * - A second `run` while one is in flight sends nothing. The guard is a ref, because two
 *   clicks can arrive before React re-renders and `busy` would still be false for the second.
 * - Success toasts `success`; a failure toasts the server's own message (a 409 says why).
 *   A 401 or 403 ended the session and ConsoleGuard is already redirecting, so it toasts nothing.
 * - Either way `refresh` runs afterwards, so a change someone else made shows up, and `busy`
 *   stays true until it has returned: the changed row is still the old one until then, and
 *   acting on it again would only get a 409.
 */
export function useWriteAction(refresh: () => Promise<void>) {
  const toast = useToast()
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
        if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          toast({ message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' })
        }
      } finally {
        await refresh()
        inFlight.current = false
        setBusy(false)
      }
    },
    [toast, refresh],
  )

  return { busy, run }
}
