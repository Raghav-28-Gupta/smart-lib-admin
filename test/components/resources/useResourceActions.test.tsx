import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useResourceActions } from '@/components/resources/useResourceActions'
import type { AdminResource } from '@/lib/resources'
import { json, mockFetch } from '../../helpers'

const OFFLINE_ROOM: AdminResource = {
  id: 'r3', type: 'room', name: 'Group Room 105', location: '1st Floor, West Wing', capacity: 8,
  status: 'offline', statusNote: 'Projector bulb replacement', upcomingBookings: 1,
}

describe('useResourceActions', () => {
  it('sends one request when a second write starts before the first has finished', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = mockFetch({
      'POST /admin/resources/r3/online': async () => {
        await gate
        return json(200, { ...OFFLINE_ROOM, status: 'available', statusNote: null })
      },
    })
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useResourceActions(refresh))

    // Both calls happen in one act, so React has not re-rendered between them: `busy` is still false
    // for the second call, and only the in-flight ref can stop it.
    act(() => {
      void result.current.bringOnline(OFFLINE_ROOM)
      void result.current.bringOnline(OFFLINE_ROOM)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.busy).toBe(true))

    release()
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)

    // The guard lets go afterwards: the next write is sent.
    await act(async () => {
      await result.current.bringOnline(OFFLINE_ROOM)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('does not start a different write while one is in flight either', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = mockFetch({
      'POST /admin/resources/r3/offline': async () => {
        await gate
        return json(200, OFFLINE_ROOM)
      },
      'POST /admin/resources/r3/online': () => json(200, OFFLINE_ROOM),
    })
    const { result } = renderHook(() => useResourceActions(async () => {}))

    act(() => {
      void result.current.takeOffline(OFFLINE_ROOM, 'Bulb')
      void result.current.bringOnline(OFFLINE_ROOM)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/offline$/)

    release()
    await waitFor(() => expect(result.current.busy).toBe(false))
  })
})
