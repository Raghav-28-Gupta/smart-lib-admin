// The canvas's tag classes for each booking status, shared by the Bookings table and the student page's booking history.
const BOOKING_STATUS_TAGS: Record<string, { label: string; cls: string }> = {
  booked: { label: 'Booked', cls: 'tag-neutral' },
  checked_in: { label: 'Checked in', cls: 'tag-neutral' },
  completed: { label: 'Completed', cls: 'tag-accent-2' },
  released: { label: 'Released', cls: 'tag-neutral' },
  cancelled: { label: 'Cancelled', cls: 'tag-neutral' },
  no_show: { label: 'No-show', cls: 'tag-accent' },
  // A student's history also holds the room requests. The canvas has no tags for their outcomes, so they take its fallback class.
  requested: { label: 'Requested', cls: 'tag-neutral' },
  declined: { label: 'Declined', cls: 'tag-neutral' },
  expired: { label: 'Expired', cls: 'tag-neutral' },
}

/** The label and tag class of a booking status. A status this console does not know (a newer server) shows as itself. */
export function bookingStatusTag(status: string): { label: string; cls: string } {
  return Object.hasOwn(BOOKING_STATUS_TAGS, status) ? BOOKING_STATUS_TAGS[status] : { label: status, cls: 'tag-neutral' }
}
