'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookingsTable } from '@/components/bookings/BookingsTable'
import { BookingsEmpty, BookingsError, BookingsFilterEmpty, BookingsSkeleton } from '@/components/bookings/BookingsStates'
import { Pager } from '@/components/bookings/Pager'
import { BOOKING_STATUS_FILTERS, bookingsRange, fetchBookings, type BookingStatus } from '@/lib/bookings'
import { useLiveRefresh } from '@/lib/liveContext'
import { useLoader } from '@/lib/useLoader'

type StatusFilter = BookingStatus | 'all'

/** How long typing must pause before the search is sent. */
const SEARCH_DEBOUNCE_MS = 300

export default function BookingsPage() {
  // What the box shows, and what was last sent: the box never waits, the request does.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const next = searchInput.trim()
    if (next === search) return // already sent, or only spaces
    const timer = setTimeout(() => {
      setSearch(next)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput, search])

  // A new query shows the skeleton; a live refresh asks the same query again, quietly.
  const fetcher = useCallback(() => fetchBookings({ search, status, page }), [search, status, page])
  const { state, refresh, retry } = useLoader(fetcher)
  useLiveRefresh(['bookings'], () => void refresh())

  const data = state.kind === 'loaded' ? state.data : null
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  // Rows were removed while the librarian was on the last page: the page they were on is gone.
  const pastEnd = data !== null && data.bookings.length === 0 && data.total > 0 && page > lastPage
  useEffect(() => {
    if (pastEnd) setPage(lastPage)
  }, [pastEnd, lastPage])

  const filtered = search !== '' || status !== 'all'
  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setStatus('all')
    setPage(1)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          aria-label="Search bookings"
          placeholder="Search student or resource"
          maxLength={100}
          style={{ maxWidth: 240 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className="input"
          aria-label="Filter by status"
          style={{ maxWidth: 170 }}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter)
            setPage(1)
          }}
        >
          {BOOKING_STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {data && !pastEnd ? bookingsRange(data.page, data.pageSize, data.total) : ''}
        </span>
      </div>

      {state.kind === 'loading' || pastEnd ? (
        <BookingsSkeleton />
      ) : state.kind === 'error' ? (
        <BookingsError onRetry={retry} />
      ) : state.data.bookings.length === 0 ? (
        filtered ? <BookingsFilterEmpty onClear={clearFilters} /> : <BookingsEmpty />
      ) : (
        <>
          <BookingsTable bookings={state.data.bookings} />
          <Pager page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onPage={setPage} />
        </>
      )}
    </>
  )
}
