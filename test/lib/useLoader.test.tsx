import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { useLoader } from '@/lib/useLoader'

/** A fetcher whose replies the test settles by hand, in any order. */
function controlled() {
  const pending: { resolve: (value: string) => void; reject: (error: unknown) => void }[] = []
  const fetcher = () =>
    new Promise<string>((resolve, reject) => {
      pending.push({ resolve, reject })
    })
  return { fetcher, pending }
}

describe('useLoader', () => {
  it('starts loading, then holds the data', async () => {
    const { fetcher, pending } = controlled()
    const { result } = renderHook(() => useLoader(fetcher))
    expect(result.current.state).toEqual({ kind: 'loading' })
    await act(async () => pending[0].resolve('a'))
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'a' })
  })

  it('shows the error state when the first load fails, and retry shows the skeleton first', async () => {
    const { fetcher, pending } = controlled()
    const { result } = renderHook(() => useLoader(fetcher))
    await act(async () => pending[0].reject(new ApiError(500, 'x')))
    expect(result.current.state).toEqual({ kind: 'error' })

    act(() => result.current.retry())
    expect(result.current.state).toEqual({ kind: 'loading' })
    await act(async () => pending[1].resolve('b'))
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'b' })
  })

  it('a quiet refresh keeps the data on screen while it runs and after it fails', async () => {
    const { fetcher, pending } = controlled()
    const { result } = renderHook(() => useLoader(fetcher))
    await act(async () => pending[0].resolve('a'))

    let done!: Promise<void>
    act(() => {
      done = result.current.refresh()
    })
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'a' })
    await act(async () => {
      pending[1].reject(new ApiError(500, 'x'))
      await done
    })
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'a' })

    // ...and when it succeeds, the new data replaces the old.
    act(() => {
      done = result.current.refresh()
    })
    await act(async () => {
      pending[2].resolve('c')
      await done
    })
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'c' })
  })

  it('a quiet refresh that fails before anything has loaded still ends in the error state', async () => {
    const { fetcher, pending } = controlled()
    const { result } = renderHook(() => useLoader(fetcher))
    act(() => void result.current.refresh()) // supersedes the first load
    await act(async () => pending[1].reject(new ApiError(500, 'x')))
    expect(result.current.state).toEqual({ kind: 'error' })
  })

  it('only the newest request may write: an older reply that arrives late is dropped', async () => {
    const { fetcher, pending } = controlled()
    const { result } = renderHook(() => useLoader(fetcher))
    act(() => void result.current.refresh())
    await act(async () => pending[1].resolve('new'))
    await act(async () => pending[0].resolve('old'))
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'new' })
  })

  it('a different fetcher shows the skeleton and drops the reply to the old one', async () => {
    const first = controlled()
    const second = controlled()
    const { result, rerender } = renderHook(({ fetcher }) => useLoader(fetcher), { initialProps: { fetcher: first.fetcher } })
    await act(async () => first.pending[0].resolve('a'))
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'a' })

    rerender({ fetcher: second.fetcher })
    await waitFor(() => expect(result.current.state).toEqual({ kind: 'loading' }))
    // A quiet refresh now asks the new fetcher, never the old one.
    act(() => void result.current.refresh())
    expect(first.pending).toHaveLength(1)
    expect(second.pending).toHaveLength(2)

    await act(async () => second.pending[1].resolve('c'))
    await act(async () => second.pending[0].resolve('b'))
    expect(result.current.state).toEqual({ kind: 'loaded', data: 'c' })
  })

  it('leaves a 401 or 403 to ConsoleGuard: no error state, no data', async () => {
    const { fetcher, pending } = controlled()
    const { result } = renderHook(() => useLoader(fetcher))
    await act(async () => pending[0].reject(new ApiError(401, 'expired')))
    expect(result.current.state).toEqual({ kind: 'loading' })
  })
})
