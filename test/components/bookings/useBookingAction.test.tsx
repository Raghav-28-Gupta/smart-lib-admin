import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useBookingAction } from '@/components/bookings/useBookingAction'
import type { AdminBooking, ReassignOption } from '@/lib/bookings'
import { json, mockFetch } from '../../helpers'

const BOOKED: AdminBooking = {
  id: 'b1', resource: { id: 'r2', name: 'Group Room 201', type: 'room' }, student: { id: 's2', name: 'Rohan Verma', email: 'rohan@example.edu' },
  startTime: new Date(Date.now() + 86_400_000).toISOString(), endTime: new Date(Date.now() + 90_000_000).toISOString(),
  status: 'booked', cancelledBy: null, cancelReason: null, movedFromName: null, canManage: true,
}
const OPTION: ReassignOption = { id: 'r9', name: 'Group Room 202', location: null, capacity: 6 }

describe('useBookingAction', () => {
  it('does not start a reassign while a cancel is in flight, and lets go afterwards', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = mockFetch({
      'POST /admin/bookings/b1/cancel': async () => {
        await gate
        return json(200, BOOKED)
      },
      'POST /admin/bookings/b1/reassign': () => json(200, BOOKED),
    })
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useBookingAction(refresh))

    // One act: React has not re-rendered between the calls, so only the shared in-flight guard can stop the second.
    act(() => {
      void result.current.cancel(BOOKED, 'Room needed')
      void result.current.reassign(BOOKED, OPTION)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/cancel$/)
    await waitFor(() => expect(result.current.busy).toBe(true))

    release()
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.reassign(BOOKED, OPTION)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/reassign$/)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
