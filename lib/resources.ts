import { apiRequest } from './api'

export type ResourceType = 'seat' | 'room'

// GET /admin/resources (backend: src/services/adminResourceService.ts).
export interface AdminResource {
  id: string
  type: ResourceType
  name: string
  location: string | null
  capacity: number
  status: 'available' | 'offline'
  /** The note given when the resource was taken offline; null when there was none. */
  statusNote: string | null
  /** Holding bookings that have not ended yet: the ones that stay if the resource goes offline. */
  upcomingBookings: number
}

/** In name order. With a type the server returns only that type. */
export function fetchResources(type?: ResourceType): Promise<AdminResource[]> {
  return apiRequest<AdminResource[]>(`/admin/resources${type ? `?type=${type}` : ''}`)
}

export function createResource(input: {
  type: ResourceType
  name: string
  location: string
  capacity: number
}): Promise<AdminResource> {
  return apiRequest<AdminResource>('/admin/resources', {
    method: 'POST',
    body: { type: input.type, name: input.name.trim(), location: input.location.trim(), capacity: input.capacity },
  })
}

/** The type is locked after creation, so it is never sent, whatever the caller passes. */
export function updateResource(
  id: string,
  input: { name: string; location: string; capacity: number },
): Promise<AdminResource> {
  return apiRequest<AdminResource>(`/admin/resources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { name: input.name.trim(), location: input.location.trim(), capacity: input.capacity },
  })
}

/** The note is optional: blank sends none. */
export function takeResourceOffline(id: string, note: string): Promise<AdminResource> {
  const trimmed = note.trim()
  return apiRequest<AdminResource>(`/admin/resources/${encodeURIComponent(id)}/offline`, {
    method: 'POST',
    body: trimmed ? { note: trimmed } : {},
  })
}

export function bringResourceOnline(id: string): Promise<AdminResource> {
  return apiRequest<AdminResource>(`/admin/resources/${encodeURIComponent(id)}/online`, { method: 'POST' })
}
