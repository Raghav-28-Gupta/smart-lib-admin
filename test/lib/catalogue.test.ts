import { describe, expect, it } from 'vitest'
import { ApiError, writeToken } from '@/lib/api'
import {
  CATALOGUE_PAGE_SIZE, MIN_PUBLISHED_YEAR, addCopies, createBook, fetchBooks, isPublishedYear, markCopyLost, markCopyMaintenance,
  maxPublishedYear, parseReplacementCharge, restoreCopy, updateBook,
  type AdminBook, type BookForm, type BooksPage,
} from '@/lib/catalogue'
import { json, mockFetch } from '../helpers'

const EMPTY: BooksPage = { books: [], total: 0, page: 1, pageSize: 25, genres: [] }

const FORM: BookForm = {
  isbn: '9780132350884', title: 'Clean Code', author: 'Robert C. Martin', genre: 'Computer Science', description: '', publishedYear: '',
}

const urlOf = (fetch: ReturnType<typeof mockFetch>, index = 0) => new URL(String(fetch.mock.calls[index][0]))
const bodyOf = (fetch: ReturnType<typeof mockFetch>, index = 0) => fetch.mock.calls[index][1]!.body

describe('catalogue API', () => {
  it('fetches a page with the token, search, page and the 25-row page size, and returns the genres', async () => {
    writeToken('t')
    const reply: BooksPage = { ...EMPTY, total: 3, genres: ['Computer Science', 'Fiction'] }
    const fetch = mockFetch({ 'GET /admin/books': () => json(200, reply) })
    await expect(fetchBooks({ search: 'clean', page: 2 })).resolves.toEqual(reply)
    expect(urlOf(fetch).pathname).toBe('/admin/books')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(urlOf(fetch).searchParams.get('search')).toBe('clean')
    expect(urlOf(fetch).searchParams.get('page')).toBe('2')
    expect(urlOf(fetch).searchParams.get('pageSize')).toBe('25')
    expect(CATALOGUE_PAGE_SIZE).toBe(25)
  })

  it('omits a blank search and always sends the page and size', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/books': () => json(200, EMPTY) })
    await fetchBooks({ search: '   ', page: 1 })
    const q = urlOf(fetch).searchParams
    expect(q.has('search')).toBe(false)
    expect(q.get('page')).toBe('1')
    expect(q.get('pageSize')).toBe('25')
  })

  it('trims the search and encodes what is typed', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/books': () => json(200, EMPTY) })
    await fetchBooks({ search: '  a&b=c%_ "x"  ', page: 1 })
    const q = urlOf(fetch).searchParams
    expect(q.get('search')).toBe('a&b=c%_ "x"')
    expect(q.get('page')).toBe('1')
    expect(q.has('b')).toBe(false)
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/books': () => json(400, { error: 'Search is too long.' }) })
    const error = await fetchBooks({ search: 'x', page: 1 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe('Search is too long.')
  })
})

describe('isPublishedYear', () => {
  it('accepts a blank year and a whole number from 1450 to the current year', () => {
    const thisYear = new Date().getFullYear()
    expect(maxPublishedYear()).toBe(thisYear)
    expect(MIN_PUBLISHED_YEAR).toBe(1450)
    for (const ok of ['', '   ', '1450', ' 2008 ', String(thisYear)]) expect(isPublishedYear(ok), ok).toBe(true)
    for (const bad of ['1449', '0', '-2000', String(thisYear + 1), '99999', '19.5', '1e3', 'abc', '--1']) {
      expect(isPublishedYear(bad), bad).toBe(false)
    }
  })
})

describe('book writes', () => {
  it('creates a book with POST, the token, the trimmed fields and the copies; blank description and year send null', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/books': () => json(201, { id: 'b1' }) })
    await expect(
      createBook({ ...FORM, isbn: ' 9780132350884 ', title: '  Clean Code ', author: ' Robert C. Martin', genre: ' Computer Science ', copies: 3 }),
    ).resolves.toEqual({ id: 'b1' })
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(bodyOf(fetch)).toBe(
      '{"isbn":"9780132350884","title":"Clean Code","author":"Robert C. Martin","genre":"Computer Science","description":null,"publishedYear":null,"copies":3}',
    )
  })

  it('sends a filled description trimmed and a filled year as a number', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/books': () => json(201, {}) })
    await createBook({ ...FORM, description: '  A handbook of agile craftsmanship.  ', publishedYear: ' 2008 ', copies: 1 })
    expect(JSON.parse(String(bodyOf(fetch)))).toMatchObject({ description: 'A handbook of agile craftsmanship.', publishedYear: 2008, copies: 1 })
  })

  it('treats a description of only spaces as none', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/books': () => json(201, {}) })
    await createBook({ ...FORM, description: '   \n ', copies: 1 })
    expect(JSON.parse(String(bodyOf(fetch))).description).toBeNull()
  })

  it('refuses a year that is not a whole number without sending anything (never NaN)', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/books': () => json(201, {}), 'PATCH /admin/books/b1': () => json(200, {}) })
    for (const publishedYear of ['abc', '19.5', '1e3', '2008x', '--1']) {
      await expect(createBook({ ...FORM, publishedYear, copies: 1 })).rejects.toThrow('The published year must be a whole number.')
      await expect(updateBook('b1', { ...FORM, publishedYear })).rejects.toThrow('The published year must be a whole number.')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves the range of the year to the server', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/books': () => json(201, {}) })
    await createBook({ ...FORM, publishedYear: '1200', copies: 1 })
    expect(JSON.parse(String(bodyOf(fetch))).publishedYear).toBe(1200)
  })

  it('updates with PATCH and the same fields, without copies', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'PATCH /admin/books/b1': () => json(200, { id: 'b1' }) })
    await expect(updateBook('b1', { ...FORM, title: ' Clean Code, 2nd ed. ', description: 'Notes', publishedYear: '2008' })).resolves.toEqual({ id: 'b1' })
    expect(fetch.mock.calls[0][1]!.method).toBe('PATCH')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(bodyOf(fetch)).toBe(
      '{"isbn":"9780132350884","title":"Clean Code, 2nd ed.","author":"Robert C. Martin","genre":"Computer Science","description":"Notes","publishedYear":2008}',
    )
  })

  it('adds copies with POST and the count', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/books/b1/copies': () => json(200, { id: 'b1' }) })
    await expect(addCopies('b1', 2)).resolves.toEqual({ id: 'b1' })
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(bodyOf(fetch)).toBe('{"count":2}')
  })

  it('encodes the book id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'PATCH /admin/books/a%2Fb': () => json(200, {}),
      'POST /admin/books/a%2Fb/copies': () => json(200, {}),
    })
    await updateBook('a/b', FORM)
    await addCopies('a/b', 1)
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/books\/a%2Fb$/)
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/admin\/books\/a%2Fb\/copies$/)
  })

  it("passes the server's refusals through", async () => {
    writeToken('t')
    mockFetch({
      'POST /admin/books': () => json(409, { error: 'A book with this ISBN is already in the catalogue.' }),
      'PATCH /admin/books/b1': () => json(404, { error: 'Book not found' }),
      'POST /admin/books/b1/copies': () => json(400, { error: 'Copies must be between 1 and 20.' }),
    })
    const duplicate = await createBook({ ...FORM, copies: 1 }).catch((e: unknown) => e)
    expect(duplicate).toBeInstanceOf(ApiError)
    expect((duplicate as ApiError).status).toBe(409)
    expect((duplicate as ApiError).message).toBe('A book with this ISBN is already in the catalogue.')
    const gone = await updateBook('b1', FORM).catch((e: unknown) => e)
    expect((gone as ApiError).status).toBe(404)
    expect((gone as ApiError).message).toBe('Book not found')
    const bad = await addCopies('b1', 99).catch((e: unknown) => e)
    expect((bad as ApiError).status).toBe(400)
    expect((bad as ApiError).message).toBe('Copies must be between 1 and 20.')
  })
})

describe('parseReplacementCharge', () => {
  it('accepts a whole number of rupees from 0 to 10000', () => {
    for (const [text, charge] of [['0', 0], ['250', 250], [' 10000 ', 10000], ['007', 7]] as const) {
      expect(parseReplacementCharge(text), text).toBe(charge)
    }
  })

  it('rejects blank, signs, fractions, exponents and anything outside the range', () => {
    for (const bad of ['', '  ', '-1', '+5', '1.5', '1e2', '10001', '99999', 'abc', '1 2']) {
      expect(parseReplacementCharge(bad), bad).toBeNull()
    }
  })
})

describe('copy writes', () => {
  const BOOK = { id: 'b1', title: 'Clean Code' } as AdminBook
  const methodOf = (fetch: ReturnType<typeof mockFetch>, index = 0) => fetch.mock.calls[index][1]!.method

  it('marks a copy under maintenance with POST, the token and no body', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/copies/c1/maintenance': () => json(200, BOOK) })
    await expect(markCopyMaintenance('c1')).resolves.toEqual(BOOK)
    expect(urlOf(fetch).pathname).toBe('/admin/copies/c1/maintenance')
    expect(methodOf(fetch)).toBe('POST')
    expect(bodyOf(fetch)).toBeUndefined()
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
  })

  it('marks a copy lost with an empty body for a shelf copy and the charge with the borrower for one on loan', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/copies/c1/lost': () => json(200, BOOK) })
    await expect(markCopyLost('c1')).resolves.toEqual(BOOK)
    await markCopyLost('c1', 250, 's2')
    await markCopyLost('c1', 0, 's2') // a charge of 0 is still sent: it says "no replacement charge"
    expect(urlOf(fetch).pathname).toBe('/admin/copies/c1/lost')
    expect(methodOf(fetch)).toBe('POST')
    expect(bodyOf(fetch, 0)).toBe('{}')
    expect(bodyOf(fetch, 1)).toBe('{"replacementCharge":250,"borrowerId":"s2"}')
    expect(bodyOf(fetch, 2)).toBe('{"replacementCharge":0,"borrowerId":"s2"}')
  })

  it('sends no borrower with no charge: a copy with nobody to charge posts an empty body', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/copies/c1/lost': () => json(200, BOOK) })
    await markCopyLost('c1', undefined, 's2')
    expect(bodyOf(fetch)).toBe('{}')
  })

  it('restores a copy with the waive flag and returns the book and whether it was waived', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/copies/c1/restore': () => json(200, { book: BOOK, replacementWaived: true }) })
    await expect(restoreCopy('c1', true)).resolves.toEqual({ book: BOOK, replacementWaived: true })
    await restoreCopy('c1', false)
    expect(urlOf(fetch).pathname).toBe('/admin/copies/c1/restore')
    expect(methodOf(fetch)).toBe('POST')
    expect(bodyOf(fetch, 0)).toBe('{"waiveReplacementCharge":true}')
    expect(bodyOf(fetch, 1)).toBe('{"waiveReplacementCharge":false}')
  })

  it('encodes the copy id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'POST /admin/copies/c%2F1%3F/maintenance': () => json(200, BOOK),
      'POST /admin/copies/c%2F1%3F/lost': () => json(200, BOOK),
      'POST /admin/copies/c%2F1%3F/restore': () => json(200, { book: BOOK, replacementWaived: false }),
    })
    await markCopyMaintenance('c/1?')
    await markCopyLost('c/1?')
    await restoreCopy('c/1?', false)
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/admin/copies/c%2F1%3F/maintenance', '/admin/copies/c%2F1%3F/lost', '/admin/copies/c%2F1%3F/restore',
    ])
  })

  it("passes the server's refusals through", async () => {
    writeToken('t')
    mockFetch({
      'POST /admin/copies/c1/maintenance': () => json(409, { error: 'This copy is set aside for a student on the waitlist.' }),
      'POST /admin/copies/c1/lost': () => json(400, { error: 'Enter a replacement charge for the copy on loan.' }),
      'POST /admin/copies/c1/restore': () => json(404, { error: 'Copy not found' }),
    })
    const waitlist = await markCopyMaintenance('c1').catch((e: unknown) => e)
    expect(waitlist).toBeInstanceOf(ApiError)
    expect((waitlist as ApiError).status).toBe(409)
    expect((waitlist as ApiError).message).toBe('This copy is set aside for a student on the waitlist.')
    const noCharge = await markCopyLost('c1').catch((e: unknown) => e)
    expect((noCharge as ApiError).status).toBe(400)
    expect((noCharge as ApiError).message).toBe('Enter a replacement charge for the copy on loan.')
    const gone = await restoreCopy('c1', false).catch((e: unknown) => e)
    expect((gone as ApiError).status).toBe(404)
    expect((gone as ApiError).message).toBe('Copy not found')
  })
})
