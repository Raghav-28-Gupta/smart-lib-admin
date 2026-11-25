import { apiRequest } from './api'

export type RequestKind = 'borrow' | 'room'

/**
 * How the list is ordered: 'suggested' (the server's default: room requests by a bounded priority, borrow
 * requests by request time) or 'request' (plain request time, for the "By request time" toggle).
 */
export type RequestOrder = 'suggested' | 'request'

/**
 * A scored room request's place in the suggested order. Absent when the booking was never scored.
 * `suggestedDelayMinutes` is a whole number of minutes (0 to 72): how much later than its request time
 * the request sits. `riskPercent` is the predicted no-show risk, or null when the server gives none.
 */
export interface RoomPriority {
  suggestedDelayMinutes: number
  riskPercent: number | null
}

// GET /admin/requests (backend: src/services/adminRequestService.ts).
export interface PendingRequest {
  id: string
  kind: RequestKind
  student: { id: string; name: string; email: string }
  requestedAt: string
  expiresAt: string
  book?: { id: string; title: string; author: string; availableCopies: number; totalCopies: number }
  room?: { resourceId: string; name: string; location: string | null; startTime: string; endTime: string; priority?: RoomPriority }
}

export interface PendingRequests {
  requests: PendingRequest[]
  counts: { all: number; borrow: number; room: number }
}

/** The suggested order is the server's default, so only plain request time is asked for by name. */
export function fetchPendingRequests(order: RequestOrder = 'suggested'): Promise<PendingRequests> {
  return apiRequest<PendingRequests>(order === 'request' ? '/admin/requests?order=request' : '/admin/requests')
}

export function approveRequest(r: Pick<PendingRequest, 'kind' | 'id'>): Promise<unknown> {
  return apiRequest(`/admin/requests/${r.kind}/${encodeURIComponent(r.id)}/approve`, { method: 'POST' })
}

/** The reason is optional: blank sends none, and the student sees "Declined by the library". */
export function declineRequest(r: Pick<PendingRequest, 'kind' | 'id'>, reason: string): Promise<unknown> {
  const trimmed = reason.trim()
  return apiRequest(`/admin/requests/${r.kind}/${encodeURIComponent(r.id)}/decline`, {
    method: 'POST',
    body: trimmed ? { reason: trimmed } : {},
  })
}
