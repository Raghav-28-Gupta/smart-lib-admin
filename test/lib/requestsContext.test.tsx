import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { writeToken } from '@/lib/api'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { PendingRequests } from '@/lib/requests'
import { RequestsProvider, useRequests, waitingCount } from '@/lib/requestsContext'
import { json, mockFetch } from '../helpers'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

const ONE: PendingRequests = {
  requests: [
    {
      id: 'br-1',
      kind: 'borrow',
      student: { id: 'u1', name: 'Aditi Sharma', email: 'aditi.sharma@thapar.edu' },
      requestedAt: '2026-10-22T08:00:00.000Z',
      expiresAt: '2026-10-23T08:00:00.000Z',
      book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 1, totalCopies: 4 },
    },
  ],
  counts: { all: 1, borrow: 1, room: 0 },
}

// What the server answers for `order=request`: a different count, so the test can tell that this reply is the one on screen.
const TWO: PendingRequests = {
  requests: [ONE.requests[0], { ...ONE.requests[0], id: 'br-2', requestedAt: '2026-10-22T09:00:00.000Z' }],
  counts: { all: 2, borrow: 2, room: 0 },
}

function Probe() {
  const { state, retry } = useRequests()
  if (state.kind === 'loading') return <p>loading</p>
  if (state.kind === 'error') return <button type="button" onClick={retry}>Retry</button>
  return <p>{waitingCount(state)} waiting</p>
}

describe('RequestsProvider', () => {
  it('loads the pending requests', async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/requests': () => json(200, ONE) })
    render(<RequestsProvider><Probe /></RequestsProvider>)
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()
  })

  it('refetches in the order it is told, with the list and the count on screen meanwhile', async () => {
    writeToken('t')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = mockFetch({
      'GET /admin/requests': async () => {
        if (new URL(String(fetch.mock.calls.at(-1)![0])).searchParams.get('order') !== 'request') return json(200, ONE)
        await gate
        return json(200, TWO)
      },
    })
    function Orderer() {
      const { state, order, setOrder } = useRequests()
      return (
        <>
          <button type="button" onClick={() => setOrder('request')}>By time</button>
          <p>{state.kind === 'loaded' ? `${waitingCount(state)} waiting` : state.kind} · {order}</p>
        </>
      )
    }
    render(<RequestsProvider><Orderer /></RequestsProvider>)
    expect(await screen.findByText('1 waiting · suggested')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'By time' }))
    // The request for the new order is still out: the count stays, and nothing went back to loading.
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('order')).toBe('request')
    expect(screen.getByText('1 waiting · request')).toBeInTheDocument()
    release()
    // The reply for the new order lands: its count (2, not the 1 on screen before) is what proves it was applied.
    expect(await screen.findByText('2 waiting · request')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps the last list when a background refresh fails', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/requests': () => (++calls === 1 ? json(200, ONE) : json(500, { error: 'Something went wrong.' })) })
    render(<LiveProvider><RequestsProvider><Probe /></RequestsProvider></LiveProvider>)
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'request.cancelled', topics: ['requests'], kind: 'borrow' }))
    await waitFor(() => expect(calls).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('1 waiting')).toBeInTheDocument()
  })

  it('keeps the newest list when an older refresh answers last', async () => {
    writeToken('t')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    let olderAnswered = false
    mockFetch({
      'GET /admin/requests': async () => {
        const n = ++calls
        if (n === 2) {
          await gate
          olderAnswered = true
          return json(200, ONE)
        }
        return json(200, n === 1 ? ONE : { requests: [], counts: { all: 0, borrow: 0, room: 0 } })
      },
    })
    function Refresher() {
      const { state, refresh } = useRequests()
      return (
        <>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
          <p>{state.kind === 'loaded' ? `${waitingCount(state)} waiting` : state.kind}</p>
        </>
      )
    }
    render(<RequestsProvider><Refresher /></RequestsProvider>)
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' })) // the older one, held back
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' })) // the newer one: nothing waiting
    expect(await screen.findByText('0 waiting')).toBeInTheDocument()

    await act(async () => {
      release()
      await waitFor(() => expect(olderAnswered).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(screen.getByText('0 waiting')).toBeInTheDocument()
  })

  it('shows an error when the first load fails, and Retry loads again', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/requests': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, ONE)) })
    render(<RequestsProvider><Probe /></RequestsProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()
  })
})
