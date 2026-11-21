import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FinesPage from '@/app/(console)/fines/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { AdminFine, FinesPage as FinesResponse } from '@/lib/fines'
import type { LiveEvent, LiveHandlers } from '@/lib/live'
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

// Every date is derived from today (UTC), never a fixed calendar date.
const midnight = new Date()
midnight.setUTCHours(0, 0, 0, 0)
const at = (days: number, hours: number) => new Date(midnight.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString()
const dayLabel = (days: number) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(midnight.getTime() + days * 86_400_000),
  )

const ADITI = { id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu' }
const ROHAN = { id: 's2', name: 'Rohan Verma', email: 'rohan@example.edu' }

function fine(over: Partial<AdminFine> & Pick<AdminFine, 'id'>): AdminFine {
  return {
    kind: 'fine', student: ADITI, reason: 'overdue', item: 'Some Book', amount: 150, originalAmount: 150, status: 'outstanding',
    date: at(-1, 8.5), note: null, recordedBy: null, canSettle: true, ...over,
  }
}

// 20:30 UTC the day before is 02:00 the next morning in the library's zone: the row shows that day, not the UTC one.
const OVERDUE = fine({ id: 'f1', student: ROHAN, reason: 'overdue', item: 'Clean Code', amount: 150, date: at(-1, 20.5) })
const ACCRUING = fine({
  id: 'l1', kind: 'accruing', reason: 'overdue', item: 'Introduction to Algorithms', amount: 40, originalAmount: 40, status: 'accruing',
  date: at(-4, 8.5), canSettle: false,
})
const NO_SHOW = fine({ id: 'f2', reason: 'no_show', item: 'Group Room 201', amount: 50, originalAmount: 50, status: 'paid', date: at(-2, 8.5), canSettle: false })
const LOST = fine({ id: 'f3', student: ROHAN, reason: 'lost', item: 'Computer Networks', amount: 500, originalAmount: 500, date: at(-3, 8.5) })
const ADJUSTED = fine({
  id: 'f4', reason: 'overdue', item: 'Operating Systems', amount: 50, originalAmount: 150, status: 'adjusted',
  note: 'Student showed the receipt', recordedBy: 'Meera Iyer', date: at(-5, 8.5),
})
const WAIVED = fine({
  id: 'f5', student: ROHAN, reason: 'overdue', item: 'Database Systems', amount: 0, originalAmount: 80, status: 'waived',
  note: 'Book was already damaged', recordedBy: null, date: at(-6, 8.5), canSettle: false,
})
const ALL = [OVERDUE, ACCRUING, NO_SHOW, LOST, ADJUSTED, WAIVED]

const page = (fines: AdminFine[], total = fines.length, pageNumber = 1): FinesResponse => ({ fines, total, page: pageNumber, pageSize: 25 })

/** `count` rows for one page of a long list, items named "Book 001"... */
const rowsOfPage = (pageNumber: number, count = 25): AdminFine[] =>
  Array.from({ length: count }, (_, i) => {
    const n = (pageNumber - 1) * 25 + i + 1
    return fine({ id: `p${n}`, item: `Book ${String(n).padStart(3, '0')}` })
  })

/** The list endpoint: `answer` sees the query of the request being served. `routes` adds the write endpoints. */
function finesApi(
  answer: (query: URLSearchParams) => Response | Promise<Response>,
  routes: Record<string, () => Response | Promise<Response>> = {},
) {
  let fetch!: ReturnType<typeof mockFetch>
  const queryOf = (index: number) => new URL(String(fetch.mock.calls[index][0])).searchParams
  fetch = mockFetch({ 'GET /admin/fines': () => answer(queryOf(fetch.mock.calls.length - 1)), ...routes })
  return Object.assign(fetch, { query: (index = fetch.mock.calls.length - 1) => queryOf(index) })
}

/** 60 fines in three pages of 25, 25 and 10. */
const threePages = () =>
  finesApi((q) => {
    const n = Number(q.get('page'))
    return json(200, page(rowsOfPage(n, n === 3 ? 10 : 25), 60, n))
  })

function renderPage() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <FinesPage />
      </ToastProvider>
    </LiveProvider>,
  )
}

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) })
const searchBox = () => screen.getByRole('textbox', { name: 'Search fines' })
const statusSelect = () => screen.getByRole('combobox', { name: 'Filter by status' })
const FINE_CHANGED: LiveEvent = { type: 'fine.changed', topics: ['fines'] }

afterEach(() => {
  vi.useRealTimers()
})

describe('Fines page', () => {
  it('shows the skeleton, then rows with reason labels, amounts and status tags', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = finesApi(async () => {
      await gate
      return json(200, page(ALL))
    })
    renderPage()
    expect(screen.getByLabelText('Loading fines')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('table')).toBeNull()

    release()
    const table = await screen.findByRole('table')
    expect(screen.queryByLabelText('Loading fines')).toBeNull()
    for (const heading of ['Student', 'Reason', 'Item', 'Amount', 'Status', 'Date']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }
    // The last column holds the row actions.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7)

    const overdue = within(rowOf('Clean Code'))
    expect(overdue.getByText('Rohan Verma')).toBeInTheDocument()
    expect(overdue.getByText('Overdue')).toBeInTheDocument()
    expect(overdue.getByText('₹150')).toBeInTheDocument()
    expect(overdue.getByText('Outstanding')).toHaveClass('tag', 'tag-accent')
    expect(overdue.getByText(dayLabel(0))).toBeInTheDocument() // the library's day, not the UTC one

    const accruing = within(rowOf('Introduction to Algorithms'))
    expect(accruing.getByText('Overdue')).toBeInTheDocument()
    expect(accruing.getByText('₹40')).toBeInTheDocument()
    expect(accruing.getByText('Accruing')).toHaveClass('tag', 'tag-accent')
    expect(accruing.getByText(dayLabel(-4))).toBeInTheDocument()

    const noShow = within(rowOf('Group Room 201'))
    expect(noShow.getByText('No-show')).toBeInTheDocument()
    expect(noShow.getByText('Paid')).toHaveClass('tag', 'tag-accent-2')

    const lost = within(rowOf('Computer Networks'))
    expect(lost.getByText('Lost book')).toBeInTheDocument()
    expect(lost.getByText('₹500')).toBeInTheDocument()

    expect(within(rowOf('Operating Systems')).getByText('Adjusted')).toHaveClass('tag', 'tag-accent-2')
    expect(within(rowOf('Database Systems')).getByText('Waived')).toHaveClass('tag', 'tag-accent-2')
    expect(screen.getByText('1–6 of 6 fines')).toBeInTheDocument()

    // Only the three rows the server says can be settled have actions, two each (a later test covers them); no row's tag is followed by a note.
    expect(within(table).getAllByRole('button')).toHaveLength(6)
    expect(overdue.getByText('Outstanding').closest('td')!.querySelectorAll('.text-muted')).toHaveLength(0)

    // The first request: page 1 of 25, no status (All), no search.
    expect(fetch).toHaveBeenCalledTimes(1)
    const q = fetch.query(0)
    expect(q.get('page')).toBe('1')
    expect(q.get('pageSize')).toBe('25')
    expect(q.has('status')).toBe(false)
    expect(q.has('search')).toBe(false)
  })

  it('an adjusted row shows "₹50 (was ₹150)", its note and who recorded it, or "the library"', async () => {
    finesApi(() => json(200, page([OVERDUE, ADJUSTED, WAIVED])))
    renderPage()
    await screen.findByRole('table')

    const adjusted = within(rowOf('Operating Systems'))
    expect(adjusted.getByText('₹50 (was ₹150)')).toBeInTheDocument()
    expect(adjusted.getByText('Student showed the receipt — Meera Iyer')).toHaveClass('text-muted')
    // The note sits under the tag, in the status cell.
    expect(adjusted.getByText('Adjusted').closest('td')).toContainElement(adjusted.getByText('Student showed the receipt — Meera Iyer'))

    // A waived fine has no recorder name: the library did it.
    const waived = within(rowOf('Database Systems'))
    expect(waived.getByText('₹0 (was ₹80)')).toBeInTheDocument()
    expect(waived.getByText('Book was already damaged — the library')).toHaveClass('text-muted')

    // An outstanding fine shows neither.
    const outstanding = within(rowOf('Clean Code'))
    expect(outstanding.queryByText(/was ₹/)).toBeNull()
    expect(outstanding.queryByText(/ — /)).toBeNull()
  })

  it('shows a note as text, never as markup', async () => {
    finesApi(() => json(200, page([fine({ id: 'f9', item: 'Tricky', status: 'waived', amount: 0, note: '<b>bold</b> & more', recordedBy: 'A <i>B</i>' })])))
    renderPage()
    expect(await screen.findByText('<b>bold</b> & more — A <i>B</i>')).toBeInTheDocument()
  })

  it('the student name is plain text', async () => {
    finesApi(() => json(200, page([OVERDUE])))
    renderPage()
    const name = await screen.findByText('Rohan Verma')
    expect(name.closest('a, button')).toBeNull()
  })

  it('keys a fine and an accruing row that share an id apart', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    finesApi(() => json(200, page([fine({ id: 'same', item: 'Fine Row' }), fine({ id: 'same', kind: 'accruing', status: 'accruing', item: 'Accruing Row' })])))
    renderPage()
    await screen.findByRole('table')
    expect(screen.getByText('Fine Row')).toBeInTheDocument()
    expect(screen.getByText('Accruing Row')).toBeInTheDocument()
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/)
    errors.mockRestore()
  })

  it('search waits 300 ms and sends one request', async () => {
    const fetch = finesApi(() => json(200, page(ALL)))
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
    const fetch = finesApi(() => json(200, page(ALL)))
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
    await screen.findByText('Book 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Book 026')
    expect(fetch.query().get('page')).toBe('2')

    fireEvent.change(searchBox(), { target: { value: 'rohan' } })
    await waitFor(() => expect(fetch.query().get('search')).toBe('rohan'), { timeout: 2_000 })
    expect(fetch.query().get('page')).toBe('1')
    expect(await screen.findByText('Book 001')).toBeInTheDocument()
  })

  it('the status select offers no Disputed option', async () => {
    finesApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findByRole('table')
    const options = within(statusSelect()).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All statuses', 'Accruing', 'Outstanding', 'Adjusted', 'Paid', 'Waived'])
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['all', 'accruing', 'outstanding', 'adjusted', 'paid', 'waived'])
    expect(screen.queryByRole('option', { name: /disputed/i })).toBeNull()
    expect(statusSelect()).toHaveValue('all')
  })

  it('changing the status returns to page 1', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Book 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Book 026')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Book 051')
    expect(fetch.query().get('page')).toBe('3')

    await userEvent.selectOptions(statusSelect(), 'outstanding')
    expect(statusSelect()).toHaveValue('outstanding')
    expect(fetch.query().get('status')).toBe('outstanding')
    expect(fetch.query().get('page')).toBe('1')
    expect(fetch.query().get('pageSize')).toBe('25')
    expect(await screen.findByText('Book 001')).toBeInTheDocument()

    // Back to All: the status parameter is dropped again.
    await userEvent.selectOptions(statusSelect(), 'all')
    expect(fetch.query().has('status')).toBe(false)
  })

  it('the pager moves and disables at the ends', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Book 001')
    const previous = screen.getByRole('button', { name: 'Previous' })
    const next = screen.getByRole('button', { name: 'Next' })
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('1–25 of 60 fines')).toBeInTheDocument()
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + 25

    await userEvent.click(next)
    expect(fetch.query().get('page')).toBe('2')
    expect(await screen.findByText('Book 026')).toBeInTheDocument()
    expect(screen.queryByText('Book 001')).toBeNull()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('26–50 of 60 fines')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(fetch.query().get('page')).toBe('3')
    expect(await screen.findByText('Book 051')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(11) // header + 10
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByText('51–60 of 60 fines')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(fetch.query().get('page')).toBe('2')
    expect(await screen.findByText('Book 026')).toBeInTheDocument()
  })

  it('has no pager when everything fits on one page', async () => {
    finesApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
  })

  it('no match shows Clear filters, which resets both filters', async () => {
    const fetch = finesApi((q) => json(200, q.has('status') || q.has('search') ? page([]) : page(ALL)))
    renderPage()
    await screen.findByRole('table')

    await userEvent.selectOptions(statusSelect(), 'waived')
    expect(await screen.findByText('No fines match these filters')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('0 fines')).toBeInTheDocument()

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

  it('says so when there are no fines at all, with no filter to clear', async () => {
    finesApi(() => json(200, page([])))
    renderPage()
    expect(await screen.findByText('No fines yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    expect(screen.queryByText('No fines match these filters')).toBeNull()
  })

  it('error state and Retry', async () => {
    let calls = 0
    const fetch = finesApi(() => (++calls === 1 ? json(500, { error: 'x' }) : json(200, page([OVERDUE]))))
    renderPage()
    expect(await screen.findByText("Couldn't load fines")).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    // The filters stay on screen, so the user can change them instead.
    expect(searchBox()).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Clean Code')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load fines")).toBeNull()
    expect(fetch.query().get('page')).toBe('1')
  })

  it('a failed page change shows the error, and Retry asks for that same page', async () => {
    let failing = false
    const fetch = finesApi((q) => {
      if (failing) return json(500, { error: 'x' })
      const n = Number(q.get('page'))
      return json(200, page(rowsOfPage(n, n === 3 ? 10 : 25), 60, n))
    })
    renderPage()
    await screen.findByText('Book 001')
    failing = true
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText("Couldn't load fines")).toBeInTheDocument()
    expect(screen.queryByText('Book 001')).toBeNull() // never page 1's rows under page 2

    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Book 026')).toBeInTheDocument()
    expect(fetch.query().get('page')).toBe('2')
  })

  it('a live fines event refetches quietly', async () => {
    let lists = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    finesApi(async () => {
      if (++lists === 1) return json(200, page([OVERDUE]))
      await gate
      return json(200, page([OVERDUE, { ...ADJUSTED }]))
    })
    renderPage()
    await screen.findByText('Clean Code')

    act(() => live.handlers!.onEvent({ ...FINE_CHANGED, topics: ['fines', 'metrics'] }))
    // The refetch starts after the 1 s debounce and is still pending: the rows stay and there is no skeleton.
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })
    expect(screen.queryByLabelText('Loading fines')).toBeNull()
    expect(screen.getByText('Clean Code')).toBeInTheDocument()

    release()
    expect(await screen.findByText('Operating Systems')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading fines')).toBeNull()
  })

  it('a live refetch keeps the filters and the page', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Book 001')
    await userEvent.selectOptions(statusSelect(), 'outstanding')
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Book 026')
    const before = fetch.mock.calls.length

    act(() => live.handlers!.onEvent(FINE_CHANGED))
    await waitFor(() => expect(fetch.mock.calls.length).toBe(before + 1), { timeout: 2_000 })
    expect(fetch.query().get('page')).toBe('2')
    expect(fetch.query().get('status')).toBe('outstanding')
    expect(statusSelect()).toHaveValue('outstanding')
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('a quiet refetch that fails keeps the rows', async () => {
    let lists = 0
    finesApi(() => (++lists === 1 ? json(200, page([OVERDUE])) : json(500, { error: 'x' })))
    renderPage()
    await screen.findByText('Clean Code')

    act(() => live.handlers!.onEvent(FINE_CHANGED))
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('Clean Code')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load fines")).toBeNull()
  })

  it('ignores a live event about something else', async () => {
    const fetch = finesApi(() => json(200, page([OVERDUE])))
    renderPage()
    await screen.findByText('Clean Code')
    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    await new Promise((resolve) => setTimeout(resolve, 1_300)) // longer than the 1 s debounce
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a live refetch that finds the current page gone moves back to the last page', async () => {
    let shrunk = false
    const fetch = finesApi((q) => {
      const n = Number(q.get('page'))
      // After the shrink there are 30 fines: page 3 is past the end.
      if (shrunk) return json(200, n > 2 ? page([], 30, n) : page(rowsOfPage(n, n === 2 ? 5 : 25), 30, n))
      return json(200, page(rowsOfPage(n, n === 3 ? 10 : 25), 60, n))
    })
    renderPage()
    await screen.findByText('Book 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Book 051')
    shrunk = true

    act(() => live.handlers!.onEvent(FINE_CHANGED))
    expect(await screen.findByText('Book 026', undefined, { timeout: 3_000 })).toBeInTheDocument()
    expect(fetch.query().get('page')).toBe('2')
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.queryByText('No fines match these filters')).toBeNull()
  })
})

describe('Fines page actions', () => {
  const rowButton = (name: string, button: 'Mark paid' | 'Waive / adjust') => within(rowOf(name)).getByRole('button', { name: button })
  const posts = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([, init]) => init?.method !== undefined && init.method !== 'GET')
  const listCalls = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/admin/fines')
  const gate = () => {
    let open!: () => void
    const promise = new Promise<void>((resolve) => {
      open = resolve
    })
    return { promise, open }
  }

  const paidOf = (f: AdminFine) => fine({ ...f, status: 'paid', canSettle: false })
  const adjustedTo = (f: AdminFine, amount: number) =>
    fine({ ...f, status: amount === 0 ? 'waived' : 'adjusted', amount, originalAmount: f.originalAmount, canSettle: amount !== 0, note: 'A reason', recordedBy: 'Meera Iyer' })

  const amountField = (dialog = screen.getByRole('dialog')) => within(dialog).getByLabelText('New amount (₹)')
  const reasonField = (dialog = screen.getByRole('dialog')) => within(dialog).getByLabelText('Reason (required)')
  const saveButton = (dialog = screen.getByRole('dialog')) => within(dialog).getByRole('button', { name: 'Save' })
  /** Replaces the amount box's text: an empty string just clears it. */
  async function setAmount(text: string) {
    const box = amountField()
    await userEvent.clear(box)
    if (text) await userEvent.type(box, text)
  }

  it('actions show only on outstanding and adjusted rows', async () => {
    // A fine the server says cannot be settled has none, whatever its status says.
    const locked = fine({ id: 'f6', item: 'Locked Row', status: 'outstanding', canSettle: false })
    finesApi(() => json(200, page([...ALL, locked])))
    renderPage()
    await screen.findByRole('table')

    for (const name of ['Clean Code', 'Computer Networks', 'Operating Systems']) {
      expect(rowButton(name, 'Mark paid')).toBeEnabled()
      expect(rowButton(name, 'Waive / adjust')).toBeEnabled()
    }
    // Accruing, paid, waived: no actions.
    for (const name of ['Introduction to Algorithms', 'Group Room 201', 'Database Systems', 'Locked Row']) {
      expect(within(rowOf(name)).queryByRole('button')).toBeNull()
    }
    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  it('Mark paid posts and toasts, then refetches', async () => {
    let served = 0
    const fetch = finesApi(() => json(200, page(++served === 1 ? [OVERDUE] : [paidOf(OVERDUE)])), {
      'POST /admin/fines/f1/paid': () => json(200, paidOf(OVERDUE)),
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Mark paid'))

    const dialog = screen.getByRole('dialog', { name: 'Mark this fine as paid?' })
    expect(dialog).toHaveTextContent('Rohan Verma — Clean Code, ₹150. Record this once the student has paid at the desk.')
    const confirm = within(dialog).getByRole('button', { name: 'Mark paid' })
    expect(confirm).toHaveFocus() // nothing to fill in: the shared Dialog does not move focus in by itself
    expect(posts(fetch)).toHaveLength(0)
    await userEvent.click(confirm)

    expect(await screen.findByText('Fine marked as paid.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)
    expect(String(posts(fetch)[0][0])).toMatch(/\/admin\/fines\/f1\/paid$/)
    expect(posts(fetch)[0][1]!.method).toBe('POST')
    // The amount the librarian saw on the row goes with it, so the server can refuse a fine that changed meanwhile.
    expect(posts(fetch)[0][1]!.body).toBe('{"amount":150}')

    // The list was asked for again and shows the outcome.
    const row = within(rowOf('Clean Code'))
    expect(await row.findByText('Paid')).toBeInTheDocument()
    expect(listCalls(fetch)).toHaveLength(2)
    expect(row.queryByRole('button')).toBeNull()
  })

  it('Mark paid on an adjusted fine sends its current amount, not the original', async () => {
    const fetch = finesApi(() => json(200, page([ADJUSTED])), {
      'POST /admin/fines/f4/paid': () => json(200, paidOf(ADJUSTED)),
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Operating Systems', 'Mark paid'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Aditi Sharma — Operating Systems, ₹50.')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }))
    await screen.findByText('Fine marked as paid.')
    expect(posts(fetch)[0][1]!.body).toBe('{"amount":50}')
  })

  it('Cancel in the Mark paid dialog sends nothing', async () => {
    const fetch = finesApi(() => json(200, page([OVERDUE])))
    renderPage()
    await screen.findByRole('table')
    const opener = rowButton('Clean Code', 'Mark paid')
    await userEvent.click(opener)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
    expect(posts(fetch)).toHaveLength(0)
    expect(listCalls(fetch)).toHaveLength(1)
  })

  it('the adjust dialog shows the canvas wording and starts at the current amount', async () => {
    const fetch = finesApi(() => json(200, page([OVERDUE])))
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))

    const dialog = screen.getByRole('dialog', { name: 'Waive or adjust this fine' })
    expect(dialog).toHaveTextContent(
      "Rohan Verma — Clean Code, currently ₹150. Enter the new amount (₹0 fully waives it) and a reason; this is recorded on the student's fine history.",
    )
    const amount = amountField(dialog)
    expect(amount).toHaveAttribute('type', 'number')
    expect(amount).toHaveAttribute('min', '0')
    expect(amount).toHaveValue(150)
    expect(amount).toHaveFocus() // the first field takes focus
    const reason = reasonField(dialog)
    expect(reason).toHaveValue('')
    expect(reason).toHaveAttribute('placeholder', 'Why is this fine being waived or adjusted?')
    expect(reason).toHaveAttribute('maxlength', '300')
    expect(saveButton(dialog)).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(posts(fetch)).toHaveLength(0)
  })

  it('Save stays disabled with a blank reason, an equal or higher amount, or a fraction', async () => {
    const fetch = finesApi(() => json(200, page([OVERDUE])))
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))
    const dialog = screen.getByRole('dialog')

    // The amount starts equal to the current one, so nothing is savable yet.
    expect(saveButton(dialog)).toBeDisabled()
    await userEvent.type(reasonField(dialog), 'Receipt shown')
    expect(saveButton(dialog)).toBeDisabled() // equal to ₹150

    await setAmount('151')
    expect(saveButton(dialog)).toBeDisabled() // higher
    await setAmount('149.5')
    expect(saveButton(dialog)).toBeDisabled() // a fraction
    await setAmount('-1')
    expect(saveButton(dialog)).toBeDisabled() // below zero
    await setAmount('')
    expect(saveButton(dialog)).toBeDisabled() // empty
    fireEvent.change(amountField(dialog), { target: { value: '1e1' } }) // typing 'e' is dropped by the test DOM, so set it whole
    expect(saveButton(dialog)).toBeDisabled() // ten, but not written as a whole number
    await setAmount('149')
    expect(saveButton(dialog)).toBeEnabled()

    await userEvent.clear(reasonField(dialog))
    await userEvent.type(reasonField(dialog), '   ')
    expect(saveButton(dialog)).toBeDisabled() // a blank reason
    await userEvent.type(reasonField(dialog), 'ok')
    expect(saveButton(dialog)).toBeEnabled()

    await setAmount('0')
    expect(saveButton(dialog)).toBeEnabled() // ₹0 fully waives it
    expect(posts(fetch)).toHaveLength(0)
  })

  it('adjusting to 0 sends amount 0 and toasts "Fine waived."', async () => {
    let served = 0
    const waived = adjustedTo(OVERDUE, 0)
    const fetch = finesApi(() => json(200, page(++served === 1 ? [OVERDUE] : [waived])), {
      'POST /admin/fines/f1/adjust': () => json(200, waived),
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))
    await setAmount('0')
    await userEvent.type(reasonField(screen.getByRole('dialog')), '  Book was already damaged ')
    await userEvent.click(saveButton())

    expect(await screen.findByText('Fine waived.')).toBeInTheDocument()
    expect(screen.queryByText('Fine adjusted.')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)
    expect(String(posts(fetch)[0][0])).toMatch(/\/admin\/fines\/f1\/adjust$/)
    expect(posts(fetch)[0][1]!.method).toBe('POST')
    expect(posts(fetch)[0][1]!.body).toBe('{"amount":0,"reason":"Book was already damaged"}')

    const row = within(rowOf('Clean Code'))
    expect(await row.findByText('Waived')).toBeInTheDocument()
    expect(row.getByText('₹0 (was ₹150)')).toBeInTheDocument()
    expect(row.queryByRole('button')).toBeNull()
    expect(listCalls(fetch)).toHaveLength(2)
  })

  it('adjusting lower toasts "Fine adjusted."', async () => {
    let served = 0
    const adjusted = adjustedTo(OVERDUE, 50)
    const fetch = finesApi(() => json(200, page(++served === 1 ? [OVERDUE] : [adjusted])), {
      'POST /admin/fines/f1/adjust': () => json(200, adjusted),
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))
    await setAmount('50')
    await userEvent.type(reasonField(screen.getByRole('dialog')), 'Student showed the receipt')
    await userEvent.click(saveButton())

    expect(await screen.findByText('Fine adjusted.')).toBeInTheDocument()
    expect(screen.queryByText('Fine waived.')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)
    // The amount goes as a number, not as the text of the box.
    expect(posts(fetch)[0][1]!.body).toBe('{"amount":50,"reason":"Student showed the receipt"}')

    const row = within(rowOf('Clean Code'))
    expect(await row.findByText('₹50 (was ₹150)')).toBeInTheDocument()
    expect(row.getByText('Adjusted')).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Mark paid' })).toBeEnabled() // an adjusted fine can still be settled
  })

  it('an adjusted fine is adjusted again from its current amount', async () => {
    const fetch = finesApi(() => json(200, page([ADJUSTED])), {
      'POST /admin/fines/f4/adjust': () => json(200, adjustedTo(ADJUSTED, 20)),
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Operating Systems', 'Waive / adjust'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Aditi Sharma — Operating Systems, currently ₹50.')
    expect(amountField(dialog)).toHaveValue(50) // not the original ₹150
    await userEvent.type(reasonField(dialog), 'Second look')
    expect(saveButton(dialog)).toBeDisabled() // equal to ₹50
    await setAmount('51')
    expect(saveButton(dialog)).toBeDisabled() // higher than ₹50, though lower than the original ₹150
    await setAmount('20')
    expect(saveButton(dialog)).toBeEnabled()
    await userEvent.click(saveButton(dialog))
    await screen.findByText('Fine adjusted.')
    expect(posts(fetch)[0][1]!.body).toBe('{"amount":20,"reason":"Second look"}')
  })

  it("a 409 shows the server's message and refetches", async () => {
    let served = 0
    const fetch = finesApi(
      () => {
        served += 1
        if (served === 1) return json(200, page([OVERDUE, LOST]))
        if (served === 2) return json(200, page([paidOf(OVERDUE), LOST]))
        return json(200, page([paidOf(OVERDUE), adjustedTo(LOST, 0)]))
      },
      {
        'POST /admin/fines/f1/paid': () => json(409, { error: 'This fine is already paid.' }),
        'POST /admin/fines/f3/adjust': () => json(409, { error: 'This fine was waived.' }),
      },
    )
    renderPage()
    await screen.findByRole('table')

    // Mark paid, refused: someone already did.
    await userEvent.click(rowButton('Clean Code', 'Mark paid'))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }))
    expect(await screen.findByText('This fine is already paid.')).toBeInTheDocument()
    expect(screen.queryByText('Fine marked as paid.')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)
    // The list is fetched again, so the row shows what really happened and offers nothing.
    expect(await within(rowOf('Clean Code')).findByText('Paid')).toBeInTheDocument()
    expect(listCalls(fetch)).toHaveLength(2)
    expect(within(rowOf('Clean Code')).queryByRole('button')).toBeNull()
    await waitFor(() => expect(rowButton('Computer Networks', 'Waive / adjust')).toBeEnabled())

    // Adjust, refused the same way.
    await userEvent.click(rowButton('Computer Networks', 'Waive / adjust'))
    await userEvent.type(reasonField(screen.getByRole('dialog')), 'Too late')
    await setAmount('0')
    await userEvent.click(saveButton())
    expect(await screen.findByText('This fine was waived.')).toBeInTheDocument()
    expect(screen.queryByText('Fine waived.')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(2)
    expect(await within(rowOf('Computer Networks')).findByText('Waived')).toBeInTheDocument()
    expect(listCalls(fetch)).toHaveLength(3)
    expect(within(rowOf('Computer Networks')).queryByRole('button')).toBeNull()
  })

  it(`a 409 "This fine was just changed…" on Mark paid shows the server's message and refetches`, async () => {
    const lowered = adjustedTo(OVERDUE, 100)
    let served = 0
    const fetch = finesApi(() => json(200, page(++served === 1 ? [OVERDUE] : [lowered])), {
      'POST /admin/fines/f1/paid': () => json(409, { error: 'This fine was just changed to ₹100. Check it before marking it paid.' }),
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Mark paid'))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }))

    expect(await screen.findByText('This fine was just changed to ₹100. Check it before marking it paid.')).toBeInTheDocument()
    expect(screen.queryByText('Fine marked as paid.')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    // The request carried the ₹150 the librarian saw.
    expect(posts(fetch)).toHaveLength(1)
    expect(posts(fetch)[0][1]!.body).toBe('{"amount":150}')

    // The list is fetched again: the row shows its new amount and can still be settled.
    const row = within(rowOf('Clean Code'))
    expect(await row.findByText('₹100 (was ₹150)')).toBeInTheDocument()
    expect(listCalls(fetch)).toHaveLength(2)
    await waitFor(() => expect(rowButton('Clean Code', 'Mark paid')).toBeEnabled())

    // Checking it again shows the new amount in the dialog.
    await userEvent.click(rowButton('Clean Code', 'Mark paid'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Rohan Verma — Clean Code, ₹100.')
  })

  it("a 400 on adjust shows the server's message", async () => {
    finesApi(() => json(200, page([OVERDUE])), {
      'POST /admin/fines/f1/adjust': () => json(400, { error: 'The new amount must be lower than ₹100.' }),
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))
    // 120 is below the ₹150 this console shows, but the server's amount is lower by now: its refusal is shown as given.
    await setAmount('120')
    await userEvent.type(reasonField(screen.getByRole('dialog')), 'Stale')
    await userEvent.click(saveButton())
    expect(await screen.findByText('The new amount must be lower than ₹100.')).toBeInTheDocument()
  })

  it('buttons stay disabled until the refetch returns', async () => {
    const other = fine({ id: 'f7', student: ADITI, item: 'Another Book', amount: 90, originalAmount: 90 })
    const posting = gate()
    const refetching = gate()
    let served = 0
    finesApi(
      async () => {
        if (++served === 1) return json(200, page([OVERDUE, other]))
        await refetching.promise
        return json(200, page([paidOf(OVERDUE), other]))
      },
      {
        'POST /admin/fines/f1/paid': async () => {
          await posting.promise
          return json(200, paidOf(OVERDUE))
        },
      },
    )
    renderPage()
    await screen.findByRole('table')
    expect(rowButton('Another Book', 'Mark paid')).toBeEnabled()
    await userEvent.click(rowButton('Clean Code', 'Mark paid'))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }))

    // The write is in flight: every action on every row is disabled.
    for (const name of ['Clean Code', 'Another Book']) {
      for (const label of ['Mark paid', 'Waive / adjust'] as const) expect(rowButton(name, label)).toBeDisabled()
    }

    // The write is over, but the list is not back yet: still disabled, because the old row is still on screen.
    posting.open()
    expect(await screen.findByText('Fine marked as paid.')).toBeInTheDocument()
    expect(rowButton('Another Book', 'Mark paid')).toBeDisabled()
    expect(rowButton('Another Book', 'Waive / adjust')).toBeDisabled()
    expect(rowButton('Clean Code', 'Mark paid')).toBeDisabled()

    refetching.open()
    await waitFor(() => expect(rowButton('Another Book', 'Mark paid')).toBeEnabled())
    expect(rowButton('Another Book', 'Waive / adjust')).toBeEnabled()
    expect(within(rowOf('Clean Code')).queryByRole('button')).toBeNull()
  })

  it('a second click while in flight sends nothing', async () => {
    const other = fine({ id: 'f7', student: ADITI, item: 'Another Book', amount: 90, originalAmount: 90 })
    const posting = gate()
    const refetching = gate()
    let served = 0
    const fetch = finesApi(
      async () => {
        if (++served === 1) return json(200, page([OVERDUE, other]))
        await refetching.promise
        return json(200, page([paidOf(OVERDUE), other]))
      },
      {
        'POST /admin/fines/f1/paid': async () => {
          await posting.promise
          return json(200, paidOf(OVERDUE))
        },
        'POST /admin/fines/f7/adjust': () => json(200, adjustedTo(other, 0)),
      },
    )
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Mark paid'))
    // A double click on the confirm button is one write.
    await userEvent.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)

    // Clicks on the disabled actions of any row open no dialog and send nothing.
    await userEvent.click(rowButton('Another Book', 'Waive / adjust'))
    await userEvent.click(rowButton('Another Book', 'Mark paid'))
    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)

    posting.open()
    await screen.findByText('Fine marked as paid.')
    refetching.open()
    await waitFor(() => expect(rowButton('Another Book', 'Mark paid')).toBeEnabled())
    expect(posts(fetch)).toHaveLength(1)
    expect(listCalls(fetch)).toHaveLength(2)
  })

  it('Escape closes either dialog and returns focus', async () => {
    const fetch = finesApi(() => json(200, page([OVERDUE])))
    renderPage()
    await screen.findByRole('table')

    const markPaid = rowButton('Clean Code', 'Mark paid')
    await userEvent.click(markPaid)
    expect(screen.getByRole('dialog', { name: 'Mark this fine as paid?' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(markPaid).toHaveFocus()

    const adjust = rowButton('Clean Code', 'Waive / adjust')
    await userEvent.click(adjust)
    expect(screen.getByRole('dialog', { name: 'Waive or adjust this fine' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(adjust).toHaveFocus()
    expect(posts(fetch)).toHaveLength(0)
  })

  it('reopening the adjust dialog starts from a clean form', async () => {
    finesApi(() => json(200, page([OVERDUE])))
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))
    await setAmount('20')
    await userEvent.type(reasonField(screen.getByRole('dialog')), 'Typed then abandoned')
    await userEvent.keyboard('{Escape}')

    await userEvent.click(rowButton('Clean Code', 'Waive / adjust'))
    expect(amountField()).toHaveValue(150)
    expect(reasonField()).toHaveValue('')
  })

  it('the dialogs show names as text, never as markup', async () => {
    finesApi(() => json(200, page([fine({ id: 'f8', student: { id: 's9', name: 'A <b>B</b>', email: 'x@example.edu' }, item: '<i>Odd</i> & Co' })])))
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('A <b>B</b> — <i>Odd</i> & Co, ₹150.')
    expect(screen.getByRole('dialog').querySelector('b, i')).toBeNull()
  })
})
