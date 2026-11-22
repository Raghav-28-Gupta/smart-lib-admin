'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
 * - It is the *latest* `refresh` that runs, not the one from the render that started the write:
 *   on a page whose list depends on a query (Bookings), the librarian can change the filter or
 *   page while the write is in flight, and refetching the old query would overwrite the new one.
 * - `run` resolves `true` when the action succeeded (after the refresh) and `false` when it failed or
 *   was ignored as a second call. A dialog that should keep what the user typed after a refusal
 *   stays open until it sees `true`; a caller that does not care just ignores the result.
 * - `success` is the toast's text, or a function of what the action returned when the wording depends
 *   on the server's answer (Restore: whether the replacement charge was waived).
 */
export function useWriteAction(refresh: () => Promise<void>) {
  const toast = useToast()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)

  const latestRefresh = useRef(refresh)
  useEffect(() => {
    latestRefresh.current = refresh
  })

  const run = useCallback(
    async <Result>(action: () => Promise<Result>, success: string | ((result: Result) => string)): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setBusy(true)
      let succeeded = false
      try {
        const result = await action()
        succeeded = true
        toast({ message: typeof success === 'function' ? success(result) : success })
      } catch (error) {
        if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          toast({ message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' })
        }
      } finally {
        try {
          await latestRefresh.current()
        } finally {
          inFlight.current = false
          setBusy(false)
        }
      }
      return succeeded
    },
    [toast],
  )

  return { busy, run }
}
