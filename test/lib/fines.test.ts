import { describe, expect, it } from 'vitest'
import { ApiError, writeToken } from '@/lib/api'
import { FINE_STATUS_FILTERS, FINES_PAGE_SIZE, adjustFine, fetchFines, markFinePaid, type FinesPage } from '@/lib/fines'
import { json, mockFetch } from '../helpers'

const EMPTY: FinesPage = { fines: [], total: 0, page: 1, pageSize: 25 }

const urlOf = (fetch: ReturnType<typeof mockFetch>, index = 0) => new URL(String(fetch.mock.calls[index][0]))

describe('fines API', () => {
  it('fetches a page with the token, search, status, page and the 25-row page size', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/fines': () => json(200, EMPTY) })
    await expect(fetchFines({ search: 'aditi', status: 'outstanding', page: 2 })).resolves.toEqual(EMPTY)
    expect(urlOf(fetch).pathname).toBe('/admin/fines')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(urlOf(fetch).searchParams.get('search')).toBe('aditi')
    expect(urlOf(fetch).searchParams.get('status')).toBe('outstanding')
    expect(urlOf(fetch).searchParams.get('page')).toBe('2')
    expect(urlOf(fetch).searchParams.get('pageSize')).toBe('25')
    expect(FINES_PAGE_SIZE).toBe(25)
  })

  it('omits a blank search and the status "all"', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/fines': () => json(200, EMPTY) })
    await fetchFines({ search: '   ', status: 'all', page: 1 })
    const q = urlOf(fetch).searchParams
    expect(q.has('search')).toBe(false)
    expect(q.has('status')).toBe(false)
    expect(q.get('page')).toBe('1')
    expect(q.get('pageSize')).toBe('25')
  })

  it('trims the search and encodes what is typed', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/fines': () => json(200, EMPTY) })
    await fetchFines({ search: '  a&b=c%_ "x"  ', status: 'paid', page: 1 })
    const q = urlOf(fetch).searchParams
    expect(q.get('search')).toBe('a&b=c%_ "x"')
    // The status, page and size survive a search that looks like more query string.
    expect(q.get('status')).toBe('paid')
    expect(q.get('page')).toBe('1')
    expect(q.has('b')).toBe(false)
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/fines': () => json(400, { error: 'Search is too long.' }) })
    const error = await fetchFines({ search: 'x', status: 'all', page: 1 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe('Search is too long.')
  })
})

describe('fine writes', () => {
  it('marks a fine paid with POST, the token and no body', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/fines/f1/paid': () => json(200, { id: 'f1', status: 'paid' }) })
    await expect(markFinePaid('f1')).resolves.toEqual({ id: 'f1', status: 'paid' })
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(fetch.mock.calls[0][1]!.body).toBeUndefined()
  })

  it('adjusts with POST, the amount and the trimmed reason', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/fines/f1/adjust': () => json(200, { id: 'f1', status: 'adjusted' }) })
    await expect(adjustFine('f1', 50, '  Student showed the receipt ')).resolves.toEqual({ id: 'f1', status: 'adjusted' })
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(fetch.mock.calls[0][1]!.body).toBe('{"amount":50,"reason":"Student showed the receipt"}')
  })

  it('sends amount 0 as 0 to waive', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/fines/f1/adjust': () => json(200, {}) })
    await adjustFine('f1', 0, 'Damaged already')
    expect(fetch.mock.calls[0][1]!.body).toBe('{"amount":0,"reason":"Damaged already"}')
  })

  it('encodes the fine id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'POST /admin/fines/a%2Fb/paid': () => json(200, {}),
      'POST /admin/fines/a%2Fb/adjust': () => json(200, {}),
    })
    await markFinePaid('a/b')
    await adjustFine('a/b', 1, 'x')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/fines\/a%2Fb\/paid$/)
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/admin\/fines\/a%2Fb\/adjust$/)
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/fines/f1/paid': () => json(409, { error: 'This fine is already paid.' }) })
    const error = await markFinePaid('f1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).message).toBe('This fine is already paid.')
  })
})

describe('FINE_STATUS_FILTERS', () => {
  it('offers All statuses, Accruing, Outstanding, Adjusted, Paid and Waived, and no Disputed', () => {
    expect(FINE_STATUS_FILTERS.map((f) => f.label)).toEqual(['All statuses', 'Accruing', 'Outstanding', 'Adjusted', 'Paid', 'Waived'])
    expect(FINE_STATUS_FILTERS.map((f) => f.value)).toEqual(['all', 'accruing', 'outstanding', 'adjusted', 'paid', 'waived'])
  })
})
