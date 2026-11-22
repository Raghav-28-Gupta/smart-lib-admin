import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS, useListQuery, type ListQuery } from '@/lib/useListQuery'

interface Reply {
  rows: string[]
  total: number
  pageSize: number
}
type Status = 'open' | 'closed'

const ONE_ROW: Reply = { rows: ['r'], total: 1, pageSize: 25 }
const rowCount = (data: Reply) => data.rows.length

/** The hook over a fetcher that answers `answer`; `queries()` lists the queries it was asked, in order. */
function setup(answer: (query: ListQuery<Status>) => Reply = () => ONE_ROW) {
  const fetchPage = vi.fn(async (query: ListQuery<Status>) => answer(query))
  const renders: { page: number; pastEnd: boolean }[] = []
  const hook = renderHook(() => {
    const list = useListQuery<Reply, Status>(fetchPage, rowCount)
    renders.push({ page: list.page, pastEnd: list.pastEnd })
    return list
  })
  return { ...hook, fetchPage, renders, queries: () => fetchPage.mock.calls.map(([query]) => query) }
}

const settle = (hook: ReturnType<typeof setup>) => waitFor(() => expect(hook.result.current.state.kind).toBe('loaded'))
// Fake timers here use `shouldAdvanceTime`, so the fake clock also creeps forward with real time (that is what lets
// `waitFor` poll). It only creeps while the test yields to the event loop, so a step that must stop short of the
// debounce deadline may not yield: `advance` is a synchronous `act` with no `await`, nothing can move the clock
// between it and the next line. `advancePast` is for steps that cross the deadline or wait to prove nothing else
// fires; it yields (microtasks flush, the clock may creep), which can only make a timer fire sooner, never mask one.
const advance = (ms: number) => {
  act(() => void vi.advanceTimersByTime(ms))
}
const advancePast = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

afterEach(() => {
  vi.useRealTimers()
})

describe('useListQuery', () => {
  it('starts on page 1 with no search and every status, and loads that query', async () => {
    const hook = setup()
    await settle(hook)
    expect(hook.queries()).toEqual([{ search: '', status: 'all', page: 1 }])
    expect(hook.result.current.searchInput).toBe('')
    expect(hook.result.current.filtered).toBe(false)
    expect(hook.result.current.state).toEqual({ kind: 'loaded', data: ONE_ROW })
    expect(hook.result.current.data).toEqual(ONE_ROW)
  })

  it('sends one search 300 ms after the last keystroke, and the box itself never waits', async () => {
    const hook = setup()
    await settle(hook)
    vi.useFakeTimers({ shouldAdvanceTime: true })

    act(() => hook.result.current.setSearchInput('a'))
    advance(200)
    act(() => hook.result.current.setSearchInput('ana')) // typing again restarts the wait
    advance(SEARCH_DEBOUNCE_MS - 1) // 1 ms short of the deadline: no await from here to the assertions below
    expect(hook.fetchPage).toHaveBeenCalledTimes(1)
    expect(hook.result.current.searchInput).toBe('ana')
    expect(hook.result.current.search).toBe('')

    await advancePast(2)
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(2))
    expect(hook.queries()[1]).toEqual({ search: 'ana', status: 'all', page: 1 })
    expect(hook.result.current.search).toBe('ana')
    expect(hook.result.current.filtered).toBe(true)

    await advancePast(1_000)
    expect(hook.fetchPage).toHaveBeenCalledTimes(2) // one request, not one per keystroke
  })

  it('trims the search, and a search of only spaces sends nothing', async () => {
    const hook = setup()
    await settle(hook)
    vi.useFakeTimers({ shouldAdvanceTime: true })

    act(() => hook.result.current.setSearchInput('   '))
    await advancePast(1_000)
    expect(hook.fetchPage).toHaveBeenCalledTimes(1)

    act(() => hook.result.current.setSearchInput('  ana '))
    await advancePast(SEARCH_DEBOUNCE_MS + 1)
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(2))
    expect(hook.queries()[1].search).toBe('ana')
    expect(hook.result.current.searchInput).toBe('  ana ') // the box keeps what was typed
  })

  it('a new search returns to page 1 in the same update, so the old page is never asked with it', async () => {
    const hook = setup()
    await settle(hook)
    act(() => hook.result.current.setPage(2))
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(2))
    vi.useFakeTimers({ shouldAdvanceTime: true })

    act(() => hook.result.current.setSearchInput('x'))
    await advancePast(SEARCH_DEBOUNCE_MS + 1)
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(3))
    await advancePast(1_000)
    expect(hook.queries()).toEqual([
      { search: '', status: 'all', page: 1 },
      { search: '', status: 'all', page: 2 },
      { search: 'x', status: 'all', page: 1 }, // never { search: 'x', page: 2 }
    ])
    expect(hook.result.current.page).toBe(1)
  })

  it('changing the status returns to page 1 in the same update', async () => {
    const hook = setup()
    await settle(hook)
    act(() => hook.result.current.setPage(3))
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(2))

    act(() => hook.result.current.setStatus('open'))
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(3))
    expect(hook.queries()[2]).toEqual({ search: '', status: 'open', page: 1 })
    expect(hook.result.current.status).toBe('open')
    expect(hook.result.current.filtered).toBe(true)

    act(() => hook.result.current.setStatus('all'))
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(4))
    expect(hook.queries()[3]).toEqual({ search: '', status: 'all', page: 1 })
    expect(hook.result.current.filtered).toBe(false)
  })

  it('clearFilters resets the box, the search, the status and the page at once, with no debounce', async () => {
    const hook = setup()
    await settle(hook)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    act(() => hook.result.current.setStatus('closed'))
    act(() => hook.result.current.setPage(2))
    act(() => hook.result.current.setSearchInput('x'))
    await advancePast(SEARCH_DEBOUNCE_MS + 1)
    await waitFor(() => expect(hook.result.current.search).toBe('x'))
    await waitFor(() => expect(hook.queries().at(-1)).toEqual({ search: 'x', status: 'closed', page: 1 }))
    const before = hook.fetchPage.mock.calls.length

    act(() => hook.result.current.clearFilters())
    expect(hook.result.current.searchInput).toBe('')
    expect(hook.result.current.search).toBe('')
    expect(hook.result.current.status).toBe('all')
    expect(hook.result.current.page).toBe(1)
    expect(hook.result.current.filtered).toBe(false)
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(before + 1))
    expect(hook.queries().at(-1)).toEqual({ search: '', status: 'all', page: 1 })

    await advancePast(1_000)
    expect(hook.fetchPage).toHaveBeenCalledTimes(before + 1) // clearing did not wait out a debounce, nor leave one behind
  })

  it('clearFilters drops a search that was typed but not yet sent', async () => {
    const hook = setup()
    await settle(hook)
    vi.useFakeTimers({ shouldAdvanceTime: true })

    act(() => hook.result.current.setSearchInput('abc'))
    advance(100) // no yield before clearFilters: the clock cannot creep up to the deadline first
    act(() => hook.result.current.clearFilters())
    await advancePast(1_000)
    expect(hook.fetchPage).toHaveBeenCalledTimes(1)
    expect(hook.result.current.searchInput).toBe('')
  })

  it('when the page asked for is gone, pastEnd holds until the hook has moved to the last page', async () => {
    // 30 rows in two pages of 25 and 5: page 3 is past the end and comes back empty.
    const hook = setup((query) => (query.page > 2 ? { rows: [], total: 30, pageSize: 25 } : { rows: ['r'], total: 30, pageSize: 25 }))
    await settle(hook)

    act(() => hook.result.current.setPage(3))
    await waitFor(() => expect(hook.result.current.page).toBe(2))
    await waitFor(() => expect(hook.queries().at(-1)).toEqual({ search: '', status: 'all', page: 2 }))
    await waitFor(() => expect(hook.result.current.pastEnd).toBe(false))
    expect(hook.queries().map((q) => q.page)).toEqual([1, 3, 2])
    // pastEnd was true while page 3's empty reply was on screen, so a page can show its skeleton instead of "no match".
    expect(hook.renders.some((r) => r.page === 3 && r.pastEnd)).toBe(true)
  })

  it('an empty page with nothing behind it is not past the end', async () => {
    const hook = setup(() => ({ rows: [], total: 0, pageSize: 25 }))
    await settle(hook)
    expect(hook.result.current.pastEnd).toBe(false)
    expect(hook.result.current.page).toBe(1)
    expect(hook.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('a refresh asks the same query again without the skeleton', async () => {
    const hook = setup()
    await settle(hook)
    act(() => hook.result.current.setPage(2))
    await waitFor(() => expect(hook.fetchPage).toHaveBeenCalledTimes(2))
    await settle(hook)

    await act(async () => void (await hook.result.current.refresh()))
    expect(hook.fetchPage).toHaveBeenCalledTimes(3)
    expect(hook.queries()[2]).toEqual(hook.queries()[1])
    expect(hook.result.current.state.kind).toBe('loaded')
  })

  it('a page with a search but no status filter can use it: the status stays "all"', async () => {
    const fetchPage = vi.fn(async (query: { search: string; page: number }) => {
      void query
      return ONE_ROW
    })
    const { result } = renderHook(() => useListQuery<Reply>(fetchPage, rowCount))
    await waitFor(() => expect(result.current.state.kind).toBe('loaded'))
    expect(result.current.status).toBe('all')
    expect(result.current.filtered).toBe(false)

    vi.useFakeTimers({ shouldAdvanceTime: true })
    act(() => result.current.setSearchInput('x'))
    await advancePast(SEARCH_DEBOUNCE_MS + 1)
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2))
    expect(fetchPage.mock.calls[1][0]).toMatchObject({ search: 'x', page: 1 })
    expect(result.current.filtered).toBe(true)
  })
})
