'use client'

import { useCallback, useRef, useState } from 'react'
import { useToast } from '@/components/Toasts'
import { ApiError } from '@/lib/api'
import {
  bringResourceOnline, createResource, takeResourceOffline, updateResource, type AdminResource,
} from '@/lib/resources'

/**
 * The Resources page's writes. A second one while another is in flight sends
 * nothing, and `busy` stays true until the list has been refetched: the changed
 * row is still the old one until then, and acting on it would only get a 409.
 * Either way the list is refetched afterwards, so a change someone else made
 * shows up, with the server's 409 as a toast.
 */
export function useResourceActions(refresh: () => Promise<void>) {
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
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
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

  return {
    busy,
    create: (input: Parameters<typeof createResource>[0]) =>
      run(() => createResource(input), `Added ${input.name.trim()}.`),
    update: (resource: AdminResource, input: Parameters<typeof updateResource>[1]) =>
      run(() => updateResource(resource.id, input), `Saved changes to ${input.name.trim()}.`),
    takeOffline: (resource: AdminResource, note: string) =>
      run(() => takeResourceOffline(resource.id, note), `${resource.name} is now offline.`),
    bringOnline: (resource: AdminResource) =>
      run(() => bringResourceOnline(resource.id), `${resource.name} is back online.`),
  }
}
