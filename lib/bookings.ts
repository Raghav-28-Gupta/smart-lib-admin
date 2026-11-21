import { apiRequest } from './api'

/**
 * The status the library sees, derived by the server at read time (a booked row whose
 * grace period is over is `released`; a checked-in row past its end is `completed`).
 */
export type BookingStatus = 'booked' | 'released' | 'checked_in' | 'completed' | 'cancelled'

// GET /admin/bookings (backend: src/services/adminBookingService.ts).
export interface AdminBooking {
  id: string
  resource: { id: string; name: string; type: 'seat' | 'room' }
  student: { id: string; name: string; email: string }
  /** ISO timestamps (UTC); show them in the library time zone. */
  startTime: string
  endTime: string
  status: BookingStatus
  /** Set only on a cancelled booking. */
  cancelledBy: 'student' | 'library' | null
  /** The librarian's reason; null when there was none (or the student cancelled). */
  cancelReason: string | null
  /** The old resource's name when a librarian moved the booking. */
  movedFromName: string | null
  /** True while the librarian can still cancel or reassign it. */
  canManage: boolean
}

export interface BookingsPage {
  bookings: AdminBooking[]
  total: number
  page: number
  pageSize: number
}

export const BOOKINGS_PAGE_SIZE = 25

/** The status select's options, in the canvas's order. The canvas's No-show option is left out, as the spec says. */
export const BOOKING_STATUS_FILTERS: { value: BookingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'booked', label: 'Booked' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'completed', label: 'Completed' },
  { value: 'released', label: 'Released (grace period)' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** Newest start first, 25 to a page. A blank search and the status 'all' send no parameter. */
export function fetchBookings(q: { search: string; status: BookingStatus | 'all'; page: number }): Promise<BookingsPage> {
  const params = new URLSearchParams()
  const search = q.search.trim()
  if (search) params.set('search', search)
  if (q.status !== 'all') params.set('status', q.status)
  params.set('page', String(q.page))
  params.set('pageSize', String(BOOKINGS_PAGE_SIZE))
  return apiRequest<BookingsPage>(`/admin/bookings?${params.toString()}`)
}

/** "1–25 of 60 bookings", "51 of 51 bookings", "1 of 1 booking", "0 bookings". */
export function bookingsRange(page: number, pageSize: number, total: number): string {
  const noun = total === 1 ? 'booking' : 'bookings'
  if (total === 0) return `0 ${noun}`
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return `${from === to ? from : `${from}–${to}`} of ${total} ${noun}`
}
