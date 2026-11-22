import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConsoleLayout from '@/app/(console)/layout'
import StudentPage from '@/app/(console)/students/[id]/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { AdminFine } from '@/lib/fines'
import type { LiveEvent, LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { AdminStudent } from '@/lib/students'
import { json, mockFetch } from '../helpers'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

// A stable replace: ConsoleGuard's effect depends on it. `id` and `search` are what the URL says.
const nav = vi.hoisted(() => ({ replace: vi.fn(), id: 's1', search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => `/students/${nav.id}`,
  useParams: () => ({ id: nav.id }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

// Every date is derived from today (UTC), never a fixed calendar date. 08:30 UTC is 14:00 in the library's zone: the same day.
const midnight = new Date()
midnight.setUTCHours(0, 0, 0, 0)
const at = (days: number, hours = 8.5) => new Date(midnight.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString()
const dayLabel = (days: number) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(midnight.getTime() + days * 86_400_000),
  )

const ADMIN = { id: 'a1', name: 'Librarian One', email: 'lib@thapar.edu', roll: 'Pending', role: 'admin' }
const NO_REQUESTS = { requests: [], counts: { all: 0, borrow: 0, room: 0 } }

function fine(over: Partial<AdminFine> & Pick<AdminFine, 'id'>): AdminFine {
  return {
    kind: 'fine', student: { id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu' }, reason: 'overdue', item: 'Some Book', amount: 40,
    originalAmount: 40, status: 'outstanding', date: at(-2), note: null, recordedBy: null, canSettle: true, ...over,
  }
}

const ADITI: AdminStudent = {
  id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu', roll: '1024160143', score: 68, tier: 'Building back up',
  // Newest first, as the server sends it.
  history: [
    { date: at(-1), score: 68, delta: 8, reason: 'On-time check-in', by: null },
    { date: at(-5), score: 60, delta: -10, reason: 'Library adjustment: Left a room in a mess', by: 'Meera Iyer' },
    { date: at(-30), score: 90, delta: 0, reason: 'Starting score', by: null },
  ],
  loans: [
    { id: 'l1', title: 'Clean Code', borrowedAt: at(-2), dueAt: at(12), returnedAt: null, lostAt: null, status: 'active' },
    { id: 'l2', title: 'Introduction to Algorithms', borrowedAt: at(-20), dueAt: at(-6), returnedAt: null, lostAt: null, status: 'overdue' },
    { id: 'l3', title: 'Sapiens', borrowedAt: at(-25), dueAt: at(-11), returnedAt: null, lostAt: at(-3), status: 'lost' },
    { id: 'l4', title: 'Computer Networks', borrowedAt: at(-40), dueAt: at(-26), returnedAt: at(-27), lostAt: null, status: 'returned' },
  ],
  bookings: [
    { id: 'b1', resource: 'Reading Hall A – Seat 12', startTime: at(1, 8.5), endTime: at(1, 9.5), status: 'booked' },
    { id: 'b2', resource: 'Group Study Room 201', startTime: at(-3, 8.5), endTime: at(-3, 10.5), status: 'no_show' },
    { id: 'b3', resource: 'Silent Zone – Seat 03', startTime: at(-4, 8.5), endTime: at(-4, 9.5), status: 'completed' },
  ],
  fines: [
    fine({ id: 'f1', item: 'Introduction to Algorithms', amount: 40, originalAmount: 40, status: 'outstanding', date: at(-2) }),
    fine({
      id: 'f2', item: 'Operating Systems', amount: 50, originalAmount: 150, status: 'adjusted', date: at(-9),
      note: 'Student showed the receipt', recordedBy: 'Meera Iyer',
    }),
    fine({ id: 'f3', item: 'Group Study Room 201', reason: 'no_show', amount: 50, originalAmount: 50, status: 'paid', date: at(-12), canSettle: false }),
  ],
}

const EMPTY: AdminStudent = { ...ADITI, history: [], loans: [], bookings: [], fines: [] }

/** GET /admin/students/s1 (and the shell's own routes); `routes` adds the writes. */
function studentApi(answer: () => Response | Promise<Response>, routes: Record<string, () => Response | Promise<Response>> = {}) {
  return mockFetch({
    'GET /auth/me': () => json(200, ADMIN),
    'GET /admin/requests': () => json(200, NO_REQUESTS),
    'GET /admin/students/s1': answer,
    ...routes,
  })
}

const studentCalls = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/admin/students/s1')
const posts = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([, init]) => init?.method !== undefined && init.method !== 'GET')

function renderPage() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <StudentPage />
      </ToastProvider>
    </LiveProvider>,
  )
}

/** The page inside the real console frame, to see what it does to the top bar and the sidebar. */
function renderInConsole() {
  writeToken('t')
  return render(
    <ConsoleLayout>
      <StudentPage />
    </ConsoleLayout>,
  )
}

const region = (name: string) => within(screen.getByRole('region', { name }))
const rowOf = (name: string, title: string) => region(name).getByRole('row', { name: new RegExp(title) })
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell')
const STUDENT_CHANGED: LiveEvent = { type: 'student.changed', topics: ['students'] }

beforeEach(() => {
  nav.id = 's1'
  nav.search = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Student page', () => {
  it('shows the skeleton then the header, reliability, loans, bookings and fines', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = studentApi(async () => {
      await gate
      return json(200, ADITI)
    })
    renderPage()
    expect(screen.getByLabelText('Loading student')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Aditi Sharma')).toBeNull()

    release()
    expect(await screen.findByText('Aditi Sharma')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading student')).toBeNull()
    expect(studentCalls(fetch)).toHaveLength(1)
    expect(String(studentCalls(fetch)[0][0])).toMatch(/\/admin\/students\/s1$/)

    // Header: initials, name, "<roll> · <email>", the tier tag the server sent, and the adjust button.
    expect(screen.getByText('AS')).toBeInTheDocument()
    expect(screen.getByText('1024160143 · aditi@example.edu')).toBeInTheDocument()
    expect(screen.getByText('Building back up')).toHaveClass('tag', 'tag-accent')
    expect(screen.getByRole('button', { name: 'Adjust reliability' })).toBeEnabled()

    // Reliability: the ring with the score, the line oldest to newest, the dated list newest first.
    const card = region('Reliability history')
    const ring = screen.getByRole('img', { name: 'Reliability score 68 out of 100' })
    expect(within(ring).getByText('68')).toBeInTheDocument()
    const filled = ring.querySelector('circle[stroke-dasharray]')!.getAttribute('stroke-dasharray')!.split(' ').map(Number)
    expect(filled[1]).toBeCloseTo(2 * Math.PI * 52, 6)
    expect(filled[0]).toBeCloseTo(0.68 * 2 * Math.PI * 52, 6)
    const chart = screen.getByRole('img', { name: 'Reliability score over time' })
    // Oldest first: 90, 60, 68. x spreads over 6..274, y = 50 - score% * 44.
    expect(chart.querySelector('polyline')).toHaveAttribute('points', '6,10 140,24 274,20')
    expect(chart.querySelectorAll('circle')).toHaveLength(3)
    const entries = card.getAllByRole('listitem')
    expect(entries).toHaveLength(3)
    expect(entries[0]).toHaveTextContent(`${dayLabel(-1)}68On-time check-in`)
    expect(entries[1]).toHaveTextContent(`${dayLabel(-5)}60Library adjustment: Left a room in a mess — Meera Iyer`)
    expect(entries[2]).toHaveTextContent(`${dayLabel(-30)}90Starting score`)

    // Loans: dates in library time, "—" until it is back, a lost loan shows when it was lost.
    const loans = region('Loan history')
    for (const heading of ['Title', 'Borrowed', 'Due', 'Returned', 'Status']) {
      expect(loans.getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }
    const active = cellsOf(rowOf('Loan history', 'Clean Code'))
    expect(active.map((c) => c.textContent)).toEqual(['Clean Code', dayLabel(-2), dayLabel(12), '—', 'Active'])
    expect(within(active[4]).getByText('Active')).toHaveClass('tag', 'tag-neutral')
    const overdue = cellsOf(rowOf('Loan history', 'Introduction to Algorithms'))
    expect(overdue.map((c) => c.textContent)).toEqual(['Introduction to Algorithms', dayLabel(-20), dayLabel(-6), '—', 'Overdue'])
    expect(within(overdue[4]).getByText('Overdue')).toHaveClass('tag', 'tag-accent')
    const lost = cellsOf(rowOf('Loan history', 'Sapiens'))
    expect(lost.map((c) => c.textContent)).toEqual(['Sapiens', dayLabel(-25), dayLabel(-11), dayLabel(-3), 'Lost'])
    expect(within(lost[4]).getByText('Lost')).toHaveClass('tag', 'tag-accent')
    const returned = cellsOf(rowOf('Loan history', 'Computer Networks'))
    expect(returned.map((c) => c.textContent)).toEqual(['Computer Networks', dayLabel(-40), dayLabel(-26), dayLabel(-27), 'Returned'])
    expect(within(returned[4]).getByText('Returned')).toHaveClass('tag', 'tag-accent-2')

    // Bookings: the day and the time span in library time, a labelled status.
    const bookings = region('Booking history')
    for (const heading of ['Resource', 'Date', 'Time', 'Status']) {
      expect(bookings.getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }
    expect(cellsOf(rowOf('Booking history', 'Reading Hall A')).map((c) => c.textContent)).toEqual([
      'Reading Hall A – Seat 12', dayLabel(1), '2–3 PM', 'Booked',
    ])
    expect(cellsOf(rowOf('Booking history', 'Group Study Room 201')).map((c) => c.textContent)).toEqual([
      'Group Study Room 201', dayLabel(-3), '2–4 PM', 'No-show',
    ])
    expect(bookings.getByText('No-show')).toHaveClass('tag', 'tag-accent')
    expect(bookings.getByText('Completed')).toHaveClass('tag', 'tag-accent-2')
    expect(bookings.getByText('Booked')).toHaveClass('tag', 'tag-neutral')

    // Fines: the Fines page's tags, "(was ₹X)" for a lowered one and its note.
    const fines = region('Fine history')
    for (const heading of ['Item', 'Amount', 'Status', 'Date']) {
      expect(fines.getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }
    const outstanding = cellsOf(rowOf('Fine history', 'Introduction to Algorithms'))
    expect(outstanding.map((c) => c.textContent)).toEqual(['Introduction to Algorithms', '₹40', 'Outstanding', dayLabel(-2)])
    expect(within(outstanding[2]).getByText('Outstanding')).toHaveClass('tag', 'tag-accent')
    const adjusted = cellsOf(rowOf('Fine history', 'Operating Systems'))
    expect(adjusted[1]).toHaveTextContent('₹50 (was ₹150)')
    expect(within(adjusted[2]).getByText('Adjusted')).toHaveClass('tag', 'tag-accent-2')
    expect(adjusted[2]).toHaveTextContent('Student showed the receipt — Meera Iyer')
    const paid = cellsOf(rowOf('Fine history', 'Group Study Room 201'))
    expect(paid[1]).toHaveTextContent(/^₹50$/)
    expect(within(paid[2]).getByText('Paid')).toHaveClass('tag', 'tag-accent-2')

    // A read-only history: no row action changes a fine, a booking or a loan from here.
    expect(fines.queryByRole('button')).toBeNull()
    expect(bookings.queryByRole('button')).toBeNull()
    expect(loans.queryByRole('button')).toBeNull()
  })

  it('the tier tag is accent-2 only for Good standing', async () => {
    studentApi(() => json(200, { ...ADITI, score: 85, tier: 'Good standing' }))
    renderPage()
    expect(await screen.findByText('Good standing')).toHaveClass('tag', 'tag-accent-2')
  })

  it('a single history entry is centred in the chart', async () => {
    studentApi(() => json(200, { ...ADITI, history: [ADITI.history[2]] }))
    renderPage()
    await screen.findByText('Aditi Sharma')
    const chart = screen.getByRole('img', { name: 'Reliability score over time' })
    expect(chart.querySelector('polyline')).toHaveAttribute('points', '140,10')
    expect(chart.querySelectorAll('circle')).toHaveLength(1)
  })

  it('the top bar shows "Fines / <name>" and the sidebar highlights Fines for ?from=fines', async () => {
    nav.search = 'from=fines'
    studentApi(() => json(200, ADITI))
    renderInConsole()

    expect(await screen.findByRole('heading', { level: 2, name: 'Fines / Aditi Sharma' })).toBeInTheDocument()
    const sidebar = within(screen.getByRole('navigation', { name: 'Console' }))
    expect(sidebar.getByRole('link', { name: 'Fines' })).toHaveAttribute('aria-current', 'page')
    expect(sidebar.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(sidebar.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it.each([
    ['bookings', 'Bookings'],
    ['requests', 'Requests'],
    ['catalogue', 'Catalogue'],
  ])('?from=%s shows "%s / <name>" and highlights that section', async (from, label) => {
    nav.search = `from=${from}`
    studentApi(() => json(200, ADITI))
    renderInConsole()
    expect(await screen.findByRole('heading', { level: 2, name: `${label} / Aditi Sharma` })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Console' })).getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute(
      'aria-current', 'page',
    )
  })

  it('the top bar names only the section until the student has loaded', async () => {
    nav.search = 'from=fines'
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    studentApi(async () => {
      await gate
      return json(200, ADITI)
    })
    renderInConsole()
    expect(await screen.findByRole('heading', { level: 2, name: 'Fines' })).toBeInTheDocument()
    expect(screen.getByLabelText('Loading student')).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { level: 2, name: 'Fines / Aditi Sharma' })).toBeInTheDocument()
  })

  it('without from it shows "Dashboard / <name>"', async () => {
    studentApi(() => json(200, ADITI))
    renderInConsole()
    expect(await screen.findByRole('heading', { level: 2, name: 'Dashboard / Aditi Sharma' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Console' })).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['nowhere', 'constructor', ''])('an unknown from (%j) falls back to "Dashboard / <name>"', async (from) => {
    nav.search = `from=${from}`
    studentApi(() => json(200, ADITI))
    renderInConsole()
    expect(await screen.findByRole('heading', { level: 2, name: 'Dashboard / Aditi Sharma' })).toBeInTheDocument()
  })

  it('leaving the page puts the top bar back to the layout\'s own title', async () => {
    nav.search = 'from=fines'
    studentApi(() => json(200, ADITI))
    const { rerender } = renderInConsole()
    await screen.findByRole('heading', { level: 2, name: 'Fines / Aditi Sharma' })
    rerender(
      <ConsoleLayout>
        <p>another page</p>
      </ConsoleLayout>,
    )
    expect(screen.getByText('another page')).toBeInTheDocument()
    // /students/s1 is not one of the layout's own titles, so it falls back to Dashboard, and no section is forced.
    expect(screen.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /Aditi/ })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Console' })).getByRole('link', { name: 'Fines' })).not.toHaveAttribute('aria-current')
  })

  it('empty histories show their lines', async () => {
    studentApi(() => json(200, EMPTY))
    renderPage()
    expect(await screen.findByText('Aditi Sharma')).toBeInTheDocument()
    expect(region('Loan history').getByText('No loan history for this student.')).toBeInTheDocument()
    expect(region('Booking history').getByText('No booking history for this student.')).toBeInTheDocument()
    expect(region('Fine history').getByText('No fine history for this student.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    // The reliability card still shows the ring.
    expect(screen.getByRole('img', { name: 'Reliability score 68 out of 100' })).toBeInTheDocument()
  })

  it('a table shows only its own rows, not another history\'s', async () => {
    studentApi(() => json(200, { ...ADITI, loans: [], fines: [] }))
    renderPage()
    await screen.findByText('Aditi Sharma')
    expect(region('Loan history').getByText('No loan history for this student.')).toBeInTheDocument()
    expect(region('Booking history').getAllByRole('row')).toHaveLength(4) // header + 3
    expect(region('Fine history').getByText('No fine history for this student.')).toBeInTheDocument()
  })

  it('labels every booking status, with an unknown one shown as itself', async () => {
    const statuses = ['booked', 'released', 'checked_in', 'completed', 'cancelled', 'requested', 'declined', 'expired', 'no_show', 'mystery']
    studentApi(() =>
      json(200, {
        ...ADITI,
        bookings: statuses.map((status, i) => ({ id: `b${i}`, resource: `Resource ${i}`, startTime: at(i, 8.5), endTime: at(i, 9.5), status })),
      }),
    )
    renderPage()
    await screen.findByText('Aditi Sharma')
    const labels = ['Booked', 'Released', 'Checked in', 'Completed', 'Cancelled', 'Requested', 'Declined', 'Expired', 'No-show', 'mystery']
    const classes = ['neutral', 'neutral', 'neutral', 'accent-2', 'neutral', 'neutral', 'neutral', 'neutral', 'accent', 'neutral']
    labels.forEach((label, i) => {
      const status = cellsOf(rowOf('Booking history', `Resource ${i}`))[3]
      expect(within(status).getByText(label)).toHaveClass('tag', `tag-${classes[i]}`)
    })
  })

  it('shows names and reasons as text, never as markup', async () => {
    studentApi(() =>
      json(200, {
        ...ADITI,
        name: 'A <b>B</b>',
        history: [{ date: at(-1), score: 68, delta: 8, reason: '<i>odd</i> & more', by: null }],
        loans: [{ ...ADITI.loans[0], title: '<u>Odd</u> & Co' }],
      }),
    )
    renderPage()
    expect(await screen.findByText('A <b>B</b>')).toBeInTheDocument()
    expect(screen.getByText('<i>odd</i> & more')).toBeInTheDocument()
    expect(screen.getByText('<u>Odd</u> & Co')).toBeInTheDocument()
    expect(document.body.querySelector('b, i, u')).toBeNull()
  })

  it('moving to another student loads that one behind the skeleton', async () => {
    const fetch = mockFetch({
      'GET /admin/students/s1': () => json(200, ADITI),
      'GET /admin/students/s2': () => json(200, { ...ADITI, id: 's2', name: 'Rohan Verma' }),
    })
    writeToken('t')
    // A new element each time: the mocked useParams is not context, so only a fresh element re-renders the page.
    const tree = () => (
      <LiveProvider>
        <ToastProvider>
          <StudentPage />
        </ToastProvider>
      </LiveProvider>
    )
    const { rerender } = render(tree())
    await screen.findByText('Aditi Sharma')
    nav.id = 's2'
    rerender(tree())
    expect(await screen.findByText('Rohan Verma')).toBeInTheDocument()
    expect(screen.queryByText('Aditi Sharma')).toBeNull()
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/admin/students/s1', '/admin/students/s2'])
  })

  it('404 shows "Student not found"', async () => {
    studentApi(() => json(404, { error: 'Student not found' }))
    renderPage()
    expect(await screen.findByText('Student not found')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load this student")).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adjust reliability' })).toBeNull()
    expect(screen.queryByLabelText('Loading student')).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('error and Retry', async () => {
    let calls = 0
    const fetch = studentApi(() => (++calls === 1 ? json(500, { error: 'x' }) : json(200, ADITI)))
    renderPage()
    expect(await screen.findByText("Couldn't load this student")).toBeInTheDocument()
    expect(screen.queryByText('Student not found')).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Aditi Sharma')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load this student")).toBeNull()
    expect(studentCalls(fetch)).toHaveLength(2)
  })

  it('a live students event refetches quietly', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    studentApi(async () => {
      if (++calls === 1) return json(200, ADITI)
      await gate
      return json(200, { ...ADITI, score: 75, history: [{ date: at(0), score: 75, delta: 7, reason: 'Fresh reason', by: null }, ...ADITI.history] })
    })
    renderPage()
    await screen.findByText('Aditi Sharma')

    act(() => live.handlers!.onEvent({ ...STUDENT_CHANGED, topics: ['students', 'metrics'] }))
    // The refetch starts after the 1 s debounce and is still pending: the page stays and there is no skeleton.
    await waitFor(() => expect(calls).toBe(2), { timeout: 2_000 })
    expect(screen.queryByLabelText('Loading student')).toBeNull()
    expect(screen.getByText('Aditi Sharma')).toBeInTheDocument()
    expect(screen.queryByText('Fresh reason')).toBeNull()

    release()
    expect(await screen.findByText('Fresh reason')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Reliability score 75 out of 100' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading student')).toBeNull()
  })

  it('refetches on fines, catalogue, bookings and requests events too, and ignores others', async () => {
    const fetch = studentApi(() => json(200, ADITI))
    renderPage()
    await screen.findByText('Aditi Sharma')
    expect(studentCalls(fetch)).toHaveLength(1)

    vi.useFakeTimers({ shouldAdvanceTime: true })
    let expected = 1
    for (const topic of ['fines', 'catalogue', 'bookings', 'requests', 'students'] as const) {
      act(() => live.handlers!.onEvent({ type: 'activity', topics: [topic] }))
      await act(async () => void vi.advanceTimersByTime(1_001))
      expected += 1
      expect(studentCalls(fetch), topic).toHaveLength(expected)
    }

    // Something that cannot change what this page shows: nothing is fetched.
    act(() => live.handlers!.onEvent({ type: 'resource.changed', topics: ['resources', 'metrics'] }))
    await act(async () => void vi.advanceTimersByTime(2_000))
    expect(studentCalls(fetch)).toHaveLength(expected)
  })

  it('a quiet refetch that fails keeps the page', async () => {
    let calls = 0
    studentApi(() => (++calls === 1 ? json(200, ADITI) : json(500, { error: 'x' })))
    renderPage()
    await screen.findByText('Aditi Sharma')
    act(() => live.handlers!.onEvent(STUDENT_CHANGED))
    await waitFor(() => expect(calls).toBe(2), { timeout: 2_000 })
    expect(screen.getByText('Aditi Sharma')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load this student")).toBeNull()
  })
})

describe('Adjust reliability', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Adjust reliability score' })
  const slider = () => within(dialog()).getByRole('slider')
  const reasonField = () => within(dialog()).getByLabelText('Reason (required)')
  const apply = () => within(dialog()).getByRole('button', { name: 'Apply adjustment' })
  const setDelta = (value: number) => fireEvent.change(slider(), { target: { value: String(value) } })

  async function open() {
    await screen.findByText('Aditi Sharma')
    await userEvent.click(screen.getByRole('button', { name: 'Adjust reliability' }))
  }

  it('shows the canvas wording, a -10 to +10 slider at 0, and the required reason', async () => {
    const fetch = studentApi(() => json(200, ADITI))
    renderPage()
    await open()

    expect(dialog()).toHaveTextContent('Current score: 68. This change is logged with your reason and shown to the student.')
    expect(slider()).toHaveAttribute('type', 'range')
    expect(slider()).toHaveAttribute('min', '-10')
    expect(slider()).toHaveAttribute('max', '10')
    expect(slider()).toHaveAttribute('step', '1')
    expect(slider()).toHaveValue('0')
    expect(slider()).toHaveAccessibleName('Adjustment: 0')
    expect(slider()).toHaveFocus() // the first field takes focus
    expect(reasonField()).toHaveValue('')
    expect(reasonField()).toHaveAttribute('placeholder', 'Why override the automatic score?')
    expect(reasonField()).toHaveAttribute('maxlength', '300')
    expect(apply()).toBeDisabled()
    expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(posts(fetch)).toHaveLength(0)
  })

  it('the label follows the slider: +3, −3 (a true minus sign) and 0', async () => {
    studentApi(() => json(200, ADITI))
    renderPage()
    await open()
    setDelta(3)
    expect(slider()).toHaveAccessibleName('Adjustment: +3')
    setDelta(-3)
    expect(slider()).toHaveAccessibleName('Adjustment: −3')
    setDelta(10)
    expect(slider()).toHaveAccessibleName('Adjustment: +10')
    setDelta(-10)
    expect(slider()).toHaveAccessibleName('Adjustment: −10')
    setDelta(0)
    expect(slider()).toHaveAccessibleName('Adjustment: 0')
  })

  it('the adjust dialog is disabled at 0 and with a blank reason, posts delta and reason, toasts and refetches', async () => {
    let served = 0
    const fetch = studentApi(
      () =>
        json(
          200,
          ++served === 1
            ? ADITI
            : { ...ADITI, score: 71, history: [{ date: at(0), score: 71, delta: 3, reason: 'Library adjustment: Helped at the desk', by: 'Librarian One' }, ...ADITI.history] },
        ),
      { 'POST /admin/students/s1/reliability': () => json(200, { ...ADITI, score: 71 }) },
    )
    renderPage()
    await open()

    // Nothing yet: at 0 with no reason.
    expect(apply()).toBeDisabled()
    // A reason alone, still at 0.
    await userEvent.type(reasonField(), 'Helped at the desk')
    expect(apply()).toBeDisabled()
    // Both.
    setDelta(4)
    expect(apply()).toBeEnabled()
    // Back to 0 with the reason kept.
    setDelta(0)
    expect(apply()).toBeDisabled()
    setDelta(-4)
    expect(apply()).toBeEnabled()
    // A blank reason, spaces only.
    await userEvent.clear(reasonField())
    expect(apply()).toBeDisabled()
    await userEvent.type(reasonField(), '   ')
    expect(apply()).toBeDisabled()
    expect(posts(fetch)).toHaveLength(0)

    // A valid adjustment: +3, with the reason typed padded with spaces.
    setDelta(3)
    await userEvent.clear(reasonField())
    await userEvent.type(reasonField(), '  Helped at the desk ')
    expect(apply()).toBeEnabled()
    await userEvent.click(apply())

    expect(await screen.findByText('Reliability adjusted.')).toBeInTheDocument()
    // The dialog closes once the refetch has returned.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts(fetch)).toHaveLength(1)
    expect(String(posts(fetch)[0][0])).toMatch(/\/admin\/students\/s1\/reliability$/)
    expect(posts(fetch)[0][1]!.method).toBe('POST')
    // The delta goes as a number and the reason trimmed.
    expect(posts(fetch)[0][1]!.body).toBe('{"delta":3,"reason":"Helped at the desk"}')

    // The student was fetched again and shows the outcome.
    expect(await screen.findByRole('img', { name: 'Reliability score 71 out of 100' })).toBeInTheDocument()
    expect(screen.getByText('Library adjustment: Helped at the desk — Librarian One')).toBeInTheDocument()
    expect(studentCalls(fetch)).toHaveLength(2)
    expect(screen.queryByLabelText('Loading student')).toBeNull()
  })

  it('a negative adjustment sends a negative delta', async () => {
    const fetch = studentApi(() => json(200, ADITI), { 'POST /admin/students/s1/reliability': () => json(200, ADITI) })
    renderPage()
    await open()
    setDelta(-7)
    await userEvent.type(reasonField(), 'Left a room in a mess')
    await userEvent.click(apply())
    await screen.findByText('Reliability adjusted.')
    expect(posts(fetch)[0][1]!.body).toBe('{"delta":-7,"reason":"Left a room in a mess"}')
  })

  it("a 409 shows the server's message", async () => {
    // It is shown as given, and the dialog stays open with the slider and the reason, so nothing typed is thrown away.
    const fetch = studentApi(() => json(200, { ...ADITI, score: 100 }), {
      'POST /admin/students/s1/reliability': () => json(409, { error: 'The score is already at 100.' }),
    })
    renderPage()
    await open()
    setDelta(5)
    await userEvent.type(reasonField(), 'Good work')
    await userEvent.click(apply())

    expect(await screen.findByText('The score is already at 100.')).toBeInTheDocument()
    expect(screen.queryByText('Reliability adjusted.')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)
    // The refusal does not throw the form away.
    expect(dialog()).toBeInTheDocument()
    expect(slider()).toHaveValue('5')
    expect(reasonField()).toHaveValue('Good work')
    // The student is fetched again so the page shows what is really there.
    await waitFor(() => expect(studentCalls(fetch)).toHaveLength(2))
    await waitFor(() => expect(apply()).toBeEnabled())

    // Cancel closes it without a second request.
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Adjust reliability' })).toHaveFocus()
  })

  it('a double click on Apply sends one request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = studentApi(() => json(200, ADITI), {
      'POST /admin/students/s1/reliability': async () => {
        await gate
        return json(200, ADITI)
      },
    })
    renderPage()
    await open()
    setDelta(2)
    await userEvent.type(reasonField(), 'Thanks')
    await userEvent.dblClick(apply())
    expect(posts(fetch)).toHaveLength(1)
    expect(apply()).toBeDisabled()
    release()
    await screen.findByText('Reliability adjusted.')
    expect(posts(fetch)).toHaveLength(1)
  })

  it('Escape closes the dialog without sending anything, and reopening starts clean', async () => {
    const fetch = studentApi(() => json(200, ADITI))
    renderPage()
    await open()
    setDelta(6)
    await userEvent.type(reasonField(), 'Typed then abandoned')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Adjust reliability' })).toHaveFocus()
    expect(posts(fetch)).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Adjust reliability' }))
    expect(slider()).toHaveValue('0')
    expect(reasonField()).toHaveValue('')
  })

  it('shows the score as of the last fetch, not as it was when the page opened', async () => {
    let served = 0
    studentApi(() => json(200, { ...ADITI, score: ++served === 1 ? 68 : 74 }))
    renderPage()
    await screen.findByText('Aditi Sharma')
    act(() => live.handlers!.onEvent(STUDENT_CHANGED))
    await screen.findByRole('img', { name: 'Reliability score 74 out of 100' }, { timeout: 3_000 })
    await userEvent.click(screen.getByRole('button', { name: 'Adjust reliability' }))
    expect(dialog()).toHaveTextContent('Current score: 74.')
  })
})
