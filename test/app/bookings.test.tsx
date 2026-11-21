import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BookingsPage from '@/app/(console)/bookings/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { AdminBooking, BookingsPage as BookingsResponse } from '@/lib/bookings'
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

// Every slot is derived from today (UTC), never a fixed calendar date. 08:30-09:30 UTC is 2-3 PM in the library's zone.
const midnight = new Date()
midnight.setUTCHours(0, 0, 0, 0)
const slot = (days: number) => ({
  startTime: new Date(midnight.getTime() + days * 86_400_000 + 8.5 * 3_600_000).toISOString(),
  endTime: new Date(midnight.getTime() + days * 86_400_000 + 9.5 * 3_600_000).toISOString(),
})
const dayLabel = (days: number) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(midnight.getTime() + days * 86_400_000),
  )

const SEAT = { id: 'r1', name: 'Reading Hall A - Seat 12', type: 'seat' as const }
const ROOM = { id: 'r2', name: 'Group Room 201', type: 'room' as const }
const ADITI = { id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu' }
const ROHAN = { id: 's2', name: 'Rohan Verma', email: 'rohan@example.edu' }

function booking(over: Partial<AdminBooking> & Pick<AdminBooking, 'id'>): AdminBooking {
  return {
    resource: SEAT, student: ADITI, ...slot(1), status: 'booked', cancelledBy: null, cancelReason: null,
    movedFromName: null, canManage: true, ...over,
  }
}

const BOOKED = booking({ id: 'b1', resource: ROOM, student: ROHAN, status: 'booked', ...slot(2) })
const CHECKED_IN = booking({ id: 'b2', resource: SEAT, student: ADITI, status: 'checked_in', canManage: false })
const COMPLETED = booking({ id: 'b3', resource: { id: 'r3', name: 'Silent Zone - Seat 03', type: 'seat' }, status: 'completed', canManage: false, ...slot(-1) })
const RELEASED = booking({ id: 'b4', resource: { id: 'r4', name: 'Quiet Corner - Seat 07', type: 'seat' }, status: 'released', canManage: false, ...slot(-2) })
const CANCELLED = booking({
  id: 'b5', resource: { id: 'r5', name: 'Discussion Pod 3', type: 'room' }, status: 'cancelled', cancelledBy: 'library',
  cancelReason: 'Pod flooded, sorry', canManage: false, ...slot(-3),
})
const ALL = [BOOKED, CHECKED_IN, COMPLETED, RELEASED, CANCELLED]

const page = (bookings: AdminBooking[], total = bookings.length, pageNumber = 1): BookingsResponse => ({ bookings, total, page: pageNumber, pageSize: 25 })

/** `count` rows named "Seat 001"... for one page of a long list. */
const rowsOfPage = (pageNumber: number, count = 25): AdminBooking[] =>
  Array.from({ length: count }, (_, i) => {
    const n = (pageNumber - 1) * 25 + i + 1
    return booking({ id: `p${n}`, resource: { id: `rp${n}`, name: `Seat ${String(n).padStart(3, '0')}`, type: 'seat' } })
  })

/** The list endpoint: `answer` sees the query of the request being served. `routes` adds the other endpoints. */
function bookingsApi(
  answer: (query: URLSearchParams) => Response | Promise<Response>,
  routes: Record<string, () => Response | Promise<Response>> = {},
) {
  let fetch!: ReturnType<typeof mockFetch>
  const queryOf = (index: number) => new URL(String(fetch.mock.calls[index][0])).searchParams
  fetch = mockFetch({ 'GET /admin/bookings': () => answer(queryOf(fetch.mock.calls.length - 1)), ...routes })
  return Object.assign(fetch, { query: (index = fetch.mock.calls.length - 1) => queryOf(index) })
}

/** The writes sent so far (anything but a GET), and the list requests among all calls. */
const posts = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([, init]) => init?.method !== undefined && init.method !== 'GET')
const listCalls = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/admin/bookings')
const optionRequests = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([url]) => String(url).endsWith('/reassign-options'))

/** A promise the test opens by hand. */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const ROOM_202 = { id: 'r9', name: 'Group Room 202', location: '2nd Floor, East Wing', capacity: 6 }
const ROOM_203 = { id: 'r10', name: 'Group Room 203', location: null, capacity: 4 }

/** 60 bookings in three pages of 25, 25 and 10. */
const threePages = () =>
  bookingsApi((q) => {
    const n = Number(q.get('page'))
    return json(200, page(rowsOfPage(n, n === 3 ? 10 : 25), 60, n))
  })

function renderPage() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <BookingsPage />
      </ToastProvider>
    </LiveProvider>,
  )
}

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) })
const searchBox = () => screen.getByRole('textbox', { name: 'Search bookings' })
const statusSelect = () => screen.getByRole('combobox', { name: 'Filter by status' })

afterEach(() => {
  vi.useRealTimers()
})

describe('Bookings page', () => {
  it('shows the skeleton, then rows with derived status tags', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = bookingsApi(async () => {
      await gate
      return json(200, page(ALL))
    })
    renderPage()
    expect(screen.getByLabelText('Loading bookings')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('table')).toBeNull()

    release()
    const table = await screen.findByRole('table')
    expect(screen.queryByLabelText('Loading bookings')).toBeNull()
    for (const heading of ['Resource', 'Student', 'Date', 'Time', 'Status']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }

    const booked = within(rowOf('Group Room 201'))
    expect(booked.getByText('Rohan Verma')).toBeInTheDocument()
    expect(booked.getByText(dayLabel(2))).toBeInTheDocument()
    expect(booked.getByText('2–3 PM')).toBeInTheDocument() // the library's zone, not UTC
    expect(booked.getByText('Booked')).toHaveClass('tag', 'tag-neutral')
    expect(within(rowOf('Reading Hall A - Seat 12')).getByText('Checked in')).toHaveClass('tag', 'tag-neutral')
    expect(within(rowOf('Silent Zone - Seat 03')).getByText('Completed')).toHaveClass('tag', 'tag-accent-2')
    expect(within(rowOf('Quiet Corner - Seat 07')).getByText('Released')).toHaveClass('tag', 'tag-neutral')
    expect(within(rowOf('Discussion Pod 3')).getByText('Cancelled')).toHaveClass('tag', 'tag-neutral')
    expect(screen.getByText('1–5 of 5 bookings')).toBeInTheDocument()

    // The first request: page 1 of 25, no status (All), no search.
    expect(fetch).toHaveBeenCalledTimes(1)
    const q = fetch.query(0)
    expect(q.get('page')).toBe('1')
    expect(q.get('pageSize')).toBe('25')
    expect(q.has('status')).toBe(false)
    expect(q.has('search')).toBe(false)
  })

  it('offers the canvas statuses, with Released spelled out and no No-show', async () => {
    bookingsApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findByRole('table')
    const options = within(statusSelect()).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'All statuses', 'Booked', 'Checked in', 'Completed', 'Released (grace period)', 'Cancelled',
    ])
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['all', 'booked', 'checked_in', 'completed', 'released', 'cancelled'])
    expect(statusSelect()).toHaveValue('all')
  })

  it('the student name is plain text', async () => {
    bookingsApi(() => json(200, page([BOOKED])))
    renderPage()
    const name = await screen.findByText('Rohan Verma')
    expect(name.closest('a, button')).toBeNull()
  })

  it('search waits 300 ms and sends one request', async () => {
    const fetch = bookingsApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findByRole('table')
    expect(fetch).toHaveBeenCalledTimes(1)

    // From here on time is fake (but keeps running, so Testing Library's polling still works).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.change(searchBox(), { target: { value: 'a' } })
    act(() => void vi.advanceTimersByTime(200))
    fireEvent.change(searchBox(), { target: { value: 'ana' } }) // typing again restarts the wait
    act(() => void vi.advanceTimersByTime(299))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(searchBox()).toHaveValue('ana') // the box itself never waits

    // 301 ms after the last keystroke, with no real waiting in between: the request is out.
    await act(async () => void vi.advanceTimersByTime(2))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.query().get('search')).toBe('ana')
    expect(fetch.query().get('page')).toBe('1')
    expect(fetch.query().get('pageSize')).toBe('25')

    await act(async () => void vi.advanceTimersByTime(1_000))
    expect(fetch).toHaveBeenCalledTimes(2) // one request, not one per keystroke
  })

  it('a search of only spaces sends nothing', async () => {
    const fetch = bookingsApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findByRole('table')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.change(searchBox(), { target: { value: '   ' } })
    await act(async () => void vi.advanceTimersByTime(1_000))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a new search returns to page 1', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Seat 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Seat 026')
    expect(fetch.query().get('page')).toBe('2')

    fireEvent.change(searchBox(), { target: { value: 'seat' } })
    await waitFor(() => expect(fetch.query().get('search')).toBe('seat'), { timeout: 2_000 })
    expect(fetch.query().get('page')).toBe('1')
    expect(await screen.findByText('Seat 001')).toBeInTheDocument()
  })

  it('changing the status returns to page 1', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Seat 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Seat 026')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Seat 051')
    expect(fetch.query().get('page')).toBe('3')

    await userEvent.selectOptions(statusSelect(), 'cancelled')
    expect(statusSelect()).toHaveValue('cancelled')
    expect(fetch.query().get('status')).toBe('cancelled')
    expect(fetch.query().get('page')).toBe('1')
    expect(fetch.query().get('pageSize')).toBe('25')
    expect(await screen.findByText('Seat 001')).toBeInTheDocument()

    // Back to All: the status parameter is dropped again.
    await userEvent.selectOptions(statusSelect(), 'all')
    expect(fetch.query().has('status')).toBe(false)
  })

  it('the pager moves between pages and disables at the ends', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Seat 001')
    const previous = screen.getByRole('button', { name: 'Previous' })
    const next = screen.getByRole('button', { name: 'Next' })
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('1–25 of 60 bookings')).toBeInTheDocument()
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + 25

    await userEvent.click(next)
    expect(fetch.query().get('page')).toBe('2')
    expect(await screen.findByText('Seat 026')).toBeInTheDocument()
    expect(screen.queryByText('Seat 001')).toBeNull()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('26–50 of 60 bookings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(fetch.query().get('page')).toBe('3')
    expect(await screen.findByText('Seat 051')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(11) // header + 10
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByText('51–60 of 60 bookings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(fetch.query().get('page')).toBe('2')
    expect(await screen.findByText('Seat 026')).toBeInTheDocument()
  })

  it('has no pager when everything fits on one page', async () => {
    bookingsApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
  })

  it('shows "No bookings match these filters" with Clear filters', async () => {
    const fetch = bookingsApi((q) => json(200, q.has('status') || q.has('search') ? page([]) : page(ALL)))
    renderPage()
    await screen.findByRole('table')

    await userEvent.selectOptions(statusSelect(), 'cancelled')
    expect(await screen.findByText('No bookings match these filters')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('0 bookings')).toBeInTheDocument()

    fireEvent.change(searchBox(), { target: { value: 'nobody' } })
    await waitFor(() => expect(fetch.query().get('search')).toBe('nobody'), { timeout: 2_000 })

    await userEvent.click(await screen.findByRole('button', { name: 'Clear filters' }))
    expect(statusSelect()).toHaveValue('all')
    expect(searchBox()).toHaveValue('')
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(fetch.query().has('status')).toBe(false)
    expect(fetch.query().has('search')).toBe(false)
    expect(fetch.query().get('page')).toBe('1')
    // Clearing the box is immediate: it does not wait out a debounce.
    const calls = fetch.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(fetch.mock.calls.length).toBe(calls)
  })

  it('says so when there are no bookings at all, with no filter to clear', async () => {
    bookingsApi(() => json(200, page([])))
    renderPage()
    expect(await screen.findByText('No bookings yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    expect(screen.queryByText('No bookings match these filters')).toBeNull()
  })

  it('shows the error state and Retry refetches', async () => {
    let calls = 0
    const fetch = bookingsApi(() => (++calls === 1 ? json(500, { error: 'x' }) : json(200, page([BOOKED]))))
    renderPage()
    expect(await screen.findByText("Couldn't load bookings")).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    // The filters stay on screen, so the user can change them instead.
    expect(searchBox()).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Group Room 201')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load bookings")).toBeNull()
    expect(fetch.query().get('page')).toBe('1')
  })

  it('a failed page change shows the error, and Retry asks for that same page', async () => {
    let failing = false
    const fetch = bookingsApi((q) => {
      if (failing) return json(500, { error: 'x' })
      const n = Number(q.get('page'))
      return json(200, page(rowsOfPage(n, n === 3 ? 10 : 25), 60, n))
    })
    renderPage()
    await screen.findByText('Seat 001')
    failing = true
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText("Couldn't load bookings")).toBeInTheDocument()
    expect(screen.queryByText('Seat 001')).toBeNull() // never page 1's rows under page 2

    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Seat 026')).toBeInTheDocument()
    expect(fetch.query().get('page')).toBe('2')
  })

  it('a live bookings event refetches the current page without the skeleton', async () => {
    let lists = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    bookingsApi(async () => {
      if (++lists === 1) return json(200, page([BOOKED]))
      await gate
      return json(200, page([BOOKED, CANCELLED]))
    })
    renderPage()
    await screen.findByText('Group Room 201')

    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    // The refetch starts after the 1 s debounce and is still pending: the rows stay and there is no skeleton.
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })
    expect(screen.queryByLabelText('Loading bookings')).toBeNull()
    expect(screen.getByText('Group Room 201')).toBeInTheDocument()

    release()
    expect(await screen.findByText('Discussion Pod 3')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading bookings')).toBeNull()
  })

  it('a live refetch keeps the filters and the page', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Seat 001')
    await userEvent.selectOptions(statusSelect(), 'booked')
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Seat 026')
    const before = fetch.mock.calls.length

    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    await waitFor(() => expect(fetch.mock.calls.length).toBe(before + 1), { timeout: 2_000 })
    expect(fetch.query().get('page')).toBe('2')
    expect(fetch.query().get('status')).toBe('booked')
    expect(statusSelect()).toHaveValue('booked')
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('a quiet refetch that fails keeps the rows', async () => {
    let lists = 0
    bookingsApi(() => (++lists === 1 ? json(200, page([BOOKED])) : json(500, { error: 'x' })))
    renderPage()
    await screen.findByText('Group Room 201')

    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('Group Room 201')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load bookings")).toBeNull()
  })

  it('ignores a live event about something else', async () => {
    const fetch = bookingsApi(() => json(200, page([BOOKED])))
    renderPage()
    await screen.findByText('Group Room 201')
    act(() => live.handlers!.onEvent({ type: 'resource.changed', topics: ['resources', 'metrics'] }))
    await new Promise((resolve) => setTimeout(resolve, 1_300)) // longer than the 1 s debounce
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a live refetch that finds the current page gone moves back to the last page', async () => {
    let shrunk = false
    const fetch = bookingsApi((q) => {
      const n = Number(q.get('page'))
      // After the shrink there are 30 bookings: page 3 is past the end.
      if (shrunk) return json(200, n > 2 ? page([], 30, n) : page(rowsOfPage(n, n === 2 ? 5 : 25), 30, n))
      return json(200, page(rowsOfPage(n, n === 3 ? 10 : 25), 60, n))
    })
    renderPage()
    await screen.findByText('Seat 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Seat 051')
    shrunk = true

    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    expect(await screen.findByText('Seat 026', undefined, { timeout: 3_000 })).toBeInTheDocument()
    expect(fetch.query().get('page')).toBe('2')
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.queryByText('No bookings match these filters')).toBeNull()
  })

  it('a cancelled row shows who cancelled and why', async () => {
    const byStudent = booking({
      id: 'b6', resource: { id: 'r6', name: 'Study Carrel 9', type: 'seat' }, status: 'cancelled', cancelledBy: 'student',
      cancelReason: null, canManage: false,
    })
    const withReason = booking({
      id: 'b7', resource: { id: 'r7', name: 'Study Carrel 10', type: 'seat' }, status: 'cancelled', cancelledBy: 'student',
      cancelReason: 'Exam moved', canManage: false,
    })
    bookingsApi(() => json(200, page([CANCELLED, byStudent, withReason, BOOKED])))
    renderPage()
    await screen.findByRole('table')

    const library = within(rowOf('Discussion Pod 3'))
    expect(library.getByText('Cancelled')).toHaveClass('tag')
    expect(library.getByText('by the library')).toHaveClass('text-muted')
    expect(library.getByText('Pod flooded, sorry')).toHaveClass('text-muted')

    const student = within(rowOf('Study Carrel 9'))
    expect(student.getByText('by the student')).toHaveClass('text-muted')
    // No reason given: only the "by the student" line, nothing else under the tag.
    expect(student.getByText('Cancelled').closest('td')!.querySelectorAll('.text-muted')).toHaveLength(1)
    expect(within(rowOf('Study Carrel 10')).getByText('Exam moved')).toBeInTheDocument()

    // A live booking has no such line.
    const booked = within(rowOf('Group Room 201'))
    expect(booked.queryByText(/^by the/)).toBeNull()
  })

  it('shows a reason as text, never as markup', async () => {
    const tricky = booking({
      id: 'b8', status: 'cancelled', cancelledBy: 'library', cancelReason: '<b>bold</b> & more', canManage: false,
    })
    bookingsApi(() => json(200, page([tricky])))
    renderPage()
    expect(await screen.findByText('<b>bold</b> & more')).toBeInTheDocument()
  })
})
