'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLoader } from './useLoader'

/** How long typing must pause before the search is sent. */
export const SEARCH_DEBOUNCE_MS = 300

/** What a list page asks the server for: a trimmed search ('' for none), a status ('all' for any) and a 1-based page. */
export interface ListQuery<Status extends string = never> {
  search: string
  status: Status | 'all'
  page: number
}

/**
 * The search, filter and paging state of a list page that fetches its own rows (Bookings, Fines),
 * with the loading on top (`useLoader`): a new query shows the skeleton, `refresh()` asks the same one again, quietly.
 *
 * - `searchInput` is what the box shows and never waits; `search` is what was last sent, 300 ms
 *   after the last keystroke. Spaces alone send nothing.
 * - A new search or status returns to page 1 in the same update, so the old page is never asked with the new filter.
 * - `clearFilters()` resets all of it at once, with no debounce.
 * - `pastEnd` is true while the page asked for is gone (rows were removed while the librarian was on
 *   the last page); the hook moves to the last page by itself, and the page should show its skeleton meanwhile.
 *
 * `fetchPage` needs a stable identity (a module-level function), or it refetches on every render.
 * `rowCount` only says how many rows a reply holds. A page with a search but no status filter
 * leaves `Status` out: `status` then stays 'all'.
 */
export function useListQuery<Data extends { total: number; pageSize: number }, Status extends string = never>(
  fetchPage: (query: ListQuery<Status>) => Promise<Data>,
  rowCount: (data: Data) => number,
) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatusOnly] = useState<Status | 'all'>('all')
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

  const fetcher = useCallback(() => fetchPage({ search, status, page }), [fetchPage, search, status, page])
  const { state, refresh, retry } = useLoader(fetcher)

  const data = state.kind === 'loaded' ? state.data : null
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const pastEnd = data !== null && rowCount(data) === 0 && data.total > 0 && page > lastPage
  useEffect(() => {
    if (pastEnd) setPage(lastPage)
  }, [pastEnd, lastPage])

  const setStatus = (next: Status | 'all') => {
    setStatusOnly(next)
    setPage(1)
  }
  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setStatusOnly('all')
    setPage(1)
  }

  return {
    state, data, refresh, retry,
    searchInput, setSearchInput, search,
    status, setStatus,
    page, setPage,
    filtered: search !== '' || status !== 'all',
    pastEnd, clearFilters,
  }
}
