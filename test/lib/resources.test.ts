import { describe, expect, it } from 'vitest'
import { writeToken } from '@/lib/api'
import {
  bringResourceOnline,
  createResource,
  fetchResources,
  fetchSeatZones,
  saveZoneFrontLabel,
  takeResourceOffline,
  updateResource,
  type AdminResource,
  type SeatZone,
} from '@/lib/resources'
import { json, mockFetch } from '../helpers'

const ROOM: AdminResource = {
  id: 'r2',
  type: 'room',
  name: 'Group Room 201',
  location: '2nd Floor, East Wing',
  capacity: 6,
  status: 'available',
  statusNote: null,
  upcomingBookings: 3,
  row: null,
  column: null,
}

describe('resource API', () => {
  it('fetches every resource with the token', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/resources': () => json(200, [ROOM]) })
    await expect(fetchResources()).resolves.toEqual([ROOM])
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/resources$/)
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
  })

  it('can ask the server for one type', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/resources': () => json(200, [ROOM]) })
    await fetchResources('room')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/resources\?type=room$/)
  })

  it('creates a resource with trimmed text', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/resources': () => json(201, ROOM) })
    await expect(
      createResource({ type: 'room', name: '  Group Room 201 ', location: ' 2nd Floor, East Wing  ', capacity: 6, row: null, column: null }),
    ).resolves.toEqual(ROOM)
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toEqual({
      type: 'room',
      name: 'Group Room 201',
      location: '2nd Floor, East Wing',
      capacity: 6,
      row: null,
      column: null,
    })
  })

  it('edits with PATCH and sends only the name, location, capacity, row and column', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'PATCH /admin/resources/r2': () => json(200, { ...ROOM, capacity: 8 }) })
    // A caller that passes a type along (it is locked after creation) must not send it.
    const input = { type: 'seat', name: ' Group Room 201 ', location: '2nd Floor', capacity: 8, row: null, column: null }
    await expect(updateResource('r2', input)).resolves.toMatchObject({ capacity: 8 })
    expect(fetch.mock.calls[0][1]!.method).toBe('PATCH')
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toEqual({
      name: 'Group Room 201',
      location: '2nd Floor',
      capacity: 8,
      row: null,
      column: null,
    })
  })

  it('encodes the id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'PATCH /admin/resources/a%2Fb': () => json(200, ROOM) })
    await updateResource('a/b', { name: 'x', location: 'y', capacity: 1, row: null, column: null })
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/resources\/a%2Fb$/)
  })

  it('createResource and updateResource send row and column, null when empty', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'POST /admin/resources': () => json(201, ROOM),
      'PATCH /admin/resources/r1': () => json(200, ROOM),
    })
    await createResource({ type: 'seat', name: 'Desk 5', location: 'Reading Room A', capacity: 1, row: 2, column: 5 })
    await createResource({ type: 'seat', name: 'Desk 6', location: 'Reading Room A', capacity: 1, row: null, column: null })
    await updateResource('r1', { name: 'Desk 5', location: 'Reading Room A', capacity: 1, row: 3, column: 4 })
    await updateResource('r1', { name: 'Desk 5', location: 'Reading Room A', capacity: 1, row: null, column: null })
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init!.body)))
    expect(bodies[0]).toMatchObject({ type: 'seat', row: 2, column: 5 })
    expect(bodies[1]).toMatchObject({ type: 'seat', row: null, column: null })
    expect(bodies[2]).toEqual({ name: 'Desk 5', location: 'Reading Room A', capacity: 1, row: 3, column: 4 })
    // null is sent, not left out: it is what clears a stored position.
    expect(bodies[3]).toEqual({ name: 'Desk 5', location: 'Reading Room A', capacity: 1, row: null, column: null })
  })

  it('fetchSeatZones gets /admin/zones', async () => {
    writeToken('t')
    const zones: SeatZone[] = [{ name: 'Reading Room A', frontLabel: 'Windows', seats: 48, placed: 46 }]
    const fetch = mockFetch({ 'GET /admin/zones': () => json(200, zones) })
    await expect(fetchSeatZones()).resolves.toEqual(zones)
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/zones$/)
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
  })

  it('saveZoneFrontLabel PUTs the trimmed label to the URL-encoded zone', async () => {
    writeToken('t')
    const zone: SeatZone = { name: 'Floor 2 / East', frontLabel: 'Windows', seats: 10, placed: 8 }
    const fetch = mockFetch({ 'PUT /admin/zones/Floor%202%20%2F%20East': () => json(200, zone) })
    await expect(saveZoneFrontLabel('Floor 2 / East', '  Windows ')).resolves.toEqual(zone)
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/zones\/Floor%202%20%2F%20East$/)
    expect(fetch.mock.calls[0][1]!.method).toBe('PUT')
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toEqual({ frontLabel: 'Windows' })
  })

  it('takes a resource offline with a trimmed note, and with none when it is blank', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/resources/r2/offline': () => json(200, { ...ROOM, status: 'offline' }) })
    await takeResourceOffline('r2', '  Projector bulb replacement ')
    await takeResourceOffline('r2', '   ')
    expect(fetch.mock.calls[0][1]!.body).toBe('{"note":"Projector bulb replacement"}')
    expect(fetch.mock.calls[1][1]!.body).toBe('{}')
  })

  it('brings a resource back online with no body', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/resources/r2/online': () => json(200, ROOM) })
    await bringResourceOnline('r2')
    expect(fetch.mock.calls[0][1]!.body).toBeUndefined()
  })

  it("passes on the server's refusal", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/resources/r2/offline': () => json(409, { error: 'This resource is already offline.' }) })
    await expect(takeResourceOffline('r2', '')).rejects.toMatchObject({
      status: 409,
      message: 'This resource is already offline.',
    })
  })
})
