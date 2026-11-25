'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from './api'
import { useLiveRefresh } from './liveContext'
import { fetchPendingRequests, type PendingRequests, type RequestOrder } from './requests'

export type RequestsState = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; data: PendingRequests }

interface RequestsContextValue {
  state: RequestsState
  /** How the list is ordered. Only the Requests page changes it, and only while it is open. */
  order: RequestOrder
  /**
   * Orders the list and refetches it in the background: the rows stay on screen meanwhile, so the counts the
   * sidebar badge and the tab title read never drop to zero. The order does not change what is counted.
   */
  setOrder(order: RequestOrder): void
  /** Refetches in the background: the current list stays on screen meanwhile, and if it fails. */
  refresh(): Promise<void>
  /** From the error state: show loading, then refetch. */
  retry(): void
}

const RequestsContext = createContext<RequestsContextValue | null>(null)

/** The pending requests, shared by the sidebar badge, the tab title, the Dashboard panel and the Requests page. */
export function RequestsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RequestsState>({ kind: 'loading' })
  const [order, setOrder] = useState<RequestOrder>('suggested')

  // Only the newest refresh may write: an older reply that arrives late is dropped.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++latest.current
    try {
      const data = await fetchPendingRequests(order)
      if (mine === latest.current) setState({ kind: 'loaded', data })
    } catch (error) {
      // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
      if (mine === latest.current) setState((current) => (current.kind === 'loaded' ? current : { kind: 'error' }))
    }
  }, [order])

  const retry = useCallback(() => {
    setState({ kind: 'loading' })
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useLiveRefresh(['requests'], () => void refresh())

  const value = useMemo(() => ({ state, order, setOrder, refresh, retry }), [state, order, refresh, retry])
  return <RequestsContext.Provider value={value}>{children}</RequestsContext.Provider>
}

export function useRequests(): RequestsContextValue {
  const value = useContext(RequestsContext)
  if (!value) throw new Error('useRequests must be used inside <RequestsProvider>')
  return value
}

/** How many requests are waiting: 0 while loading or on error. */
export function waitingCount(state: RequestsState): number {
  return state.kind === 'loaded' ? state.data.counts.all : 0
}
