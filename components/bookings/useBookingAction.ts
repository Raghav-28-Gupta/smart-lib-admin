'use client'

import { useWriteAction } from '@/components/useWriteAction'
import { cancelBooking, reassignBooking, type AdminBooking, type ReassignOption } from '@/lib/bookings'

/**
 * The Bookings page's writes, through the console's shared write action: one at a time, the
 * server's 409 ("The student already checked in.", "That resource is taken at this time.") as a
 * toast, and `busy` until the list has been refetched, so a row cannot be acted on twice.
 */
export function useBookingAction(refresh: () => Promise<void>) {
  const { busy, run } = useWriteAction(refresh)

  return {
    busy,
    cancel: (booking: AdminBooking, reason: string) =>
      run(() => cancelBooking(booking.id, reason), `Cancelled ${booking.student.name}'s booking of ${booking.resource.name}.`),
    reassign: (booking: AdminBooking, target: ReassignOption) =>
      run(() => reassignBooking(booking.id, target.id), `Moved ${booking.student.name}'s booking to ${target.name}.`),
  }
}
