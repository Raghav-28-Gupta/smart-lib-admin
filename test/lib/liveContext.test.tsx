import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider, RESYNC_EVERY_MS, useLiveRefresh, useLiveStatus } from '@/lib/liveContext'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null, close: vi.fn() }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: live.close }
  },
}))

function Status() {
  return <p>{useLiveStatus()}</p>
}

function Refresher({ onRefresh }: { onRefresh: () => void }) {
  useLiveRefresh(['metrics'], onRefresh)
  return null
}

describe('LiveProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    live.close.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the connection status', () => {
    render(<LiveProvider><Status /></LiveProvider>)
    expect(screen.getByText('connecting')).toBeInTheDocument()
    act(() => live.handlers!.onStatus('live'))
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('refreshes a view one second after the last event on its topic', () => {
    const onRefresh = vi.fn()
    render(<LiveProvider><Refresher onRefresh={onRefresh} /></LiveProvider>)
    act(() => {
      live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] })
      live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] })
    })
    act(() => vi.advanceTimersByTime(999))
    expect(onRefresh).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('ignores events on other topics', () => {
    const onRefresh = vi.fn()
    render(<LiveProvider><Refresher onRefresh={onRefresh} /></LiveProvider>)
    act(() => live.handlers!.onEvent({ type: 'request.created', topics: ['requests'], kind: 'borrow', summary: 'x' }))
    act(() => vi.advanceTimersByTime(5_000))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('refreshes every view on ready and every 5 minutes', () => {
    const onRefresh = vi.fn()
    render(<LiveProvider><Refresher onRefresh={onRefresh} /></LiveProvider>)
    act(() => live.handlers!.onReady())
    act(() => vi.advanceTimersByTime(1_000))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(RESYNC_EVERY_MS))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('closes the connection when the console unmounts', () => {
    const { unmount } = render(<LiveProvider><Status /></LiveProvider>)
    unmount()
    expect(live.close).toHaveBeenCalledOnce()
  })
})
