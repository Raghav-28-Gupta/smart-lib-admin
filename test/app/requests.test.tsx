import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import RequestsPage from '@/app/(console)/requests/page'
import { RequestToasts } from '@/components/RequestToasts'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { PendingRequest, PendingRequests, RoomPriority } from '@/lib/requests'
import { RequestsProvider, useRequests } from '@/lib/requestsContext'
import { json, mockFetch } from '../helpers'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
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

/** A room request, `minutes` old, with the priority the server scored it with (none when it never was). */
const roomRequest = (id: string, name: string, minutes: number, priority?: RoomPriority): PendingRequest => ({
  ...ROOM,
  id,
  requestedAt: minutesAgo(minutes),
  room: { ...ROOM.room!, name, ...(priority ? { priority } : {}) },
})

const SUGGESTED_NOTE = /^Suggested order:/

function renderPage(beside?: ReactNode) {
  writeToken('t')
  return render(
    <ToastProvider>
      <RequestsProvider>
        {beside}
        <RequestsPage />
      </RequestsProvider>
    </ToastProvider>,
  )
}

/** GET /admin/requests answered per query, with every request's query string kept for the test to read. */
function requestsApi(answer: (query: URLSearchParams) => Response | Promise<Response>) {
  let fetch!: ReturnType<typeof mockFetch>
  const queryOf = (index: number) => new URL(String(fetch.mock.calls[index][0])).searchParams
  fetch = mockFetch({ 'GET /admin/requests': () => answer(queryOf(fetch.mock.calls.length - 1)) })
  return Object.assign(fetch, { queries: () => fetch.mock.calls.map((_, index) => queryOf(index)) })
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
    // Each name links to that student's page, opened from Requests.
    expect(screen.getByRole('link', { name: 'Aditi Sharma' })).toHaveAttribute('href', '/students/u1?from=requests')
    expect(screen.getByRole('link', { name: 'Rohan Verma' })).toHaveAttribute('href', '/students/u2?from=requests')
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

  it('keeps Approve and Decline disabled until the list has refreshed, so a second click sends nothing', async () => {
    let lists = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = mockFetch({
      'GET /admin/requests': async () => {
        if (++lists === 1) return json(200, pending(BORROW))
        await gate
        return json(200, pending())
      },
      'POST /admin/requests/borrow/br-1/approve': () => json(200, { id: 'br-1', kind: 'borrow', status: 'approved' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText("Approved. Aditi Sharma's loan of Clean Code starts now.")).toBeInTheDocument()

    // The refetch is still pending, so the card is still on screen -- but it cannot be approved again.
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()

    release()
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })

  it('Escape cancels the decline dialog and puts focus back on Decline', async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending(ROOM)) })
    renderPage()
    const decline = await screen.findByRole('button', { name: 'Decline' })
    await userEvent.click(decline)
    expect(screen.getByRole('dialog', { name: 'Decline this request?' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(decline).toHaveFocus()
  })

  it('Cancel also puts focus back on Decline', async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending(ROOM)) })
    renderPage()
    const decline = await screen.findByRole('button', { name: 'Decline' })
    await userEvent.click(decline)

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(decline).toHaveFocus()
  })

  it('keeps Tab and Shift+Tab inside the decline dialog', async () => {
    mockFetch({ 'GET /admin/requests': () => json(200, pending(BORROW, ROOM)) })
    renderPage()
    await screen.findByText('Group Room 201')
    await userEvent.click(screen.getAllByRole('button', { name: 'Decline' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Decline this request?' })
    const reason = within(dialog).getByLabelText('Reason (optional)')
    const confirm = within(dialog).getByRole('button', { name: 'Decline request' })
    expect(reason).toHaveFocus()

    await userEvent.tab() // Cancel
    await userEvent.tab() // Decline request
    expect(confirm).toHaveFocus()
    await userEvent.tab()
    expect(reason).toHaveFocus()

    await userEvent.tab({ shift: true })
    expect(confirm).toHaveFocus()
  })
})

describe('Requests page: suggested order', () => {
  const cardOf = (title: string) => screen.getByText(title).closest('.card') as HTMLElement

  it('shows the note only when the delay is above zero', async () => {
    mockFetch({
      'GET /admin/requests': () =>
        json(200, pending(
          roomRequest('bk-a', 'Quiet Room A', 12, { suggestedDelayMinutes: 18, riskPercent: 42 }),
          roomRequest('bk-b', 'Quiet Room B', 8, { suggestedDelayMinutes: 0, riskPercent: 5 }),
          roomRequest('bk-c', 'Quiet Room C', 4, { suggestedDelayMinutes: 1, riskPercent: 8 }),
        )),
    })
    renderPage()
    await screen.findByText('Quiet Room A')

    const note = within(cardOf('Quiet Room A')).getByText('Suggested order: 18 min later (predicted no-show risk 42%)')
    // The card's own secondary text style, and nothing that reads as a warning.
    expect(note).toHaveClass('text-muted')
    expect(cardOf('Quiet Room A').querySelector('svg')).toBeNull()
    expect(within(cardOf('Quiet Room B')).queryByText(SUGGESTED_NOTE)).toBeNull()
    expect(within(cardOf('Quiet Room C')).getByText('Suggested order: 1 min later (predicted no-show risk 8%)')).toBeInTheDocument()
    expect(screen.getAllByText(SUGGESTED_NOTE)).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('no priority field shows no note', async () => {
    mockFetch({
      'GET /admin/requests': () =>
        json(200, pending(
          BORROW,
          roomRequest('bk-a', 'Quiet Room A', 12), // never scored: no priority at all
          roomRequest('bk-b', 'Quiet Room B', 4, { suggestedDelayMinutes: 9, riskPercent: 30 }),
        )),
    })
    renderPage()
    await screen.findByText('Quiet Room A')

    // The one note on the page is Room B's: it renders, and the unscored room and the borrow request have none.
    expect(screen.getAllByText(SUGGESTED_NOTE)).toHaveLength(1)
    expect(within(cardOf('Quiet Room B')).getByText(SUGGESTED_NOTE)).toBeInTheDocument()
    expect(within(cardOf('Quiet Room A')).queryByText(SUGGESTED_NOTE)).toBeNull()
    expect(within(cardOf('Clean Code — Robert C. Martin')).queryByText(SUGGESTED_NOTE)).toBeNull()
  })

  it('the note text for a null risk', async () => {
    mockFetch({
      'GET /admin/requests': () =>
        json(200, pending(
          roomRequest('bk-a', 'Quiet Room A', 12, { suggestedDelayMinutes: 7, riskPercent: null }),
          roomRequest('bk-b', 'Quiet Room B', 4, { suggestedDelayMinutes: 7, riskPercent: 0 }),
        )),
    })
    renderPage()
    await screen.findByText('Quiet Room A')

    // No risk figure, so no brackets: the whole line is exactly this.
    expect(within(cardOf('Quiet Room A')).getByText('Suggested order: 7 min later')).toBeInTheDocument()
    // A risk of 0% is still a risk figure.
    expect(within(cardOf('Quiet Room B')).getByText('Suggested order: 7 min later (predicted no-show risk 0%)')).toBeInTheDocument()
  })

  it('hides the note while By request time is on, even though the server still sends priority, and shows it again when it is off', async () => {
    // Under plain request-time order "Suggested order: 18 min later" would contradict the list.
    const fetch = requestsApi(() => json(200, pending(roomRequest('bk-a', 'Quiet Room A', 10, { suggestedDelayMinutes: 18, riskPercent: 42 }))))
    renderPage()
    expect(await screen.findByText('Suggested order: 18 min later (predicted no-show risk 42%)')).toBeInTheDocument()
    const toggle = screen.getByRole('checkbox', { name: 'By request time' })

    await userEvent.click(toggle)
    await waitFor(() => expect(fetch.queries().at(-1)!.get('order')).toBe('request'))
    expect(screen.queryByText(SUGGESTED_NOTE)).toBeNull()
    // The card itself is still there: only the note is gone.
    expect(screen.getByText('Quiet Room A')).toBeInTheDocument()

    await userEvent.click(toggle)
    expect(await screen.findByText('Suggested order: 18 min later (predicted no-show risk 42%)')).toBeInTheDocument()
  })

  it('By request time sends order=request and restores the order', async () => {
    const late = roomRequest('bk-late', 'Quiet Room A', 10, { suggestedDelayMinutes: 30, riskPercent: 42 })
    const onTime = roomRequest('bk-ontime', 'Quiet Room B', 4)
    const fetch = requestsApi((query) => json(200, pending(...(query.get('order') === 'request' ? [late, onTime] : [onTime, late]))))
    const seen: string[] = []
    function Badge() {
      const { state } = useRequests()
      seen.push(state.kind)
      return null
    }
    renderPage(<Badge />)
    const rooms = () => screen.getAllByText(/^Quiet Room/).map((title) => title.textContent)
    await screen.findByText('Quiet Room B')
    const toggle = screen.getByRole('checkbox', { name: 'By request time' })

    // Off by default: the server's own (suggested) order, so no order is sent.
    expect(toggle).not.toBeChecked()
    expect(rooms()).toEqual(['Quiet Room B', 'Quiet Room A'])
    expect(fetch.queries()[0].has('order')).toBe(false)

    await userEvent.click(toggle)
    await waitFor(() => expect(rooms()).toEqual(['Quiet Room A', 'Quiet Room B']))
    expect(fetch.queries()[1].get('order')).toBe('request')
    expect(toggle).toBeChecked()
    // The rows stay on screen while it refetches, and the counts (the sidebar badge reads them) never change.
    expect(screen.queryByLabelText('Loading requests')).toBeNull()
    expect(screen.getByRole('button', { name: 'All (2)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rooms (2)' })).toBeInTheDocument()

    await userEvent.click(toggle)
    await waitFor(() => expect(rooms()).toEqual(['Quiet Room B', 'Quiet Room A']))
    expect(fetch.queries()[2].has('order')).toBe(false)
    expect(toggle).not.toBeChecked()

    // One fetch for the page, one for each flip, nothing polled; the shared state never dropped back to loading.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(seen.slice(seen.indexOf('loaded')).every((kind) => kind === 'loaded')).toBe(true)
  })

  it('leaving the page puts the rest of the console back on the suggested order', async () => {
    const fetch = requestsApi(() => json(200, pending(roomRequest('bk-a', 'Quiet Room A', 10, { suggestedDelayMinutes: 30, riskPercent: 42 }))))
    function Console() {
      const [onRequests, setOnRequests] = useState(true)
      return onRequests ? (
        <>
          <RequestsPage />
          <button type="button" onClick={() => setOnRequests(false)}>Leave</button>
        </>
      ) : (
        <button type="button" onClick={() => setOnRequests(true)}>Back</button>
      )
    }
    writeToken('t')
    render(
      <ToastProvider>
        <RequestsProvider>
          <Console />
        </RequestsProvider>
      </ToastProvider>,
    )
    await screen.findByText('Quiet Room A')
    await userEvent.click(screen.getByRole('checkbox', { name: 'By request time' }))
    await waitFor(() => expect(fetch.queries().at(-1)!.get('order')).toBe('request'))

    // The sidebar badge and the Dashboard read the same list: they go back to the suggested order, once.
    const before = fetch.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(fetch.mock.calls.length).toBe(before + 1))
    expect(fetch.queries().at(-1)!.has('order')).toBe(false)

    // And the toggle is not remembered: back on the page it is off.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('checkbox', { name: 'By request time' })).not.toBeChecked()
  })

  it('a request.scored event refetches and raises no toast', async () => {
    let lists = 0
    requestsApi(() =>
      json(200, pending(++lists === 1 ? ROOM : roomRequest('bk-1', 'Group Room 201', 4, { suggestedDelayMinutes: 18, riskPercent: 42 }))),
    )
    writeToken('t')
    render(
      <ToastProvider>
        <LiveProvider>
          <RequestsProvider>
            <RequestToasts />
            <RequestsPage />
          </RequestsProvider>
        </LiveProvider>
      </ToastProvider>,
    )
    await screen.findByText('Group Room 201')
    expect(screen.queryByText(SUGGESTED_NOTE)).toBeNull()

    // Even with a summary, the event is not a new request: the page refetches and shows the note, and nothing is toasted.
    act(() => live.handlers!.onEvent({ type: 'request.scored', topics: ['requests'], kind: 'room', summary: 'Rohan Verma: Group Room 201 was scored' }))
    expect(await screen.findByText('Suggested order: 18 min later (predicted no-show risk 42%)', undefined, { timeout: 4_000 })).toBeInTheDocument()
    expect(lists).toBe(2)
    expect(screen.queryByText('Rohan Verma: Group Room 201 was scored')).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    // Control: a created request does toast through the same wiring, so the empty toast area above means something.
    act(() => live.handlers!.onEvent({ type: 'request.created', topics: ['requests'], kind: 'room', summary: 'Rohan Verma wants Group Room 201' }))
    expect(await screen.findByText('Rohan Verma wants Group Room 201')).toBeInTheDocument()
  })
})
