'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from './api'
import { fetchAttention, type AttentionQueue } from './attention'
import { useLiveRefresh } from './liveContext'

export type AttentionState = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; data: AttentionQueue }

interface AttentionContextValue {
  state: AttentionState
  /** Refetches in the background: the current queue stays on screen meanwhile, and if it fails. */
  refresh(): Promise<void>
  /** From the error state: show loading, then refetch. */
  retry(): void
}

const AttentionContext = createContext<AttentionContextValue | null>(null)

/** The Needs attention queue, shared by the sidebar badge and the Needs attention page. */
export function AttentionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AttentionState>({ kind: 'loading' })

  // Only the newest refresh may write: an older reply that arrives late is dropped.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++latest.current
    try {
      const data = await fetchAttention()
      if (mine === latest.current) setState({ kind: 'loaded', data })
    } catch (error) {
      // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
      if (mine === latest.current) setState((current) => (current.kind === 'loaded' ? current : { kind: 'error' }))
    }
  }, [])

  const retry = useCallback(() => {
    setState({ kind: 'loading' })
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useLiveRefresh(['attention'], () => void refresh())

  const value = useMemo(() => ({ state, refresh, retry }), [state, refresh, retry])
  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>
}

export function useAttention(): AttentionContextValue {
  const value = useContext(AttentionContext)
  if (!value) throw new Error('useAttention must be used inside <AttentionProvider>')
  return value
}

/** How many items need attention: 0 while loading or on error. */
export function attentionCount(state: AttentionState): number {
  return state.kind === 'loaded' ? state.data.counts.all : 0
}
