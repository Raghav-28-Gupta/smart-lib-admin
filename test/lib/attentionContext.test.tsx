import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { writeToken } from '@/lib/api'
import type { AttentionQueue } from '@/lib/attention'
import { AttentionProvider, attentionCount, useAttention } from '@/lib/attentionContext'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import { json, mockFetch } from '../helpers'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

const dueAt = new Date(Date.now() - 3 * 86_400_000).toISOString()
const queue = (all: number): AttentionQueue => ({
  items: all === 0 ? [] : [
    {
      id: 'loan-1', kind: 'overdue', student: { id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu' }, waitingSince: dueAt,
      overdue: { loanId: 'loan-1', title: 'Clean Code', dueAt, daysOverdue: 3, amount: 30, lastNotice: null, escalated: false },
    },
  ],
  counts: { all, overdue: all, fine_dispute: 0, report: 0 },
  emailEnabled: false,
})
const ONE = queue(1)

function Probe() {
  const { state, retry } = useAttention()
  if (state.kind === 'loading') return <p>loading</p>
  if (state.kind === 'error') return <button type="button" onClick={retry}>Retry</button>
  return <p>{attentionCount(state)} need attention</p>
}

describe('AttentionProvider', () => {
  it('loads the queue', async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/attention': () => json(200, ONE) })
    render(<AttentionProvider><Probe /></AttentionProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByText('1 need attention')).toBeInTheDocument()
  })

  it('counts 0 while loading and on error, and counts.all once loaded', () => {
    expect(attentionCount({ kind: 'loading' })).toBe(0)
    expect(attentionCount({ kind: 'error' })).toBe(0)
    expect(attentionCount({ kind: 'loaded', data: queue(4) })).toBe(4)
  })

  it('refetches when an attention event arrives', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/attention': () => json(200, ++calls === 1 ? queue(0) : ONE) })
    render(<LiveProvider><AttentionProvider><Probe /></AttentionProvider></LiveProvider>)
    expect(await screen.findByText('0 need attention')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'attention.changed', topics: ['attention'] }))
    expect(await screen.findByText('1 need attention', {}, { timeout: 3_000 })).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('ignores an event on another topic', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({
      'GET /admin/attention': () => {
        calls += 1
        return json(200, ONE)
      },
    })
    render(<LiveProvider><AttentionProvider><Probe /></AttentionProvider></LiveProvider>)
    await screen.findByText('1 need attention')

    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings'] }))
    await new Promise((resolve) => setTimeout(resolve, 1_300))
    expect(calls).toBe(1)
  })

  it('keeps the last queue when a background refresh fails', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/attention': () => (++calls === 1 ? json(200, ONE) : json(500, { error: 'Something went wrong.' })) })
    render(<LiveProvider><AttentionProvider><Probe /></AttentionProvider></LiveProvider>)
    expect(await screen.findByText('1 need attention')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'attention.changed', topics: ['attention'] }))
    await waitFor(() => expect(calls).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('1 need attention')).toBeInTheDocument()
  })

  it('the provider ignores an older reply that arrives late', async () => {
    writeToken('t')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    let olderAnswered = false
    mockFetch({
      'GET /admin/attention': async () => {
        const n = ++calls
        if (n === 2) {
          await gate
          olderAnswered = true
          return json(200, ONE)
        }
        return json(200, n === 1 ? ONE : queue(0))
      },
    })
    function Refresher() {
      const { state, refresh } = useAttention()
      return (
        <>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
          <p>{state.kind === 'loaded' ? `${attentionCount(state)} need attention` : state.kind}</p>
        </>
      )
    }
    render(<AttentionProvider><Refresher /></AttentionProvider>)
    expect(await screen.findByText('1 need attention')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' })) // the older one, held back
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' })) // the newer one: nothing needs attention
    expect(await screen.findByText('0 need attention')).toBeInTheDocument()

    await act(async () => {
      release()
      await waitFor(() => expect(olderAnswered).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(screen.getByText('0 need attention')).toBeInTheDocument()
  })

  it('shows an error when the first load fails, and Retry loads again', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/attention': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, ONE)) })
    render(<AttentionProvider><Probe /></AttentionProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('1 need attention')).toBeInTheDocument()
  })

  it('stays on loading for a 401 or 403: the session guard is already redirecting', async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/attention': () => json(403, { error: 'Admins only' }) })
    render(<AttentionProvider><Probe /></AttentionProvider>)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('useAttention outside a provider says so', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useAttention must be used inside <AttentionProvider>')
    quiet.mockRestore()
  })
})
