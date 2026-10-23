// The console's live connection: GET /admin/events, read as a stream of
// Server-Sent Events. fetch rather than EventSource, because EventSource
// can't send the Authorization header. Events only say what changed and views
// refetch (lib/liveContext.tsx), so a dropped connection loses nothing.
import { apiBaseUrl, endSession, readToken } from './api'

export type LiveTopic = 'requests' | 'metrics'
export type LiveEventType = 'request.created' | 'request.decided' | 'request.expired' | 'request.cancelled' | 'activity'

export interface LiveEvent {
  type: LiveEventType
  topics: LiveTopic[]
  kind?: 'borrow' | 'room'
  summary?: string
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

/** The wait before each reconnect attempt; the last value repeats. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
/** The server sends a heartbeat every 25 s, so this long without a byte means the connection is gone. */
export const DEAD_AFTER_MS = 60_000

/**
 * Splits a text/event-stream into events. Feed it text as it arrives; it calls
 * `onEvent(type, data)` for every complete event. Comments (the heartbeats)
 * and `retry:` hints are ignored.
 */
export function createSseParser(onEvent: (type: string, data: string) => void): (text: string) => void {
  let buffer = ''
  return (text) => {
    buffer += text
    let end = buffer.indexOf('\n\n')
    while (end !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let type = 'message'
      const data: string[] = []
      for (const raw of block.split('\n')) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (line === '' || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') type = value
        else if (field === 'data') data.push(value)
      }
      if (data.length > 0) onEvent(type, data.join('\n'))
      end = buffer.indexOf('\n\n')
    }
  }
}

export interface LiveHandlers {
  onEvent(event: LiveEvent): void
  /** The stream is (re)connected. Anything may have been missed, so views should refetch. */
  onReady(): void
  onStatus(status: LiveStatus): void
}

type Attempt = { controller: AbortController; reader?: ReadableStreamDefaultReader<Uint8Array> }

export function connectLive(handlers: LiveHandlers): { close(): void } {
  let closed = false
  let failures = 0
  let current: Attempt | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let deadTimer: ReturnType<typeof setTimeout> | undefined

  // A view's bug must neither read as a dropped connection nor skip a retry.
  const notify = (call: () => void) => {
    try {
      call()
    } catch (error) {
      console.error(error)
    }
  }

  const stop = () => {
    clearTimeout(deadTimer)
    if (!current) return
    current.controller.abort()
    current.reader?.cancel().catch(() => {})
    current = null
  }

  const retry = (delay: number) => {
    if (closed) return
    notify(() => handlers.onStatus('reconnecting'))
    retryTimer = setTimeout(() => void open(), delay)
  }

  const retryAfterFailure = () => {
    retry(RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)])
    failures += 1
  }

  async function open(): Promise<void> {
    const token = readToken()
    if (closed || !token) return
    const attempt: Attempt = { controller: new AbortController() }
    current = attempt

    let res: Response
    try {
      res = await fetch(`${apiBaseUrl()}/admin/events`, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        signal: attempt.controller.signal,
      })
    } catch {
      if (current === attempt) {
        current = null
        retryAfterFailure()
      }
      return
    }
    if (current !== attempt) return // closed while connecting
    if (res.status === 401 || res.status === 403) {
      closed = true
      current = null
      endSession(res.status === 401 ? 'expired' : 'not-admin')
      return
    }
    if (!res.ok || !res.body) {
      current = null
      retryAfterFailure()
      return
    }

    const reader = res.body.getReader()
    attempt.reader = reader
    const decoder = new TextDecoder()
    let ready = false
    const parse = createSseParser((type, data) => {
      if (type === 'ready') {
        ready = true
        failures = 0
        notify(() => handlers.onStatus('live'))
        notify(() => handlers.onReady())
        return
      }
      let body: Omit<LiveEvent, 'type'>
      try {
        body = JSON.parse(data) as Omit<LiveEvent, 'type'>
      } catch {
        return // Not JSON: nothing a view could act on.
      }
      notify(() => handlers.onEvent({ ...body, type: type as LiveEventType }))
    })
    const armDeadTimer = () => {
      clearTimeout(deadTimer)
      deadTimer = setTimeout(() => {
        if (current !== attempt) return
        stop()
        retryAfterFailure()
      }, DEAD_AFTER_MS)
    }

    armDeadTimer()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        armDeadTimer()
        parse(decoder.decode(value, { stream: true }))
      }
    } catch {
      // Aborted or dropped: handled below.
    }
    if (current !== attempt) return // stopped on purpose: closed, or the dead timer already retried
    stop()
    // The server ends every stream after 15 minutes: reconnect at once. A
    // stream that ended before it was ready counts as a failure.
    if (ready) retry(RECONNECT_DELAYS_MS[0])
    else retryAfterFailure()
  }

  notify(() => handlers.onStatus('connecting'))
  void open()
  return {
    close() {
      closed = true
      clearTimeout(retryTimer)
      stop()
    },
  }
}
