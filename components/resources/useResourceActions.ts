'use client'

import { useWriteAction } from '@/components/useWriteAction'
import {
  bringResourceOnline, createResource, takeResourceOffline, updateResource, type AdminResource,
} from '@/lib/resources'

/**
 * The Resources page's writes, through the console's shared write action: one at a time, the
 * server's 409 as a toast, and `busy` until the list has been refetched.
 */
export function useResourceActions(refresh: () => Promise<void>) {
  const { busy, run } = useWriteAction(refresh)

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
