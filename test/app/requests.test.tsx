import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import RequestsPage from '@/app/(console)/requests/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { PendingRequest, PendingRequests } from '@/lib/requests'
import { RequestsProvider } from '@/lib/requestsContext'
import { json, mockFetch } from '../helpers'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const BORROW: PendingRequest = {
  id: 'br-1',
  kind: 'borrow',
  student: { id: 'u1', name: 'Aditi Sharma', email: 'aditi.sharma@thapar.edu' },
  requestedAt: minutesAgo(12),
  expiresAt: new Date(Date.now() + 23.5 * 3_600_000).toISOString(),
  book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 2, totalCopies: 4 },
}

const ROOM: PendingRequest = {
  id: 'bk-1',
  kind: 'room',
  student: { id: 'u2', name: 'Rohan Verma', email: 'rohan.verma@thapar.edu' },
  requestedAt: minutesAgo(4),
  expiresAt: '2026-10-22T08:45:00.000Z',
  room: { resourceId: 'r1', name: 'Group Room 201', location: 'Group study rooms', startTime: '2026-10-22T08:30:00.000Z', endTime: '2026-10-22T09:30:00.000Z' },
}

const pending = (...requests: PendingRequest[]): PendingRequests => ({
  requests,
  counts: {
    all: requests.length,
    borrow: requests.filter((r) => r.kind === 'borrow').length,
    room: requests.filter((r) => r.kind === 'room').length,
  },
})

function renderPage() {
  writeToken('t')
  return render(
    <ToastProvider>
      <RequestsProvider>
        <RequestsPage />
      </RequestsProvider>
    </ToastProvider>,
  )
}

describe('Requests page', () => {
  it('shows skeleton cards while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderPage()
    expect(screen.getByLabelText('Loading requests')).toHaveAttribute('aria-busy', 'true')
  })

  it('offers Retry when the requests cannot be loaded', async () => {
    let calls = 0
    mockFetch({ 'GET /admin/requests': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, pending(BORROW))) })
    renderPage()
    expect(await screen.findByText("Couldn't load requests")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Clean Code — Robert C. Martin')).toBeInTheDocument()
  })

  it("says you're all caught up when nothing is waiting", async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending()) })
    renderPage()
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(
      screen.getByText('No requests waiting. New borrow and room requests appear here the moment students send them.'),
    ).toBeInTheDocument()
  })

  it('shows each request with who asked, how long ago, and what for', async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending(BORROW, ROOM)) })
    renderPage()
    expect(await screen.findByText('Borrow request')).toBeInTheDocument()
    expect(screen.getByText('Aditi Sharma')).toBeInTheDocument()
    expect(screen.getByText('waiting 12 min')).toBeInTheDocument()
    expect(screen.getByText('Clean Code — Robert C. Martin')).toBeInTheDocument()
    expect(screen.getByText('2 of 4 copies left · expires in 23 h')).toBeInTheDocument()
    expect(screen.getByText('Room request')).toBeInTheDocument()
    expect(screen.getByText('Group Room 201')).toBeInTheDocument()
    expect(screen.getByText('Thu, Oct 22 · 2–3 PM · slot held until 2:15 PM')).toBeInTheDocument()
  })

  it('filters by kind, and says when a filter has nothing', async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending(BORROW)) })
    renderPage()
    await screen.findByText('Clean Code — Robert C. Martin')
    await userEvent.click(screen.getByRole('button', { name: 'Rooms (0)' }))
    expect(screen.getByText('No room requests waiting.')).toBeInTheDocument()
    expect(screen.queryByText('Clean Code — Robert C. Martin')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'All (1)' }))
    expect(screen.getByText('Clean Code — Robert C. Martin')).toBeInTheDocument()
  })

  it('approves, says so and refreshes the list -- once, however fast the clicks', async () => {
    let lists = 0
    const fetch = mockFetch({
      'GET /admin/requests': () => json(200, ++lists === 1 ? pending(BORROW) : pending()),
      'POST /admin/requests/borrow/br-1/approve': () => json(200, { id: 'br-1', kind: 'borrow', status: 'approved' }),
    })
    renderPage()
    const approve = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    fireEvent.click(approve)
    expect(await screen.findByText("Approved. Aditi Sharma's loan of Clean Code starts now.")).toBeInTheDocument()
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })

  it('declines with an optional reason the student will see', async () => {
    const fetch = mockFetch({
      'GET /admin/requests': () => json(200, pending(ROOM)),
      'POST /admin/requests/room/bk-1/decline': () => json(200, { id: 'bk-1', kind: 'room', status: 'declined' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))
    const dialog = screen.getByRole('dialog', { name: 'Decline this request?' })
    expect(
      within(dialog).getByText('Rohan Verma — Group Room 201 · Thu, Oct 22 · 2–3 PM. The slot goes back to other students.'),
    ).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Reserved for an event')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline request' }))

    expect(await screen.findByText('Declined. Rohan Verma will see it in the app.')).toBeInTheDocument()
    const decline = fetch.mock.calls.find(([input]) => String(input).endsWith('/decline'))!
    expect(decline[1]!.body).toBe('{"reason":"Reserved for an event"}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("a 409 shows the server's message and refreshes the list", async () => {
    let lists = 0
    mockFetch({
      'GET /admin/requests': () => json(200, ++lists === 1 ? pending(BORROW) : pending()),
      'POST /admin/requests/borrow/br-1/approve': () => json(409, { error: 'Already approved by Librarian One.' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Already approved by Librarian One.')).toBeInTheDocument()
    await waitFor(() => expect(lists).toBe(2))
  })
})
