import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readToken, SESSION_ENDED_EVENT, writeToken } from '@/lib/api'
import { connectLive, createSseParser, type LiveEvent, type LiveStatus } from '@/lib/live'
import { eventStream, json, mockFetch } from '../helpers'

/** Lets fetch and stream promises run, without moving the fake clock. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

function connect() {
  const events: LiveEvent[] = []
  const statuses: LiveStatus[] = []
  let readies = 0
  const connection = connectLive({
    onEvent: (e) => events.push(e),
    onReady: () => {
      readies += 1
    },
    onStatus: (s) => statuses.push(s),
  })
  return { events, statuses, readies: () => readies, connection }
}

describe('createSseParser', () => {
  it('splits events across chunks, and ignores comments and retry hints', () => {
    const got: Array<[string, string]> = []
    const push = createSseParser((type, data) => got.push([type, data]))
    push('retry: 5000\n\nevent: ready\ndata: {}\n\n: ping\n\nevent: request.cre')
    push('ated\ndata: {"topics":["requests"]}\n')
    expect(got).toEqual([['ready', '{}']])
    push('\n')
    expect(got).toEqual([
      ['ready', '{}'],
      ['request.created', '{"topics":["requests"]}'],
    ])
  })

  it('joins multi-line data', () => {
    const got: string[] = []
    createSseParser((_, data) => got.push(data))('data: a\ndata: b\n\n')
    expect(got).toEqual(['a\nb'])
  })
})

describe('connectLive', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    writeToken('t')
  })
  afterEach(() => vi.useRealTimers())

  it('connects with the token, goes live on ready, and passes events on', async () => {
    const stream = eventStream()
    const fetch = mockFetch({ 'GET /admin/events': () => stream.response })
    const live = connect()
    expect(live.statuses).toEqual(['connecting'])
    await settle()
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')

    stream.send('retry: 5000\n\nevent: ready\ndata: {}\n\n')
    await settle()
    expect(live.readies()).toBe(1)
    expect(live.statuses.at(-1)).toBe('live')

    stream.send('event: request.created\ndata: {"topics":["requests"],"kind":"borrow","summary":"A wants B"}\n\n')
    await settle()
    expect(live.events).toEqual([{ type: 'request.created', topics: ['requests'], kind: 'borrow', summary: 'A wants B' }])
    live.connection.close()
  })

  it('reconnects 1 second after the server ends the stream, and is ready again', async () => {
    const streams = [eventStream(), eventStream()]
    let opened = 0
    mockFetch({ 'GET /admin/events': () => streams[opened++].response })
    const live = connect()
    await settle()
    streams[0].send('event: ready\ndata: {}\n\n')
    await settle()

    streams[0].end()
    await settle()
    expect(live.statuses.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(999)
    expect(opened).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(opened).toBe(2)

    streams[1].send('event: ready\ndata: {}\n\n')
    await settle()
    expect(live.readies()).toBe(2)
    expect(live.statuses.at(-1)).toBe('live')
    live.connection.close()
  })

  it('backs off 1, 2, 5, 10, then 30 seconds while the server is unreachable', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetch)
    const live = connect()
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)

    for (const [delay, calls] of [[1_000, 2], [2_000, 3], [5_000, 4], [10_000, 5], [30_000, 6], [30_000, 7]] as const) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(fetch).toHaveBeenCalledTimes(calls - 1)
      await vi.advanceTimersByTimeAsync(1)
      await settle()
      expect(fetch).toHaveBeenCalledTimes(calls)
    }
    expect(live.statuses.at(-1)).toBe('reconnecting')
    live.connection.close()
  })

  it('treats a minute of silence as a dropped connection, but not a minute of heartbeats', async () => {
    const streams = [eventStream(), eventStream()]
    let opened = 0
    mockFetch({ 'GET /admin/events': () => streams[opened++].response })
    const live = connect()
    await settle()
    streams[0].send('event: ready\ndata: {}\n\n')
    await settle()

    await vi.advanceTimersByTimeAsync(30_000)
    streams[0].send(': ping\n\n')
    await settle()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(live.statuses.at(-1)).toBe('live')
    await vi.advanceTimersByTimeAsync(1)
    expect(live.statuses.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    expect(opened).toBe(2)
    live.connection.close()
  })

  it.each([
    [401, 'expired'],
    [403, 'not-admin'],
  ])('ends the session on a %i, and stops', async (status, reason) => {
    const ended: string[] = []
    const onEnded = (e: Event) => ended.push((e as CustomEvent<string>).detail)
    window.addEventListener(SESSION_ENDED_EVENT, onEnded)
    const fetch = mockFetch({ 'GET /admin/events': () => json(status, { error: 'no' }) })

    connect()
    await settle()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(readToken()).toBeNull()
    expect(ended).toEqual([reason])
    expect(fetch).toHaveBeenCalledOnce()
    window.removeEventListener(SESSION_ENDED_EVENT, onEnded)
  })

  it('stops reconnecting once closed', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetch)
    const live = connect()
    await settle()
    live.connection.close()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('a view that throws neither drops the connection nor opens a second one', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stream = eventStream()
    const fetch = mockFetch({ 'GET /admin/events': () => stream.response })
    const connection = connectLive({
      onEvent: () => {
        throw new Error('view bug')
      },
      onReady: () => {
        throw new Error('view bug')
      },
      onStatus: () => {},
    })
    await settle()
    stream.send('event: ready\ndata: {}\n\nevent: activity\ndata: {"topics":["metrics"]}\n\n')
    await settle()
    await vi.advanceTimersByTimeAsync(5_000)
    await settle()

    expect(fetch).toHaveBeenCalledOnce()
    expect(logged).toHaveBeenCalledTimes(2)
    connection.close()
    logged.mockRestore()
  })
})
