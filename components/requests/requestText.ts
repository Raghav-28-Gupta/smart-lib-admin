// The words a request is shown with: on its card, in the Dashboard panel, in
// the decline dialog and in the toasts. Times are the library's.
import { LIBRARY_TIMEZONE, clockTime, shortDay, timeSpan, waitingLabel } from '@/lib/format'
import type { PendingRequest } from '@/lib/requests'

function slotText(r: PendingRequest): string {
  const room = r.room!
  return `${shortDay(room.startTime, LIBRARY_TIMEZONE)} · ${timeSpan(room.startTime, room.endTime, LIBRARY_TIMEZONE)}`
}

/** The card's main line: "Clean Code — Robert C. Martin", or the room's name. */
export function requestTitle(r: PendingRequest): string {
  return r.kind === 'borrow' ? `${r.book!.title} — ${r.book!.author}` : r.room!.name
}

/** The card's detail line, as of `now` (ms). */
export function requestDetail(r: PendingRequest, now: number): string {
  if (r.kind === 'borrow') {
    const book = r.book!
    return `${book.availableCopies} of ${book.totalCopies} copies left · expires in ${waitingLabel(Date.parse(r.expiresAt) - now)}`
  }
  return `${slotText(r)} · slot held until ${clockTime(r.expiresAt, LIBRARY_TIMEZONE)}`
}

/**
 * The card's note on a room request that the suggested order puts later than its request time, or null when
 * there is nothing to say (a borrow request, a booking never scored, a delay of zero). Plain, neutral words:
 * the number of minutes and the predicted risk are the server's, shown as sent.
 */
export function suggestedOrderNote(r: PendingRequest): string | null {
  const priority = r.room?.priority
  if (!priority || !(priority.suggestedDelayMinutes > 0)) return null
  const later = `Suggested order: ${priority.suggestedDelayMinutes} min later`
  return typeof priority.riskPercent === 'number' ? `${later} (predicted no-show risk ${priority.riskPercent}%)` : later
}

/** What is asked for: the book's title, or the room and its slot. */
export function requestSubject(r: PendingRequest): string {
  return r.kind === 'borrow' ? r.book!.title : `${r.room!.name} · ${slotText(r)}`
}

/** A Dashboard row: "Aditi Sharma · Clean Code", "Rohan Verma · Group Room 201 · 2–3 PM". */
export function requestRow(r: PendingRequest): string {
  if (r.kind === 'borrow') return `${r.student.name} · ${r.book!.title}`
  const room = r.room!
  return `${r.student.name} · ${room.name} · ${timeSpan(room.startTime, room.endTime, LIBRARY_TIMEZONE)}`
}

export function approvedToast(r: PendingRequest): string {
  return r.kind === 'borrow'
    ? `Approved. ${r.student.name}'s loan of ${r.book!.title} starts now.`
    : `Approved. ${r.room!.name} is booked for ${r.student.name}.`
}

export function declinedToast(r: PendingRequest): string {
  return `Declined. ${r.student.name} will see it in the app.`
}
