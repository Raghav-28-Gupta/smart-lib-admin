'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

export type LoadState<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; data: T }

/**
 * Loads `fetcher`'s data for a page, and again whenever the fetcher changes (give it
 * a stable identity, e.g. with `useCallback` over the query it closes over).
 *
 * - A new fetcher or `retry()` shows the skeleton first; a failure ends in the error state.
 * - `refresh()` is quiet, for a live event or a refetch after a change: the data stays
 *   on screen while it runs and if it fails. It resolves once the state is settled.
 * - Only the newest request may write: an older reply that arrives late is dropped.
 * - A 401 or 403 ended the session; ConsoleGuard is already redirecting, so nothing is written.
 */
export function useLoader<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ kind: 'loading' })
  const latest = useRef(0)

  const load = useCallback(
    async (quiet: boolean) => {
      const mine = ++latest.current
      if (!quiet) setState((current) => (current.kind === 'loading' ? current : { kind: 'loading' }))
      try {
        const data = await fetcher()
        if (mine === latest.current) setState({ kind: 'loaded', data })
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
        // Data already on screen outlives a failed refresh; anything else is an error.
        if (mine === latest.current) setState((current) => (current.kind === 'loaded' ? current : { kind: 'error' }))
      }
    },
    [fetcher],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  const refresh = useCallback(() => load(true), [load])
  const retry = useCallback(() => void load(false), [load])

  return { state, refresh, retry }
}
