import { apiRequest } from './api'

export type RequestKind = 'borrow' | 'room'

// GET /admin/requests (backend: src/services/adminRequestService.ts).
export interface PendingRequest {
  id: string
  kind: RequestKind
  student: { id: string; name: string; email: string }
  requestedAt: string
  expiresAt: string
  book?: { id: string; title: string; author: string; availableCopies: number; totalCopies: number }
  room?: { resourceId: string; name: string; location: string | null; startTime: string; endTime: string }
}

export interface PendingRequests {
  requests: PendingRequest[]
  counts: { all: number; borrow: number; room: number }
}

export function fetchPendingRequests(): Promise<PendingRequests> {
  return apiRequest<PendingRequests>('/admin/requests')
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
