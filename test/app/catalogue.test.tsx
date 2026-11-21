import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CataloguePage from '@/app/(console)/catalogue/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { AdminBook, AdminCopy, BooksPage } from '@/lib/catalogue'
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

const ROHAN = { id: 's2', name: 'Rohan Verma' }

function copy(over: Partial<AdminCopy> & Pick<AdminCopy, 'id' | 'barcode'>): AdminCopy {
  return { status: 'available', borrower: null, dueAt: null, owedReplacement: null, ...over }
}

function book(over: Partial<AdminBook> & Pick<AdminBook, 'id' | 'title'>): AdminBook {
  const copies = over.copies ?? [copy({ id: `${over.id}-c1`, barcode: `${over.id.toUpperCase()}-01` })]
  return {
    isbn: `978-${over.id}`, author: 'Some Author', genre: 'Computer Science', description: null, publishedYear: null,
    totalCopies: copies.length, availableCopies: copies.filter((c) => c.status === 'available').length, ...over, copies,
  }
}

// 20:30 UTC three days on is 02:00 the day after in the library's zone: the chip shows that day, not the UTC one.
const ALGORITHMS = book({
  id: 'b1', isbn: '9780262046305', title: 'Introduction to Algorithms', author: 'Cormen, Leiserson, Rivest, Stein', genre: 'Computer Science',
  description: 'The standard text.', publishedYear: 2022,
  // The server counts copies that are not lost: 1 of 4, though five chips show.
  totalCopies: 4, availableCopies: 1,
  copies: [
    copy({ id: 'c1', barcode: 'CS-ALG-01', status: 'on_loan', borrower: ROHAN, dueAt: at(3, 20.5) }),
    copy({ id: 'c2', barcode: 'CS-ALG-02', status: 'available' }),
    copy({ id: 'c3', barcode: 'CS-ALG-03', status: 'held' }),
    copy({ id: 'c4', barcode: 'CS-ALG-04', status: 'maintenance' }),
    copy({ id: 'c5', barcode: 'CS-ALG-05', status: 'lost' }),
  ],
})
const NOVEL = book({
  id: 'b2', isbn: '9780140449136', title: 'The Brothers Karamazov', author: 'Fyodor Dostoevsky', genre: 'Fiction',
  copies: [copy({ id: 'c6', barcode: 'FIC-BK-01' }), copy({ id: 'c7', barcode: 'FIC-BK-02' })],
})
const ALL = [ALGORITHMS, NOVEL]
const GENRES = ['Computer Science', 'Fiction']

const page = (books: AdminBook[], total = books.length, pageNumber = 1, genres = GENRES): BooksPage => ({
  books, total, page: pageNumber, pageSize: 25, genres,
})

/** `count` one-copy books for one page of a long list, titled "Book 001"... */
const booksOfPage = (pageNumber: number, count = 25): AdminBook[] =>
  Array.from({ length: count }, (_, i) => {
    const n = (pageNumber - 1) * 25 + i + 1
    return book({ id: `p${n}`, title: `Book ${String(n).padStart(3, '0')}` })
  })

/** The list endpoint: `answer` sees the query of the request being served. `routes` adds the write endpoints. */
function booksApi(
  answer: (query: URLSearchParams) => Response | Promise<Response>,
  routes: Record<string, () => Response | Promise<Response>> = {},
) {
  let fetch!: ReturnType<typeof mockFetch>
  const queryOf = (index: number) => new URL(String(fetch.mock.calls[index][0])).searchParams
  fetch = mockFetch({ 'GET /admin/books': () => answer(queryOf(fetch.mock.calls.length - 1)), ...routes })
  return Object.assign(fetch, { query: (index = fetch.mock.calls.length - 1) => queryOf(index) })
}

/** 60 books in three pages of 25, 25 and 10. */
const threePages = () =>
  booksApi((q) => {
    const n = Number(q.get('page'))
    return json(200, page(booksOfPage(n, n === 3 ? 10 : 25), 60, n))
  })

function renderPage() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <CataloguePage />
      </ToastProvider>
    </LiveProvider>,
  )
}

/** A promise the test settles by hand. */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const cardOf = (title: string) => screen.getByRole('article', { name: title })
const chipOf = (barcode: string) => screen.getByText(barcode).closest('li')!
const searchBox = () => screen.getByRole('textbox', { name: 'Search books' })
const CATALOGUE_CHANGED: LiveEvent = { type: 'catalogue.changed', topics: ['catalogue'] }
const writes = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([, init]) => init?.method !== 'GET')
// Adding a book is a POST to the list's own path, so the method tells the two apart.
const listCalls = (fetch: ReturnType<typeof mockFetch>) =>
  fetch.mock.calls.filter(([url, init]) => new URL(String(url)).pathname === '/admin/books' && init?.method === 'GET')

afterEach(() => {
  vi.useRealTimers()
})

describe('Catalogue page', () => {
  it('shows the skeleton then book cards with copy chips and availability', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = booksApi(async () => {
      await gate
      return json(200, page(ALL))
    })
    renderPage()
    expect(screen.getByLabelText('Loading the catalogue')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('article')).toBeNull()

    release()
    expect(await screen.findAllByRole('article')).toHaveLength(2)
    expect(screen.queryByLabelText('Loading the catalogue')).toBeNull()

    const card = within(cardOf('Introduction to Algorithms'))
    expect(card.getByText('Introduction to Algorithms')).toBeInTheDocument()
    expect(card.getByText('Cormen, Leiserson, Rivest, Stein')).toBeInTheDocument()
    expect(card.getByText('Computer Science')).toHaveClass('tag', 'tag-neutral')
    // The server's counts, not the number of chips: five chips, but one is lost.
    expect(card.getByText('1 of 4 available')).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(card.getByRole('button', { name: '+ Copies' })).toBeEnabled()

    // A chip per copy, in the server's order, with the canvas's tag for each status.
    expect(card.getAllByRole('listitem').map((li) => li.textContent?.slice(0, 9))).toEqual([
      'CS-ALG-01', 'CS-ALG-02', 'CS-ALG-03', 'CS-ALG-04', 'CS-ALG-05',
    ])
    expect(within(chipOf('CS-ALG-02')).getByText('Available')).toHaveClass('tag', 'tag-accent-2')
    expect(within(chipOf('CS-ALG-01')).getByText('On loan')).toHaveClass('tag', 'tag-neutral')
    expect(within(chipOf('CS-ALG-03')).getByText('Held')).toHaveClass('tag', 'tag-neutral')
    expect(within(chipOf('CS-ALG-04')).getByText('Maintenance')).toHaveClass('tag', 'tag-accent')
    expect(within(chipOf('CS-ALG-05')).getByText('Lost')).toHaveClass('tag', 'tag-accent')

    const novel = within(cardOf('The Brothers Karamazov'))
    expect(novel.getByText('Fiction')).toHaveClass('tag')
    expect(novel.getByText('2 of 2 available')).toBeInTheDocument()
    expect(novel.getAllByRole('listitem')).toHaveLength(2)

    expect(screen.getByText('1–2 of 2 titles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add book' })).toBeEnabled()
    expect(screen.getByPlaceholderText('Search title, author, ISBN or barcode')).toBe(searchBox())

    // The first request: page 1 of 25, no search.
    expect(fetch).toHaveBeenCalledTimes(1)
    const q = fetch.query(0)
    expect(q.get('page')).toBe('1')
    expect(q.get('pageSize')).toBe('25')
    expect(q.has('search')).toBe(false)
  })

  it('shows a book without a genre as a card without a genre tag', async () => {
    booksApi(() => json(200, page([book({ id: 'b3', title: 'Untagged', genre: null })])))
    renderPage()
    const card = within(await screen.findByRole('article', { name: 'Untagged' }))
    expect(card.queryByText('Computer Science')).toBeNull()
    expect(card.getByText('1 of 1 available')).toBeInTheDocument()
  })

  it('an on-loan chip names the borrower and due date', async () => {
    const noName = book({
      id: 'b4', title: 'Seed Book',
      copies: [copy({ id: 'c9', barcode: 'SEED-01', status: 'on_loan' }), copy({ id: 'c10', barcode: 'SEED-02', status: 'available' })],
    })
    booksApi(() => json(200, page([ALGORITHMS, noName])))
    renderPage()
    await screen.findAllByRole('article')

    // Shown in the library's day (20:30 UTC is already the next morning there), with the middle dot.
    const loaned = within(chipOf('CS-ALG-01'))
    expect(loaned.getByText('On loan')).toBeInTheDocument()
    expect(loaned.getByText(`Rohan Verma · due ${dayLabel(4)}`)).toBeInTheDocument()
    // Only an on-loan copy has the line.
    for (const barcode of ['CS-ALG-02', 'CS-ALG-03', 'CS-ALG-04', 'CS-ALG-05']) {
      expect(chipOf(barcode).textContent).not.toMatch(/due|·/)
    }
    // A copy marked borrowed with no open loan (seed data) shows just the tag, and its one action.
    expect(within(chipOf('SEED-01')).getByText('On loan')).toBeInTheDocument()
    expect(chipOf('SEED-01').textContent).toBe('SEED-01On loanLost')
  })

  it('shows the borrower as text, never as markup', async () => {
    booksApi(() =>
      json(200, page([book({
        id: 'b5', title: 'Tricky',
        copies: [copy({ id: 'c11', barcode: 'TR-01', status: 'on_loan', borrower: { id: 's9', name: 'A <b>B</b>' }, dueAt: at(3, 8.5) })],
      })])),
    )
    renderPage()
    expect(await screen.findByText(`A <b>B</b> · due ${dayLabel(3)}`)).toBeInTheDocument()
    expect(chipOf('TR-01').querySelector('b')).toBeNull()
  })

  it('search waits 300 ms', async () => {
    const fetch = booksApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findAllByRole('article')
    expect(fetch).toHaveBeenCalledTimes(1)

    // From here on time is fake (but keeps running, so Testing Library's polling still works).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.change(searchBox(), { target: { value: 'c' } })
    act(() => void vi.advanceTimersByTime(200))
    fireEvent.change(searchBox(), { target: { value: 'cs-alg' } }) // typing again restarts the wait
    act(() => void vi.advanceTimersByTime(299))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(searchBox()).toHaveValue('cs-alg') // the box itself never waits

    // 301 ms after the last keystroke, with no real waiting in between: the request is out.
    await act(async () => void vi.advanceTimersByTime(2))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.query().get('search')).toBe('cs-alg')
    expect(fetch.query().get('page')).toBe('1')
    expect(fetch.query().get('pageSize')).toBe('25')

    await act(async () => void vi.advanceTimersByTime(1_000))
    expect(fetch).toHaveBeenCalledTimes(2) // one request, not one per keystroke
  })

  it('a new search returns to page 1', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByRole('article', { name: 'Book 001' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('article', { name: 'Book 026' })
    expect(fetch.query().get('page')).toBe('2')

    fireEvent.change(searchBox(), { target: { value: 'book' } })
    await waitFor(() => expect(fetch.query().get('search')).toBe('book'), { timeout: 2_000 })
    expect(fetch.query().get('page')).toBe('1')
    expect(await screen.findByRole('article', { name: 'Book 001' })).toBeInTheDocument()
  })

  it('no match shows Clear search', async () => {
    const fetch = booksApi((q) => json(200, q.has('search') ? page([]) : page(ALL)))
    renderPage()
    await screen.findAllByRole('article')

    fireEvent.change(searchBox(), { target: { value: 'nobody' } })
    expect(await screen.findByText('No books match your search', undefined, { timeout: 2_000 })).toBeInTheDocument()
    expect(fetch.query().get('search')).toBe('nobody')
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText('0 titles')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(searchBox()).toHaveValue('')
    expect(await screen.findAllByRole('article')).toHaveLength(2)
    expect(fetch.query().has('search')).toBe(false)
    expect(fetch.query().get('page')).toBe('1')
    // Clearing the box is immediate: it does not wait out a debounce.
    const calls = fetch.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(fetch.mock.calls.length).toBe(calls)
  })

  it('says so when there are no books at all, with no search to clear', async () => {
    booksApi(() => json(200, page([], 0, 1, [])))
    renderPage()
    expect(await screen.findByText('No books yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(screen.queryByText('No books match your search')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add book' })).toBeEnabled()
  })

  it('error state and Retry', async () => {
    let calls = 0
    const fetch = booksApi(() => (++calls === 1 ? json(500, { error: 'x' }) : json(200, page([NOVEL]))))
    renderPage()
    expect(await screen.findByText("Couldn't load the catalogue")).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
    // The search stays on screen, so the user can change it instead.
    expect(searchBox()).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('The Brothers Karamazov')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the catalogue")).toBeNull()
    expect(fetch.query().get('page')).toBe('1')
  })

  it('a failed page change shows the error, and Retry asks for that same page', async () => {
    let failing = false
    const fetch = booksApi((q) => {
      if (failing) return json(500, { error: 'x' })
      const n = Number(q.get('page'))
      return json(200, page(booksOfPage(n, n === 3 ? 10 : 25), 60, n))
    })
    renderPage()
    await screen.findByText('Book 001')
    failing = true
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText("Couldn't load the catalogue")).toBeInTheDocument()
    expect(screen.queryByText('Book 001')).toBeNull() // never page 1's books under page 2

    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Book 026')).toBeInTheDocument()
    expect(fetch.query().get('page')).toBe('2')
  })

  it('pager', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Book 001')
    const previous = screen.getByRole('button', { name: 'Previous' })
    const next = screen.getByRole('button', { name: 'Next' })
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('1–25 of 60 titles')).toBeInTheDocument()
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()
    expect(screen.getAllByRole('article')).toHaveLength(25)

    await userEvent.click(next)
    expect(fetch.query().get('page')).toBe('2')
    expect(await screen.findByText('Book 026')).toBeInTheDocument()
    expect(screen.queryByText('Book 001')).toBeNull()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('26–50 of 60 titles')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(fetch.query().get('page')).toBe('3')
    expect(await screen.findByText('Book 051')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(10)
    expect(screen.getByText('51–60 of 60 titles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(fetch.query().get('page')).toBe('2')
    expect(await screen.findByText('Book 026')).toBeInTheDocument()
  })

  it('has no pager when everything fits on one page', async () => {
    booksApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findAllByRole('article')
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
  })

  it('a live catalogue event refetches quietly', async () => {
    let lists = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    booksApi(async () => {
      if (++lists === 1) return json(200, page([ALGORITHMS]))
      await gate
      return json(200, page([ALGORITHMS, NOVEL]))
    })
    renderPage()
    await screen.findByText('Introduction to Algorithms')

    act(() => live.handlers!.onEvent({ ...CATALOGUE_CHANGED, topics: ['catalogue', 'metrics'] }))
    // The refetch starts after the 1 s debounce and is still pending: the books stay and there is no skeleton.
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })
    expect(screen.queryByLabelText('Loading the catalogue')).toBeNull()
    expect(screen.getByText('Introduction to Algorithms')).toBeInTheDocument()

    release()
    expect(await screen.findByText('The Brothers Karamazov')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading the catalogue')).toBeNull()
  })

  it('a live requests event refetches too, because a pending request holds a copy', async () => {
    let lists = 0
    booksApi(() => json(200, page(++lists === 1 ? [NOVEL] : [ALGORITHMS])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    act(() => live.handlers!.onEvent({ type: 'request.created', topics: ['requests'] }))
    expect(await screen.findByText('Introduction to Algorithms', undefined, { timeout: 2_000 })).toBeInTheDocument()
    expect(lists).toBe(2)
  })

  it('a live refetch keeps the search and the page', async () => {
    const fetch = threePages()
    renderPage()
    await screen.findByText('Book 001')
    fireEvent.change(searchBox(), { target: { value: 'book' } })
    await waitFor(() => expect(fetch.query().get('search')).toBe('book'), { timeout: 2_000 })
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Book 026')
    const before = fetch.mock.calls.length

    act(() => live.handlers!.onEvent(CATALOGUE_CHANGED))
    await waitFor(() => expect(fetch.mock.calls.length).toBe(before + 1), { timeout: 2_000 })
    expect(fetch.query().get('page')).toBe('2')
    expect(fetch.query().get('search')).toBe('book')
    expect(searchBox()).toHaveValue('book')
  })

  it('ignores a live event about something else', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    await new Promise((resolve) => setTimeout(resolve, 1_300)) // longer than the 1 s debounce
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('Catalogue page book forms', () => {
  const dialogOf = (name: string) => screen.getByRole('dialog', { name })
  const field = (dialog: HTMLElement, label: string) => within(dialog).getByLabelText(label)
  const confirmOf = (dialog: HTMLElement, label: string) => within(dialog).getByRole('button', { name: label })

  /** Types `text` into a field, replacing whatever it held. */
  async function fill(dialog: HTMLElement, label: string, text: string) {
    const box = field(dialog, label)
    await userEvent.clear(box)
    if (text) await userEvent.type(box, text)
  }

  async function openAdd() {
    await userEvent.click(screen.getByRole('button', { name: 'Add book' }))
    return dialogOf('Add a book')
  }

  async function fillRequired(dialog: HTMLElement) {
    await fill(dialog, 'ISBN', '9780132350884')
    await fill(dialog, 'Title', 'Clean Code')
    await fill(dialog, 'Author', 'Robert C. Martin')
    await fill(dialog, 'Genre', 'Computer Science')
  }

  const CLEAN_CODE = book({
    id: 'b9', isbn: '9780132350884', title: 'Clean Code', author: 'Robert C. Martin', genre: 'Computer Science',
    copies: [copy({ id: 'c20', barcode: 'CS-CC-01' }), copy({ id: 'c21', barcode: 'CS-CC-02' }), copy({ id: 'c22', barcode: 'CS-CC-03' })],
  })

  it('Add book posts the form with copies and the list refetches', async () => {
    let served = 0
    const fetch = booksApi(() => json(200, page(++served === 1 ? [NOVEL] : [CLEAN_CODE, NOVEL])), {
      'POST /admin/books': () => json(201, CLEAN_CODE),
    })
    renderPage()
    await screen.findByText('The Brothers Karamazov')

    const dialog = await openAdd()
    expect(dialog).toHaveTextContent('New title added to the catalogue with its copies.')
    expect(field(dialog, 'ISBN')).toHaveFocus() // the first field takes focus
    expect(field(dialog, 'Copies')).toHaveValue(1)
    expect(writes(fetch)).toHaveLength(0)

    await fill(dialog, 'ISBN', ' 9780132350884 ')
    await fill(dialog, 'Title', '  Clean Code ')
    await fill(dialog, 'Author', 'Robert C. Martin')
    await fill(dialog, 'Genre', 'Computer Science')
    await fill(dialog, 'Description', 'A handbook of agile software craftsmanship.')
    await fill(dialog, 'Published year', '2008')
    await fill(dialog, 'Copies', '3')
    await userEvent.click(confirmOf(dialog, 'Add book'))

    expect(await screen.findByText('Book added.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) // it closes once the save has landed
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/books$/)
    expect(writes(fetch)[0][1]!.method).toBe('POST')
    expect(writes(fetch)[0][1]!.body).toBe(
      '{"isbn":"9780132350884","title":"Clean Code","author":"Robert C. Martin","genre":"Computer Science","description":"A handbook of agile software craftsmanship.","publishedYear":2008,"copies":3}',
    )

    // The list was asked for again and shows the new title with its copies.
    const card = within(await screen.findByRole('article', { name: 'Clean Code' }))
    expect(card.getAllByRole('listitem')).toHaveLength(3)
    expect(listCalls(fetch)).toHaveLength(2)
  })

  it('Add book closes after a successful save', async () => {
    const saving = gate()
    const refetching = gate()
    let served = 0
    const fetch = booksApi(
      async () => {
        if (++served === 1) return json(200, page([NOVEL]))
        await refetching.promise
        return json(200, page([CLEAN_CODE, NOVEL]))
      },
      {
        'POST /admin/books': async () => {
          await saving.promise
          return json(201, CLEAN_CODE)
        },
      },
    )
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    await fill(dialog, 'Description', 'A handbook.')
    await userEvent.click(confirmOf(dialog, 'Add book'))

    // The save is in flight: the dialog stays, with its values, and cannot be confirmed again.
    expect(writes(fetch)).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Add a book' })).toBeInTheDocument()
    expect(confirmOf(dialog, 'Add book')).toBeDisabled()
    expect(field(dialog, 'ISBN')).toHaveValue('9780132350884')
    expect(field(dialog, 'Description')).toHaveValue('A handbook.')
    fireEvent.submit(confirmOf(dialog, 'Add book').closest('form')!) // Enter in a field is no way round the disabled button
    expect(writes(fetch)).toHaveLength(1)

    // The save landed but the list is not back yet: still open.
    saving.open()
    expect(await screen.findByText('Book added.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Add a book' })).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)

    refetching.open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('article', { name: 'Clean Code' })).toBeInTheDocument()
    // Focus went back to the button that opened the dialog.
    expect(screen.getByRole('button', { name: 'Add book' })).toHaveFocus()
  })

  it('Add book with only the required fields sends null for the description and the year', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])), { 'POST /admin/books': () => json(201, CLEAN_CODE) })
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    await userEvent.click(confirmOf(dialog, 'Add book'))
    await screen.findByText('Book added.')
    expect(writes(fetch)[0][1]!.body).toBe(
      '{"isbn":"9780132350884","title":"Clean Code","author":"Robert C. Martin","genre":"Computer Science","description":null,"publishedYear":null,"copies":1}',
    )
  })

  it('Add book is disabled until the required fields are filled', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    const confirm = confirmOf(dialog, 'Add book')

    expect(confirm).toBeDisabled()
    await fill(dialog, 'ISBN', '9780132350884')
    expect(confirm).toBeDisabled()
    await fill(dialog, 'Title', 'Clean Code')
    expect(confirm).toBeDisabled()
    await fill(dialog, 'Author', 'Robert C. Martin')
    expect(confirm).toBeDisabled() // no genre yet
    await fill(dialog, 'Genre', '   ')
    expect(confirm).toBeDisabled() // a blank genre
    await fill(dialog, 'Genre', 'Computer Science')
    expect(confirm).toBeEnabled()

    // Each required field blanked again, by spaces, disables it.
    for (const label of ['ISBN', 'Title', 'Author', 'Genre']) {
      const was = (field(dialog, label) as HTMLInputElement).value
      await fill(dialog, label, '  ')
      expect(confirm).toBeDisabled()
      await fill(dialog, label, was)
      expect(confirm).toBeEnabled()
    }

    // Description and year are optional.
    expect(field(dialog, 'Description')).toHaveValue('')
    expect(field(dialog, 'Published year')).toHaveValue(null)
    expect(writes(fetch)).toHaveLength(0)
  })

  it('Add book is disabled for copies outside 1 to 20 and for a year that is not a whole number', async () => {
    booksApi(() => json(200, page([NOVEL])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    const confirm = confirmOf(dialog, 'Add book')
    expect(confirm).toBeEnabled()

    expect(field(dialog, 'Copies')).toHaveAttribute('min', '1')
    expect(field(dialog, 'Copies')).toHaveAttribute('max', '20')
    for (const bad of ['0', '21', '-1', '2.5', '']) {
      await fill(dialog, 'Copies', bad)
      expect(confirm).toBeDisabled()
    }
    await fill(dialog, 'Copies', '20')
    expect(confirm).toBeEnabled()
    await fill(dialog, 'Copies', '1')

    fireEvent.change(field(dialog, 'Published year'), { target: { value: '1999.5' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(field(dialog, 'Published year'), { target: { value: '1e3' } })
    expect(confirm).toBeDisabled()
    await fill(dialog, 'Published year', '1999')
    expect(confirm).toBeEnabled()
    await fill(dialog, 'Published year', '')
    expect(confirm).toBeEnabled() // blank means no year
  })

  it('a year before 1450 or after this year keeps Add book disabled', async () => {
    const thisYear = new Date().getFullYear()
    booksApi(() => json(200, page([NOVEL])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    const confirm = confirmOf(dialog, 'Add book')
    const year = field(dialog, 'Published year')
    expect(year).toHaveAttribute('min', '1450')
    expect(year).toHaveAttribute('max', String(thisYear))
    expect(dialog).toHaveTextContent(`A whole number from 1450 to ${thisYear}.`)

    for (const bad of ['0', '1200', '1449', String(thisYear + 1), '99999', '-2000']) {
      await fill(dialog, 'Published year', bad)
      expect(confirm, `year ${bad}`).toBeDisabled()
      expect(year).toHaveAttribute('aria-invalid', 'true')
    }
    // Both ends are allowed.
    for (const good of ['1450', String(thisYear)]) {
      await fill(dialog, 'Published year', good)
      expect(confirm, `year ${good}`).toBeEnabled()
      expect(year).toHaveAttribute('aria-invalid', 'false')
    }
  })

  it('a year outside 1450 to this year also blocks Save on Edit', async () => {
    booksApi(() => json(200, page([book({ id: 'b6', title: 'Ancient', publishedYear: 1300 })])))
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = dialogOf('Edit book details')
    expect(confirmOf(dialog, 'Save changes')).toBeDisabled() // the stored 1300 is outside the range the server accepts
    await fill(dialog, 'Published year', '1999')
    expect(confirmOf(dialog, 'Save changes')).toBeEnabled()
    await fill(dialog, 'Published year', '')
    expect(confirmOf(dialog, 'Save changes')).toBeEnabled()
  })

  it("genre suggestions come from the server's genres", async () => {
    booksApi(() => json(200, page([NOVEL], 1, 1, ['Computer Science', 'Fiction', 'Poetry'])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()

    const genre = field(dialog, 'Genre') as HTMLInputElement
    expect(genre.tagName).toBe('INPUT') // typed, not a fixed select
    const list = dialog.querySelector('datalist')!
    expect(genre.getAttribute('list')).toBe(list.id)
    expect(Array.from(list.querySelectorAll('option')).map((o) => o.value)).toEqual(['Computer Science', 'Fiction', 'Poetry'])

    // A genre nobody has used yet can still be typed.
    await userEvent.type(genre, 'Mythology')
    expect(genre).toHaveValue('Mythology')
  })

  it('Cancel and Escape in the book dialog send nothing and return focus', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const opener = screen.getByRole('button', { name: 'Add book' })
    const dialog = await openAdd()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()

    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes(fetch)).toHaveLength(0)
    expect(listCalls(fetch)).toHaveLength(1)
  })

  it('reopening Add book starts from a clean form', async () => {
    booksApi(() => json(200, page([NOVEL])))
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    await fill(dialog, 'Copies', '7')
    await userEvent.keyboard('{Escape}')

    const again = await openAdd()
    expect(field(again, 'ISBN')).toHaveValue('')
    expect(field(again, 'Title')).toHaveValue('')
    expect(field(again, 'Copies')).toHaveValue(1)
    expect(confirmOf(again, 'Add book')).toBeDisabled()
  })

  it('Edit pre-fills and sends PATCH, blank year sends null', async () => {
    let served = 0
    const renamed = { ...ALGORITHMS, title: 'Introduction to Algorithms, 4th ed.' }
    const fetch = booksApi(() => json(200, page(++served === 1 ? [ALGORITHMS, NOVEL] : [renamed, NOVEL])), {
      'PATCH /admin/books/b1': () => json(200, renamed),
    })
    renderPage()
    await screen.findAllByRole('article')
    await userEvent.click(within(cardOf('Introduction to Algorithms')).getByRole('button', { name: 'Edit' }))

    const dialog = dialogOf('Edit book details')
    expect(dialog).not.toHaveTextContent('New title added')
    expect(field(dialog, 'ISBN')).toHaveValue('9780262046305')
    expect(field(dialog, 'Title')).toHaveValue('Introduction to Algorithms')
    expect(field(dialog, 'Author')).toHaveValue('Cormen, Leiserson, Rivest, Stein')
    expect(field(dialog, 'Genre')).toHaveValue('Computer Science')
    expect(field(dialog, 'Description')).toHaveValue('The standard text.')
    expect(field(dialog, 'Published year')).toHaveValue(2022)
    expect(field(dialog, 'ISBN')).toHaveFocus()
    expect(within(dialog).queryByLabelText('Copies')).toBeNull() // copies are added with + Copies
    expect(confirmOf(dialog, 'Save changes')).toBeEnabled()
    expect(within(dialog).queryByRole('button', { name: 'Add book' })).toBeNull()
    expect(writes(fetch)).toHaveLength(0)

    await fill(dialog, 'Title', 'Introduction to Algorithms, 4th ed.')
    await fill(dialog, 'Description', '')
    await fill(dialog, 'Published year', '')
    await userEvent.click(confirmOf(dialog, 'Save changes'))

    expect(await screen.findByText('Book updated.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) // it closes once the save has landed
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/books\/b1$/)
    expect(writes(fetch)[0][1]!.method).toBe('PATCH')
    expect(writes(fetch)[0][1]!.body).toBe(
      '{"isbn":"9780262046305","title":"Introduction to Algorithms, 4th ed.","author":"Cormen, Leiserson, Rivest, Stein","genre":"Computer Science","description":null,"publishedYear":null}',
    )
    expect(await screen.findByRole('article', { name: 'Introduction to Algorithms, 4th ed.' })).toBeInTheDocument()
    expect(listCalls(fetch)).toHaveLength(2)
  })

  it('Edit sends an unchanged description and year as they were', async () => {
    const fetch = booksApi(() => json(200, page([ALGORITHMS])), { 'PATCH /admin/books/b1': () => json(200, ALGORITHMS) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(confirmOf(dialogOf('Edit book details'), 'Save changes'))
    await screen.findByText('Book updated.')
    expect(writes(fetch)[0][1]!.body).toBe(
      '{"isbn":"9780262046305","title":"Introduction to Algorithms","author":"Cormen, Leiserson, Rivest, Stein","genre":"Computer Science","description":"The standard text.","publishedYear":2022}',
    )
  })

  it('Edit of a book with no description, year or genre opens with those blank', async () => {
    booksApi(() => json(200, page([book({ id: 'b3', title: 'Untagged', genre: null })])))
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = dialogOf('Edit book details')
    expect(field(dialog, 'Genre')).toHaveValue('')
    expect(field(dialog, 'Description')).toHaveValue('')
    expect(field(dialog, 'Published year')).toHaveValue(null)
    expect(confirmOf(dialog, 'Save changes')).toBeDisabled() // a genre is needed before it can be saved
  })

  it('reopening Edit on another book shows that book, not the last one', async () => {
    booksApi(() => json(200, page(ALL)))
    renderPage()
    await screen.findAllByRole('article')
    await userEvent.click(within(cardOf('Introduction to Algorithms')).getByRole('button', { name: 'Edit' }))
    await fill(dialogOf('Edit book details'), 'Title', 'Typed then abandoned')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(cardOf('The Brothers Karamazov')).getByRole('button', { name: 'Edit' }))
    expect(field(dialogOf('Edit book details'), 'Title')).toHaveValue('The Brothers Karamazov')
    expect(field(dialogOf('Edit book details'), 'ISBN')).toHaveValue('9780140449136')
  })

  it('a 409 duplicate ISBN keeps the Add book dialog open with the typed values and toasts the message', async () => {
    let posts = 0
    const fetch = booksApi(() => json(200, page([NOVEL])), {
      'POST /admin/books': () => {
        posts += 1
        return posts === 1
          ? json(409, { error: 'A book with this ISBN is already in the catalogue.' })
          : json(201, CLEAN_CODE)
      },
    })
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    await fill(dialog, 'Description', 'A handbook of agile software craftsmanship.')
    await fill(dialog, 'Published year', '2008')
    await fill(dialog, 'Copies', '3')
    const confirm = confirmOf(dialog, 'Add book')
    await userEvent.click(confirm)

    expect(await screen.findByText('A book with this ISBN is already in the catalogue.')).toBeInTheDocument()
    expect(screen.queryByText('Book added.')).toBeNull()
    expect(posts).toBe(1)
    // The list is fetched again, whatever happened, and the dialog is still there with everything typed.
    await waitFor(() => expect(listCalls(fetch)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Add a book' })).toBe(dialog)
    expect(field(dialog, 'ISBN')).toHaveValue('9780132350884')
    expect(field(dialog, 'Title')).toHaveValue('Clean Code')
    expect(field(dialog, 'Author')).toHaveValue('Robert C. Martin')
    expect(field(dialog, 'Genre')).toHaveValue('Computer Science')
    expect(field(dialog, 'Description')).toHaveValue('A handbook of agile software craftsmanship.')
    expect(field(dialog, 'Published year')).toHaveValue(2008)
    expect(field(dialog, 'Copies')).toHaveValue(3)
    // It can be confirmed again, and focus is still inside the dialog rather than lost to the page.
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(confirm).toHaveFocus()

    // Fix the ISBN and send again: this time it lands and the dialog closes.
    await fill(dialog, 'ISBN', '9780132350885')
    await userEvent.click(confirm)
    expect(await screen.findByText('Book added.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts).toBe(2)
    expect(String(writes(fetch)[1][1]!.body)).toContain('"isbn":"9780132350885"')
  })

  it('after a refused save focus returns to the confirm button, even if the browser dropped it while it was disabled', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])), {
      'POST /admin/books': () => {
        // Some browsers move focus to the page when the focused button is disabled; jsdom does not, so do it by hand.
        ;(document.activeElement as HTMLElement).blur()
        return json(409, { error: 'A book with this ISBN is already in the catalogue.' })
      },
    })
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    const confirm = confirmOf(dialog, 'Add book')
    await userEvent.click(confirm)
    expect(await screen.findByText('A book with this ISBN is already in the catalogue.')).toBeInTheDocument()
    await waitFor(() => expect(listCalls(fetch)).toHaveLength(2))
    // Once the dialog can be confirmed again, focus is back inside it rather than on the page behind.
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(confirm).toHaveFocus()
  })

  it('a failed edit keeps the Edit dialog open', async () => {
    let patches = 0
    const fetch = booksApi(() => json(200, page([NOVEL])), {
      'PATCH /admin/books/b2': () => {
        patches += 1
        return patches === 1 ? json(404, { error: 'Book not found' }) : json(200, NOVEL)
      },
    })
    renderPage()
    await screen.findByRole('article')
    const opener = screen.getByRole('button', { name: 'Edit' })
    await userEvent.click(opener)
    const dialog = dialogOf('Edit book details')
    await fill(dialog, 'Title', 'The Brothers Karamazov (Garnett)')
    await fill(dialog, 'Description', 'Dostoevsky\'s last novel.')
    await userEvent.click(confirmOf(dialog, 'Save changes'))

    expect(await screen.findByText('Book not found')).toBeInTheDocument()
    expect(screen.queryByText('Book updated.')).toBeNull()
    await waitFor(() => expect(listCalls(fetch)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Edit book details' })).toBe(dialog)
    expect(field(dialog, 'Title')).toHaveValue('The Brothers Karamazov (Garnett)')
    expect(field(dialog, 'Description')).toHaveValue("Dostoevsky's last novel.")
    await waitFor(() => expect(confirmOf(dialog, 'Save changes')).toBeEnabled())
    expect(confirmOf(dialog, 'Save changes')).toHaveFocus()

    // Saving again works from the same dialog.
    await userEvent.click(confirmOf(dialog, 'Save changes'))
    expect(await screen.findByText('Book updated.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(patches).toBe(2)
  })

  it('a network failure also keeps the dialog and its values', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])), {
      'POST /admin/books': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderPage()
    await screen.findByText('The Brothers Karamazov')
    const dialog = await openAdd()
    await fillRequired(dialog)
    await fill(dialog, 'Description', 'Pasted at length.')
    await userEvent.click(confirmOf(dialog, 'Add book'))

    expect(await screen.findByText("Can't reach the SmartLib server. Try again in a minute.")).toBeInTheDocument()
    await waitFor(() => expect(listCalls(fetch)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Add a book' })).toBe(dialog)
    expect(field(dialog, 'Description')).toHaveValue('Pasted at length.')
    await waitFor(() => expect(confirmOf(dialog, 'Add book')).toBeEnabled())
  })

  it('+ Copies posts the count and toasts "2 copies added."', async () => {
    let served = 0
    const grown = book({
      id: 'b2', title: 'The Brothers Karamazov', author: 'Fyodor Dostoevsky', genre: 'Fiction',
      copies: ['01', '02', '03', '04'].map((n) => copy({ id: `n${n}`, barcode: `FIC-BK-${n}` })),
    })
    const fetch = booksApi(() => json(200, page(++served === 1 ? ALL : [ALGORITHMS, grown])), {
      'POST /admin/books/b2/copies': () => json(200, grown),
    })
    renderPage()
    await screen.findAllByRole('article')
    await userEvent.click(within(cardOf('The Brothers Karamazov')).getByRole('button', { name: '+ Copies' }))

    const dialog = dialogOf('Add copies of The Brothers Karamazov')
    const count = field(dialog, 'Copies')
    expect(count).toHaveValue(1)
    expect(count).toHaveAttribute('min', '1')
    expect(count).toHaveAttribute('max', '20')
    expect(count).toHaveFocus()
    expect(writes(fetch)).toHaveLength(0)
    await fill(dialog, 'Copies', '2')
    await userEvent.click(confirmOf(dialog, 'Add copies'))

    expect(await screen.findByText('2 copies added.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) // it closes once the save has landed
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/books\/b2\/copies$/)
    expect(writes(fetch)[0][1]!.method).toBe('POST')
    expect(writes(fetch)[0][1]!.body).toBe('{"count":2}')

    // The list shows the new copies.
    await waitFor(() => expect(within(cardOf('The Brothers Karamazov')).getAllByRole('listitem')).toHaveLength(4))
    expect(listCalls(fetch)).toHaveLength(2)
  })

  it('+ Copies with one copy toasts "1 copy added."', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])), { 'POST /admin/books/b2/copies': () => json(200, NOVEL) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: '+ Copies' }))
    await userEvent.click(confirmOf(dialogOf('Add copies of The Brothers Karamazov'), 'Add copies'))
    expect(await screen.findByText('1 copy added.')).toBeInTheDocument()
    expect(writes(fetch)[0][1]!.body).toBe('{"count":1}')
  })

  it('Add copies is disabled for a count outside 1 to 20 or not a whole number', async () => {
    const fetch = booksApi(() => json(200, page([NOVEL])))
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: '+ Copies' }))
    const dialog = dialogOf('Add copies of The Brothers Karamazov')
    const confirm = confirmOf(dialog, 'Add copies')
    expect(confirm).toBeEnabled()
    for (const bad of ['0', '21', '-3', '1.5', '']) {
      await fill(dialog, 'Copies', bad)
      expect(confirm).toBeDisabled()
    }
    fireEvent.change(field(dialog, 'Copies'), { target: { value: '1e1' } })
    expect(confirm).toBeDisabled()
    await fill(dialog, 'Copies', '20')
    expect(confirm).toBeEnabled()
    await fill(dialog, 'Copies', '1')
    expect(confirm).toBeEnabled()
    expect(writes(fetch)).toHaveLength(0)
  })

  it("a 400 on + Copies shows the server's message and keeps the dialog open", async () => {
    booksApi(() => json(200, page([NOVEL])), { 'POST /admin/books/b2/copies': () => json(400, { error: 'Copies must be between 1 and 20.' }) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: '+ Copies' }))
    const dialog = dialogOf('Add copies of The Brothers Karamazov')
    await fill(dialog, 'Copies', '5')
    await userEvent.click(confirmOf(dialog, 'Add copies'))
    expect(await screen.findByText('Copies must be between 1 and 20.')).toBeInTheDocument()
    expect(screen.queryByText(/copy added|copies added/)).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Add copies of The Brothers Karamazov' })).toBe(dialog)
    expect(field(dialog, 'Copies')).toHaveValue(5)
    await waitFor(() => expect(confirmOf(dialog, 'Add copies')).toBeEnabled())
    expect(confirmOf(dialog, 'Add copies')).toHaveFocus()
  })

  it('the dialog and the buttons stay disabled until the refetch returns, and a second click sends nothing', async () => {
    const refetching = gate()
    let served = 0
    const fetch = booksApi(
      async () => {
        if (++served === 1) return json(200, page(ALL))
        await refetching.promise
        return json(200, page(ALL))
      },
      { 'POST /admin/books/b2/copies': () => json(200, NOVEL) },
    )
    renderPage()
    await screen.findAllByRole('article')
    await userEvent.click(within(cardOf('The Brothers Karamazov')).getByRole('button', { name: '+ Copies' }))
    const dialog = dialogOf('Add copies of The Brothers Karamazov')
    // A double click on the confirm button is one write.
    await userEvent.dblClick(confirmOf(dialog, 'Add copies'))
    expect(writes(fetch)).toHaveLength(1)

    // The write landed and the list is not back yet: the dialog is still up and cannot be confirmed again,
    // and every button behind it is disabled.
    await screen.findByText('1 copy added.')
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(confirmOf(dialog, 'Add copies')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add book' })).toBeDisabled()
    for (const title of ['Introduction to Algorithms', 'The Brothers Karamazov']) {
      expect(within(cardOf(title)).getByRole('button', { name: 'Edit' })).toBeDisabled()
      expect(within(cardOf(title)).getByRole('button', { name: '+ Copies' })).toBeDisabled()
    }
    await userEvent.click(within(cardOf('Introduction to Algorithms')).getByRole('button', { name: 'Edit' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1) // no second dialog opened behind the first

    refetching.open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add book' })).toBeEnabled())
    expect(within(cardOf('The Brothers Karamazov')).getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(writes(fetch)).toHaveLength(1)
  })

  it('Cancel stays available while a save is in flight, and the save still lands and is toasted', async () => {
    const saving = gate()
    const fetch = booksApi(() => json(200, page([NOVEL])), {
      'POST /admin/books/b2/copies': async () => {
        await saving.promise
        return json(200, NOVEL)
      },
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: '+ Copies' }))
    const dialog = dialogOf('Add copies of The Brothers Karamazov')
    await userEvent.click(confirmOf(dialog, 'Add copies'))
    expect(confirmOf(dialog, 'Add copies')).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    saving.open()
    expect(await screen.findByText('1 copy added.')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)
  })

  it('shows the dialogs\' titles as text, never as markup', async () => {
    booksApi(() => json(200, page([book({ id: 'b8', title: '<i>Odd</i> & Co' })])))
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(screen.getByRole('button', { name: '+ Copies' }))
    expect(screen.getByRole('dialog', { name: 'Add copies of <i>Odd</i> & Co' })).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('i')).toBeNull()
  })
})

describe('Catalogue page copy actions', () => {
  const dialogOf = (name: string) => screen.getByRole('dialog', { name })
  const confirmOf = (dialog: HTMLElement, label: string) => within(dialog).getByRole('button', { name: label })
  const labelsOf = (barcode: string) => within(chipOf(barcode)).queryAllByRole('button').map((button) => button.textContent)
  const chipButton = (barcode: string, name: string) => within(chipOf(barcode)).getByRole('button', { name })
  const chargeBox = (dialog: HTMLElement) => within(dialog).getByLabelText('Replacement charge (₹)')

  const OWED = { fineId: 'f1', amount: 250, student: ROHAN }
  // A copy that was lost on loan, whose replacement fine is still owed, and one that is only in maintenance.
  const FOUND = book({
    id: 'b7', title: 'Found Again', totalCopies: 1, availableCopies: 0,
    copies: [
      copy({ id: 'c30', barcode: 'LOST-01', status: 'lost', owedReplacement: OWED }),
      copy({ id: 'c31', barcode: 'LOST-02', status: 'maintenance' }),
    ],
  })

  /** Serves `before` the first time and `after` from then on, like a list that changed under the write. */
  const changing = (before: AdminBook[], after: AdminBook[]) => {
    let served = 0
    return () => json(200, page(++served === 1 ? before : after))
  }

  it('chips offer the right actions for each status', async () => {
    booksApi(() => json(200, page([ALGORITHMS])))
    renderPage()
    await screen.findByRole('article')

    expect(labelsOf('CS-ALG-01')).toEqual(['Lost']) // on loan
    expect(labelsOf('CS-ALG-02')).toEqual(['Maintenance', 'Lost']) // available
    expect(labelsOf('CS-ALG-03')).toEqual([]) // held for a borrow request
    expect(labelsOf('CS-ALG-04')).toEqual(['Restore']) // maintenance
    expect(labelsOf('CS-ALG-05')).toEqual(['Restore']) // lost
    for (const button of within(cardOf('Introduction to Algorithms')).getAllByRole('button')) {
      expect(button).toBeEnabled()
    }
    expect(chipButton('CS-ALG-02', 'Maintenance')).toHaveClass('sla-chip')
    expect(chipButton('CS-ALG-05', 'Restore')).toHaveAttribute('type', 'button')
    // The status tag is still there beside the buttons.
    expect(within(chipOf('CS-ALG-04')).getByText('Maintenance')).toHaveClass('tag')
  })

  it('maintenance confirms and posts', async () => {
    const onShelf = book({ id: 'b1', title: 'Introduction to Algorithms', copies: [copy({ id: 'c2', barcode: 'CS-ALG-02' })] })
    const maintained = book({
      id: 'b1', title: 'Introduction to Algorithms', copies: [copy({ id: 'c2', barcode: 'CS-ALG-02', status: 'maintenance' })],
    })
    const fetch = booksApi(changing([onShelf], [maintained]), {
      'POST /admin/copies/c2/maintenance': () => json(200, maintained),
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('CS-ALG-02', 'Maintenance'))

    const dialog = dialogOf('Mark this copy under maintenance?')
    expect(dialog).toHaveTextContent('CS-ALG-02 is removed from what students see as available.')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(confirmOf(dialog, 'Confirm')).toHaveFocus() // nothing to fill in: the primary button takes focus
    expect(writes(fetch)).toHaveLength(0)

    await userEvent.click(confirmOf(dialog, 'Confirm'))
    expect(await screen.findByText('Copy marked under maintenance.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/copies\/c2\/maintenance$/)
    expect(writes(fetch)[0][1]!.method).toBe('POST')
    expect(writes(fetch)[0][1]!.body).toBeUndefined() // no body
    // The list was fetched again and the chip now offers Restore.
    expect(listCalls(fetch)).toHaveLength(2)
    await waitFor(() => expect(labelsOf('CS-ALG-02')).toEqual(['Restore']))
  })

  it('lost from the shelf posts no charge', async () => {
    const fetch = booksApi(changing([ALGORITHMS], [ALGORITHMS]), { 'POST /admin/copies/c2/lost': () => json(200, ALGORITHMS) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('CS-ALG-02', 'Lost'))

    const dialog = dialogOf('Mark this copy as lost?')
    expect(dialog).toHaveTextContent('CS-ALG-02 is removed from what students see as available.')
    expect(within(dialog).queryByLabelText('Replacement charge (₹)')).toBeNull() // a shelf copy owes nothing
    await userEvent.click(confirmOf(dialog, 'Confirm'))

    expect(await screen.findByText('Copy marked as lost.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/copies\/c2\/lost$/)
    expect(writes(fetch)[0][1]!.method).toBe('POST')
    expect(writes(fetch)[0][1]!.body).toBe('{}')
    expect(listCalls(fetch)).toHaveLength(2)
  })

  it('lost on loan requires a whole-number charge and posts it', async () => {
    const fetch = booksApi(changing([ALGORITHMS], [ALGORITHMS]), { 'POST /admin/copies/c1/lost': () => json(200, ALGORITHMS) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('CS-ALG-01', 'Lost'))

    const dialog = dialogOf('Mark this copy as lost?')
    // Whose loan closes, with the due date in the library's day (20:30 UTC is already the next morning there).
    expect(dialog).toHaveTextContent(
      `Rohan Verma has this copy, due ${dayLabel(4)}. Their loan closes, any overdue fine so far is charged, and the replacement charge becomes a Lost book fine they can see.`,
    )
    const charge = chargeBox(dialog)
    expect(charge).toHaveAttribute('type', 'number')
    expect(charge).toHaveAttribute('min', '0')
    expect(charge).toHaveAttribute('max', '10000')
    expect(charge).toHaveValue(null) // required: it starts blank
    expect(charge).toHaveFocus()
    const confirm = confirmOf(dialog, 'Mark as lost')
    expect(confirm).toBeDisabled()

    for (const bad of ['-1', '1.5', '10001', '99999']) {
      await userEvent.clear(charge)
      await userEvent.type(charge, bad)
      expect(confirm, `charge ${bad}`).toBeDisabled()
      expect(charge).toHaveAttribute('aria-invalid', 'true')
    }
    fireEvent.change(charge, { target: { value: '1e2' } })
    expect(confirm).toBeDisabled()
    await userEvent.clear(charge)
    expect(confirm).toBeDisabled() // blank
    // Both ends are allowed: 0 means no replacement charge.
    for (const good of ['0', '10000']) {
      await userEvent.clear(charge)
      await userEvent.type(charge, good)
      expect(confirm, `charge ${good}`).toBeEnabled()
      expect(charge).toHaveAttribute('aria-invalid', 'false')
    }
    expect(writes(fetch)).toHaveLength(0)

    await userEvent.clear(charge)
    await userEvent.type(charge, '250')
    await userEvent.click(confirm)
    expect(await screen.findByText('Copy marked as lost.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/copies\/c1\/lost$/)
    expect(writes(fetch)[0][1]!.method).toBe('POST')
    expect(writes(fetch)[0][1]!.body).toBe('{"replacementCharge":250}')
  })

  it('lost on loan with a charge of 0 posts 0', async () => {
    const fetch = booksApi(() => json(200, page([ALGORITHMS])), { 'POST /admin/copies/c1/lost': () => json(200, ALGORITHMS) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('CS-ALG-01', 'Lost'))
    const dialog = dialogOf('Mark this copy as lost?')
    await userEvent.type(chargeBox(dialog), '0')
    await userEvent.click(confirmOf(dialog, 'Mark as lost'))
    await screen.findByText('Copy marked as lost.')
    expect(writes(fetch)[0][1]!.body).toBe('{"replacementCharge":0}')
  })

  it('a copy marked borrowed with no open loan is lost with a plain confirmation and no charge', async () => {
    const seeded = book({ id: 'b4', title: 'Seed Book', copies: [copy({ id: 'c9', barcode: 'SEED-01', status: 'on_loan' })] })
    const fetch = booksApi(() => json(200, page([seeded])), { 'POST /admin/copies/c9/lost': () => json(200, seeded) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('SEED-01', 'Lost'))

    const dialog = dialogOf('Mark this copy as lost?')
    expect(dialog).toHaveTextContent('SEED-01 is removed from what students see as available.')
    expect(within(dialog).queryByLabelText('Replacement charge (₹)')).toBeNull() // nobody's loan to charge
    await userEvent.click(confirmOf(dialog, 'Confirm'))
    expect(await screen.findByText('Copy marked as lost.')).toBeInTheDocument()
    expect(writes(fetch)[0][1]!.body).toBe('{}')
  })

  it('restore of a copy with an owed replacement shows the ticked waive box and posts waiveReplacementCharge true', async () => {
    const restored = book({ id: 'b7', title: 'Found Again', copies: [copy({ id: 'c30', barcode: 'LOST-01' })] })
    const fetch = booksApi(changing([FOUND], [restored]), {
      'POST /admin/copies/c30/restore': () => json(200, { book: restored, replacementWaived: true }),
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('LOST-01', 'Restore'))

    const dialog = dialogOf('Return this copy to circulation?')
    expect(dialog).toHaveTextContent('LOST-01 becomes visible to students again.')
    const waive = within(dialog).getByRole('checkbox', { name: "Waive Rohan Verma's ₹250 replacement charge" })
    expect(waive).toBeChecked()
    expect(writes(fetch)).toHaveLength(0)

    await userEvent.click(confirmOf(dialog, 'Restore'))
    expect(await screen.findByText('Copy restored.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/copies\/c30\/restore$/)
    expect(writes(fetch)[0][1]!.method).toBe('POST')
    expect(writes(fetch)[0][1]!.body).toBe('{"waiveReplacementCharge":true}')
    expect(listCalls(fetch)).toHaveLength(2)
    expect(screen.queryByText(/was already settled/)).toBeNull()
  })

  it('unticking it posts false', async () => {
    const fetch = booksApi(() => json(200, page([FOUND])), {
      'POST /admin/copies/c30/restore': () => json(200, { book: FOUND, replacementWaived: false }),
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('LOST-01', 'Restore'))
    const dialog = dialogOf('Return this copy to circulation?')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: "Waive Rohan Verma's ₹250 replacement charge" }))
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked()
    await userEvent.click(confirmOf(dialog, 'Restore'))

    // Nothing was asked to be waived, so the plain toast, not the "settled" one.
    expect(await screen.findByText('Copy restored.')).toBeInTheDocument()
    expect(screen.queryByText(/was already settled/)).toBeNull()
    expect(writes(fetch)[0][1]!.body).toBe('{"waiveReplacementCharge":false}')
  })

  it('restoring a copy with no replacement owed shows no waive box and posts false', async () => {
    const fetch = booksApi(() => json(200, page([FOUND])), {
      'POST /admin/copies/c31/restore': () => json(200, { book: FOUND, replacementWaived: false }),
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('LOST-02', 'Restore'))
    const dialog = dialogOf('Return this copy to circulation?')
    expect(dialog).toHaveTextContent('LOST-02 becomes visible to students again.')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    await userEvent.click(confirmOf(dialog, 'Restore'))
    expect(await screen.findByText('Copy restored.')).toBeInTheDocument()
    expect(writes(fetch)[0][1]!.body).toBe('{"waiveReplacementCharge":false}')
  })

  it('restore answering replacementWaived false shows the settled toast', async () => {
    const fetch = booksApi(() => json(200, page([FOUND])), {
      'POST /admin/copies/c30/restore': () => json(200, { book: FOUND, replacementWaived: false }),
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('LOST-01', 'Restore'))
    await userEvent.click(confirmOf(dialogOf('Return this copy to circulation?'), 'Restore'))

    // The waive was asked for (box ticked), but the fine was settled a moment earlier.
    expect(await screen.findByText('Copy restored. The replacement charge was already settled, so it was not waived.')).toBeInTheDocument()
    expect(screen.queryByText('Copy restored.')).toBeNull()
    expect(writes(fetch)[0][1]!.body).toBe('{"waiveReplacementCharge":true}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) // the restore did happen
  })

  it("a 409 (waitlist) shows the server's message, refetches and keeps the dialog open", async () => {
    let posts = 0
    const fetch = booksApi(() => json(200, page([ALGORITHMS])), {
      'POST /admin/copies/c2/maintenance': () => {
        posts += 1
        return posts === 1 ? json(409, { error: 'This copy is set aside for a student on the waitlist.' }) : json(200, ALGORITHMS)
      },
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('CS-ALG-02', 'Maintenance'))
    const dialog = dialogOf('Mark this copy under maintenance?')
    const confirm = confirmOf(dialog, 'Confirm')
    await userEvent.click(confirm)

    expect(await screen.findByText('This copy is set aside for a student on the waitlist.')).toBeInTheDocument()
    expect(screen.queryByText('Copy marked under maintenance.')).toBeNull()
    await waitFor(() => expect(listCalls(fetch)).toHaveLength(2)) // the page refetches to show what changed
    expect(screen.getByRole('dialog', { name: 'Mark this copy under maintenance?' })).toBe(dialog)
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(confirm).toHaveFocus()

    // Confirming again goes through the same dialog.
    await userEvent.click(confirm)
    expect(await screen.findByText('Copy marked under maintenance.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts).toBe(2)
  })

  it('a refused lost-on-loan keeps the typed replacement charge', async () => {
    let posts = 0
    const fetch = booksApi(() => json(200, page([ALGORITHMS])), {
      'POST /admin/copies/c1/lost': () => {
        posts += 1
        return posts === 1 ? json(409, { error: 'This copy is no longer on loan.' }) : json(200, ALGORITHMS)
      },
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('CS-ALG-01', 'Lost'))
    const dialog = dialogOf('Mark this copy as lost?')
    await userEvent.type(chargeBox(dialog), '250')
    await userEvent.click(confirmOf(dialog, 'Mark as lost'))

    expect(await screen.findByText('This copy is no longer on loan.')).toBeInTheDocument()
    await waitFor(() => expect(listCalls(fetch)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Mark this copy as lost?' })).toBe(dialog)
    expect(chargeBox(dialog)).toHaveValue(250)
    await waitFor(() => expect(confirmOf(dialog, 'Mark as lost')).toBeEnabled())
    expect(confirmOf(dialog, 'Mark as lost')).toHaveFocus()

    await userEvent.click(confirmOf(dialog, 'Mark as lost'))
    expect(await screen.findByText('Copy marked as lost.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(2)
    expect(writes(fetch)[1][1]!.body).toBe('{"replacementCharge":250}')
  })

  it('a refused restore keeps the waive box as the librarian left it', async () => {
    const fetch = booksApi(() => json(200, page([FOUND])), {
      'POST /admin/copies/c30/restore': () => json(409, { error: 'This copy is already available.' }),
    })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('LOST-01', 'Restore'))
    const dialog = dialogOf('Return this copy to circulation?')
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(confirmOf(dialog, 'Restore'))

    expect(await screen.findByText('This copy is already available.')).toBeInTheDocument()
    await waitFor(() => expect(listCalls(fetch)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Return this copy to circulation?' })).toBe(dialog)
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked()
  })

  it('the buttons and the dialog stay disabled until the refetch returns, and a double click posts once', async () => {
    const refetching = gate()
    let served = 0
    const fetch = booksApi(
      async () => {
        if (++served === 1) return json(200, page(ALL))
        await refetching.promise
        return json(200, page(ALL))
      },
      { 'POST /admin/copies/c2/maintenance': () => json(200, ALGORITHMS) },
    )
    renderPage()
    await screen.findAllByRole('article')
    await userEvent.click(chipButton('CS-ALG-02', 'Maintenance'))
    const dialog = dialogOf('Mark this copy under maintenance?')
    await userEvent.dblClick(confirmOf(dialog, 'Confirm'))
    expect(writes(fetch)).toHaveLength(1)

    // The write landed and the list is not back yet: the dialog is up and cannot be confirmed again,
    // and every action behind it, on every card, is disabled.
    await screen.findByText('Copy marked under maintenance.')
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(confirmOf(dialog, 'Confirm')).toBeDisabled()
    const behind = [
      ...within(cardOf('Introduction to Algorithms')).getAllByRole('listitem'),
      ...within(cardOf('The Brothers Karamazov')).getAllByRole('listitem'),
    ].flatMap((chip) => within(chip).queryAllByRole('button'))
    expect(behind.length).toBeGreaterThan(5)
    for (const button of behind) expect(button).toBeDisabled()
    await userEvent.click(chipButton('FIC-BK-01', 'Lost'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1) // no second dialog opened behind the first

    refetching.open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(chipButton('FIC-BK-01', 'Lost')).toBeEnabled())
    expect(chipButton('CS-ALG-02', 'Maintenance')).toBeEnabled()
    expect(writes(fetch)).toHaveLength(1)
  })

  it('Cancel and Escape send nothing and return focus to the chip button', async () => {
    const fetch = booksApi(() => json(200, page([ALGORITHMS])))
    renderPage()
    await screen.findByRole('article')
    const opener = chipButton('CS-ALG-02', 'Lost')
    await userEvent.click(opener)
    await userEvent.click(within(dialogOf('Mark this copy as lost?')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()

    await userEvent.click(chipButton('CS-ALG-05', 'Restore'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes(fetch)).toHaveLength(0)
    expect(listCalls(fetch)).toHaveLength(1)
  })

  it('reopening the lost dialog starts from a blank charge', async () => {
    booksApi(() => json(200, page([ALGORITHMS])))
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('CS-ALG-01', 'Lost'))
    await userEvent.type(chargeBox(dialogOf('Mark this copy as lost?')), '400')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(chipButton('CS-ALG-01', 'Lost'))
    expect(chargeBox(dialogOf('Mark this copy as lost?'))).toHaveValue(null)
  })

  it("puts the copy's id in the path encoded", async () => {
    const odd = book({ id: 'b8', title: 'Odd Ids', copies: [copy({ id: 'c/9 x', barcode: 'ODD-01' })] })
    const fetch = booksApi(() => json(200, page([odd])), { 'POST /admin/copies/c%2F9%20x/maintenance': () => json(200, odd) })
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('ODD-01', 'Maintenance'))
    await userEvent.click(confirmOf(dialogOf('Mark this copy under maintenance?'), 'Confirm'))
    expect(await screen.findByText('Copy marked under maintenance.')).toBeInTheDocument()
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/copies\/c%2F9%20x\/maintenance$/)
  })

  it('shows the borrower and barcode in the dialogs as text, never as markup', async () => {
    const tricky = book({
      id: 'b9', title: 'Tricky',
      copies: [copy({ id: 'c40', barcode: '<u>TR-01</u>', status: 'on_loan', borrower: { id: 's9', name: 'A <b>B</b>' }, dueAt: at(3, 8.5) })],
    })
    booksApi(() => json(200, page([tricky])))
    renderPage()
    await screen.findByRole('article')
    await userEvent.click(chipButton('<u>TR-01</u>', 'Lost'))
    const dialog = dialogOf('Mark this copy as lost?')
    expect(dialog).toHaveTextContent('A <b>B</b> has this copy')
    expect(dialog.querySelector('b')).toBeNull()
  })
})
