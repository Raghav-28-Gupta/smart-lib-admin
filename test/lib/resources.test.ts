import { describe, expect, it } from 'vitest'
import { writeToken } from '@/lib/api'
import {
  bringResourceOnline,
  createResource,
  fetchResources,
  takeResourceOffline,
  updateResource,
  type AdminResource,
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
      createResource({ type: 'room', name: '  Group Room 201 ', location: ' 2nd Floor, East Wing  ', capacity: 6 }),
    ).resolves.toEqual(ROOM)
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toEqual({
      type: 'room',
      name: 'Group Room 201',
      location: '2nd Floor, East Wing',
      capacity: 6,
    })
  })

  it('edits with PATCH and sends only the name, location and capacity', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'PATCH /admin/resources/r2': () => json(200, { ...ROOM, capacity: 8 }) })
    // A caller that passes a type along (it is locked after creation) must not send it.
    const input = { type: 'seat', name: ' Group Room 201 ', location: '2nd Floor', capacity: 8 }
    await expect(updateResource('r2', input)).resolves.toMatchObject({ capacity: 8 })
    expect(fetch.mock.calls[0][1]!.method).toBe('PATCH')
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toEqual({
      name: 'Group Room 201',
      location: '2nd Floor',
      capacity: 8,
    })
  })

  it('encodes the id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'PATCH /admin/resources/a%2Fb': () => json(200, ROOM) })
    await updateResource('a/b', { name: 'x', location: 'y', capacity: 1 })
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/resources\/a%2Fb$/)
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
