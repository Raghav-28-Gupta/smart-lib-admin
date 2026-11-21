import { act, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/Toasts'
import { useWriteAction } from '@/components/useWriteAction'
import { ApiError } from '@/lib/api'

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>

/** A promise the test settles by hand. */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe('useWriteAction', () => {
  it('runs the action, toasts the success message and refreshes', async () => {
    const order: string[] = []
    const refresh = vi.fn(async () => {
      order.push('refresh')
    })
    const { result } = renderHook(() => useWriteAction(refresh), { wrapper })

    await act(async () => {
      await result.current.run(async () => {
        order.push('action')
      }, 'Saved.')
    })

    expect(order).toEqual(['action', 'refresh'])
    expect(screen.getByText('Saved.')).toBeInTheDocument()
    expect(result.current.busy).toBe(false)
  })

  it("toasts the server's message unchanged when the action is refused, and still refreshes", async () => {
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useWriteAction(refresh), { wrapper })

    await act(async () => {
      await result.current.run(async () => {
        throw new ApiError(409, 'The student already checked in.')
      }, 'Saved.')
    })

    expect(screen.getByText('The student already checked in.')).toBeInTheDocument()
    expect(screen.queryByText('Saved.')).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows a generic line only when the failure carries no message from the server', async () => {
    const { result } = renderHook(() => useWriteAction(async () => {}), { wrapper })
    await act(async () => {
      await result.current.run(async () => {
        throw new TypeError('boom')
      }, 'Saved.')
    })
    expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument()
  })

  it.each([401, 403])('leaves a %i to ConsoleGuard: no toast', async (status) => {
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useWriteAction(refresh), { wrapper })
    await act(async () => {
      await result.current.run(async () => {
        throw new ApiError(status, 'Session over.')
      }, 'Saved.')
    })
    expect(screen.queryByText('Session over.')).toBeNull()
    expect(screen.queryByText('Saved.')).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(result.current.busy).toBe(false)
  })

  it('stays busy until the refresh has finished', async () => {
    const refreshing = gate()
    const refresh = vi.fn(() => refreshing.promise)
    const { result } = renderHook(() => useWriteAction(refresh), { wrapper })

    let done!: Promise<void>
    act(() => {
      done = result.current.run(async () => {}, 'Saved.')
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(result.current.busy).toBe(true) // the action is over, the list is not back yet

    await act(async () => {
      refreshing.open()
      await done
    })
    expect(result.current.busy).toBe(false)
  })

  it('does nothing when a second run starts before the first has finished', async () => {
    const release = gate()
    const first = vi.fn(async () => {
      await release.promise
    })
    const second = vi.fn(async () => {})
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useWriteAction(refresh), { wrapper })

    // One act, so React has not re-rendered between the calls: only the in-flight ref can stop the second.
    act(() => {
      void result.current.run(first, 'First.')
      void result.current.run(second, 'Second.')
    })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    release.open()
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(refresh).toHaveBeenCalledTimes(1)

    // The guard lets go afterwards.
    await act(async () => {
      await result.current.run(second, 'Second.')
    })
    expect(second).toHaveBeenCalledTimes(1)
  })
})
