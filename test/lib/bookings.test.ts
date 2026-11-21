import { describe, expect, it } from 'vitest'
import { ApiError, writeToken } from '@/lib/api'
import { BOOKINGS_PAGE_SIZE, bookingsRange, fetchBookings, type BookingsPage } from '@/lib/bookings'
import { json, mockFetch } from '../helpers'

const EMPTY: BookingsPage = { bookings: [], total: 0, page: 1, pageSize: 25 }

const queryOf = (fetch: ReturnType<typeof mockFetch>) => new URL(String(fetch.mock.calls[0][0])).searchParams

describe('bookings API', () => {
  it('fetches a page with the token and the 25-row page size', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/bookings': () => json(200, EMPTY) })
    await expect(fetchBookings({ search: '', status: 'all', page: 1 })).resolves.toEqual(EMPTY)
    expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe('/admin/bookings')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(BOOKINGS_PAGE_SIZE).toBe(25)
    expect(queryOf(fetch).get('page')).toBe('1')
    expect(queryOf(fetch).get('pageSize')).toBe('25')
  })

  it('sends the status only when one is chosen', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/bookings': () => json(200, EMPTY) })
    await fetchBookings({ search: '', status: 'all', page: 1 })
    await fetchBookings({ search: '', status: 'checked_in', page: 1 })
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.has('status')).toBe(false)
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('status')).toBe('checked_in')
  })

  it('sends the page asked for', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/bookings': () => json(200, EMPTY) })
    await fetchBookings({ search: '', status: 'all', page: 3 })
    expect(queryOf(fetch).get('page')).toBe('3')
  })

  it('trims the search, sends none when it is blank, and encodes what is typed', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/bookings': () => json(200, EMPTY) })
    await fetchBookings({ search: '   ', status: 'all', page: 1 })
    await fetchBookings({ search: '  a&b=c%_ "x"  ', status: 'all', page: 1 })
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.has('search')).toBe(false)
    const url = new URL(String(fetch.mock.calls[1][0]))
    expect(url.searchParams.get('search')).toBe('a&b=c%_ "x"')
    // The page and size survive a search that looks like more query string.
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('pageSize')).toBe('25')
    expect(url.searchParams.has('b')).toBe(false)
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/bookings': () => json(400, { error: 'Search is too long.' }) })
    const error = await fetchBookings({ search: 'x', status: 'all', page: 1 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe('Search is too long.')
  })
})

describe('bookingsRange', () => {
  it('words the first, a middle and a short last page', () => {
    expect(bookingsRange(1, 25, 60)).toBe('1–25 of 60 bookings')
    expect(bookingsRange(2, 25, 60)).toBe('26–50 of 60 bookings')
    expect(bookingsRange(3, 25, 60)).toBe('51–60 of 60 bookings')
  })

  it('is singular for one booking and says "0 bookings" for none', () => {
    expect(bookingsRange(1, 25, 1)).toBe('1 of 1 booking')
    expect(bookingsRange(1, 25, 0)).toBe('0 bookings')
  })

  it('does not repeat a number when the last page holds one row', () => {
    expect(bookingsRange(3, 25, 51)).toBe('51 of 51 bookings')
  })
})
