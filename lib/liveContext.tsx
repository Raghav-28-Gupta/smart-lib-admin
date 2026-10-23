'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { connectLive, type LiveEvent, type LiveStatus, type LiveTopic } from './live'

/** Every view refetches this often regardless: a safety net, and it keeps Render awake. */
export const RESYNC_EVERY_MS = 5 * 60_000
/** A burst of events inside this window causes one refetch. */
export const REFRESH_DEBOUNCE_MS = 1_000

/** A server event, or 'resync': the stream (re)connected, or the safety net fired. */
export type LiveMessage = LiveEvent | { type: 'resync' }
type Listener = (message: LiveMessage) => void

interface LiveContextValue {
  status: LiveStatus
  subscribe(listener: Listener): () => void
}

// Outside a LiveProvider nothing is live: views still load, they just never
// refresh on their own.
const LiveContext = createContext<LiveContextValue>({ status: 'connecting', subscribe: () => () => {} })

/** One live connection for the whole console; views subscribe to it. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const listeners = useRef(new Set<Listener>())

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    const emit = (message: LiveMessage) => {
      for (const listener of [...listeners.current]) listener(message)
    }
    const connection = connectLive({ onEvent: emit, onReady: () => emit({ type: 'resync' }), onStatus: setStatus })
    const timer = setInterval(() => emit({ type: 'resync' }), RESYNC_EVERY_MS)
    return () => {
      connection.close()
      clearInterval(timer)
    }
  }, [])

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe])
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveContext).status
}

/** Calls `listener` with every live message while the component is mounted. */
export function useLiveMessages(listener: Listener): void {
  const { subscribe } = useContext(LiveContext)
  const latest = useRef(listener)
  useEffect(() => {
    latest.current = listener
  })
  useEffect(() => subscribe((message) => latest.current(message)), [subscribe])
}

/** Calls `refresh` once, a second after the last event on one of `topics` or a resync. */
export function useLiveRefresh(topics: LiveTopic[], refresh: () => void): void {
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const topicKey = topics.join(',')
  useLiveMessages((message) => {
    if (message.type !== 'resync' && !message.topics.some((topic) => topicKey.split(',').includes(topic))) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current(), REFRESH_DEBOUNCE_MS)
  })
  useEffect(() => () => clearTimeout(timer.current), [])
}
