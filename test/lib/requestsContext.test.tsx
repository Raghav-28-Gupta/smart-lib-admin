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

  it('shows an error when the first load fails, and Retry loads again', async () => {
    writeToken('t')
    let calls = 0
    mockFetch({ 'GET /admin/requests': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, ONE)) })
    render(<RequestsProvider><Probe /></RequestsProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()
  })
})
