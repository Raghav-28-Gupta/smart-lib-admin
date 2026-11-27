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
  /** The seat's place on the seat map (1 to 50); null for a seat that is not on the map and for every room. */
  row: number | null
  column: number | null
}

/** In name order. With a type the server returns only that type. */
export function fetchResources(type?: ResourceType): Promise<AdminResource[]> {
  return apiRequest<AdminResource[]>(`/admin/resources${type ? `?type=${type}` : ''}`)
}

/** `row` and `column` are always sent: both numbers, or both null (null clears a stored position). */
export function createResource(input: {
  type: ResourceType
  name: string
  location: string
  capacity: number
  row: number | null
  column: number | null
}): Promise<AdminResource> {
  return apiRequest<AdminResource>('/admin/resources', {
    method: 'POST',
    body: {
      type: input.type,
      name: input.name.trim(),
      location: input.location.trim(),
      capacity: input.capacity,
      row: input.row,
      column: input.column,
    },
  })
}

/**
 * The type is locked after creation, so it is never sent, whatever the caller passes. `row` and `column` are
 * always sent, as for `createResource`: the server keeps a stored value for an omitted one, so null is how a
 * position is cleared.
 */
export function updateResource(
  id: string,
  input: { name: string; location: string; capacity: number; row: number | null; column: number | null },
): Promise<AdminResource> {
  return apiRequest<AdminResource>(`/admin/resources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      name: input.name.trim(),
      location: input.location.trim(),
      capacity: input.capacity,
      row: input.row,
      column: input.column,
    },
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

// GET /admin/zones (backend: src/services/seatZoneService.ts): one per distinct non-blank seat location,
// exact and case-sensitive ("Reading room A" is a different zone from "Reading Room A"), in name order.
export interface SeatZone {
  name: string
  /** What the student app's seat map prints at the top of the zone ("Windows"); null when none is set. */
  frontLabel: string | null
  /** Seats in the zone, offline ones included. */
  seats: number
  /** Of those, the seats with a row and column. */
  placed: number
}

export function fetchSeatZones(): Promise<SeatZone[]> {
  return apiRequest<SeatZone[]>('/admin/zones')
}

/** The label is trimmed here; the server stores a blank one as none. The zone name is a path segment, so it is encoded. */
export function saveZoneFrontLabel(name: string, frontLabel: string): Promise<SeatZone> {
  return apiRequest<SeatZone>(`/admin/zones/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: { frontLabel: frontLabel.trim() },
  })
}
