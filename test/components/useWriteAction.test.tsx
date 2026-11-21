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

  it("can word the success toast from the action's result", async () => {
    const { result } = renderHook(() => useWriteAction(async () => {}), { wrapper })

    await act(async () => {
      await result.current.run(async () => ({ waived: false }), (reply) => (reply.waived ? 'Waived.' : 'Not waived.'))
    })

    expect(screen.getByText('Not waived.')).toBeInTheDocument()
    expect(screen.queryByText('Waived.')).toBeNull()
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

    let done!: Promise<boolean>
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

  it('run resolves true on success and false on failure, and false for an ignored second call', async () => {
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useWriteAction(refresh), { wrapper })
    const run = async (action: () => Promise<unknown>) => {
      let outcome!: boolean
      await act(async () => {
        outcome = await result.current.run(action, 'Saved.')
      })
      return outcome
    }

    expect(await run(async () => {})).toBe(true)
    // Every kind of failure is false, and each still toasts (or not, for a 401) and refreshes as before.
    expect(await run(async () => { throw new ApiError(409, 'Already there.') })).toBe(false)
    expect(await run(async () => { throw new TypeError('boom') })).toBe(false)
    expect(await run(async () => { throw new ApiError(401, 'Session over.') })).toBe(false)
    expect(refresh).toHaveBeenCalledTimes(4)

    // A second call while the first is in flight does nothing and says so; the first still resolves true.
    const release = gate()
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.run(() => release.promise, 'First.')
      second = result.current.run(async () => {}, 'Second.')
    })
    await expect(second).resolves.toBe(false)
    release.open()
    await act(async () => {
      await expect(first).resolves.toBe(true)
    })
    expect(refresh).toHaveBeenCalledTimes(5)
  })

  it('refreshes with the latest refresh, not the one from when the write started', async () => {
    const release = gate()
    const atStart = vi.fn(async () => {})
    const latest = vi.fn(async () => {})
    const { result, rerender } = renderHook(({ refresh }) => useWriteAction(refresh), {
      wrapper,
      initialProps: { refresh: atStart },
    })

    let done!: Promise<boolean>
    act(() => {
      done = result.current.run(() => release.promise, 'Saved.')
    })
    // A page whose list query changed meanwhile hands the hook a refresh for the new query.
    rerender({ refresh: latest })

    await act(async () => {
      release.open()
      await done
    })
    expect(latest).toHaveBeenCalledTimes(1)
    expect(atStart).not.toHaveBeenCalled()
  })

  it('lets go of the guard even when the refresh rejects', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('refresh failed')
    })
    const next = vi.fn(async () => {})
    const { result } = renderHook(() => useWriteAction(refresh), { wrapper })

    await act(async () => {
      await result.current.run(async () => {}, 'Saved.').catch(() => {})
    })
    expect(result.current.busy).toBe(false)

    await act(async () => {
      await result.current.run(next, 'Next.').catch(() => {})
    })
    expect(next).toHaveBeenCalledTimes(1)
  })
})
