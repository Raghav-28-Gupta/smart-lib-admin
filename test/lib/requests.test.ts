import { describe, expect, it } from 'vitest'
import { writeToken } from '@/lib/api'
import { approveRequest, declineRequest, fetchPendingRequests, type PendingRequests } from '@/lib/requests'
import { json, mockFetch } from '../helpers'

const NONE = { requests: [], counts: { all: 0, borrow: 0, room: 0 } }

describe('request API', () => {
  it('fetches the pending requests with the token', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/requests': () => json(200, NONE) })
    await expect(fetchPendingRequests()).resolves.toEqual(NONE)
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
  })

  it('sends no order for the suggested order (the server default) and order=request for plain request time', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/requests': () => json(200, NONE) })
    await fetchPendingRequests()
    await fetchPendingRequests('suggested')
    await fetchPendingRequests('request')
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).search)).toEqual(['', '', '?order=request'])
  })

  it("hands a room request's priority through, and a room that was never scored has none", async () => {
    writeToken('t')
    const room = { resourceId: 'r1', name: 'Group Room 201', location: null, startTime: '2026-10-22T08:30:00.000Z', endTime: '2026-10-22T09:30:00.000Z' }
    const student = { id: 'u2', name: 'Rohan Verma', email: 'rohan.verma@thapar.edu' }
    const body: PendingRequests = {
      requests: [
        { id: 'bk-1', kind: 'room', student, requestedAt: '2026-10-22T08:00:00.000Z', expiresAt: '2026-10-22T08:45:00.000Z', room: { ...room, priority: { suggestedDelayMinutes: 18, riskPercent: 42 } } },
        { id: 'bk-2', kind: 'room', student, requestedAt: '2026-10-22T08:01:00.000Z', expiresAt: '2026-10-22T08:46:00.000Z', room: { ...room, priority: { suggestedDelayMinutes: 7, riskPercent: null } } },
        { id: 'bk-3', kind: 'room', student, requestedAt: '2026-10-22T08:02:00.000Z', expiresAt: '2026-10-22T08:47:00.000Z', room },
      ],
      counts: { all: 3, borrow: 0, room: 3 },
    }
    mockFetch({ 'GET /admin/requests': () => json(200, body) })
    const got = await fetchPendingRequests()
    expect(got.requests[0].room?.priority).toEqual({ suggestedDelayMinutes: 18, riskPercent: 42 })
    expect(got.requests[1].room?.priority).toEqual({ suggestedDelayMinutes: 7, riskPercent: null })
    expect(got.requests[2].room).not.toHaveProperty('priority')
  })

  it('approves by kind and id, with no body', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'POST /admin/requests/borrow/br-1/approve': () => json(200, { id: 'br-1', kind: 'borrow', status: 'approved' }),
    })
    await approveRequest({ kind: 'borrow', id: 'br-1' })
    expect(fetch.mock.calls[0][1]!.body).toBeUndefined()
  })

  it('sends a trimmed reason, and none when it is blank', async () => {
    writeToken('t')
    const fetch = mockFetch({
      'POST /admin/requests/room/bk-1/decline': () => json(200, { id: 'bk-1', kind: 'room', status: 'declined' }),
    })
    await declineRequest({ kind: 'room', id: 'bk-1' }, '  Reserved for an event  ')
    await declineRequest({ kind: 'room', id: 'bk-1' }, '   ')
    expect(fetch.mock.calls[0][1]!.body).toBe('{"reason":"Reserved for an event"}')
    expect(fetch.mock.calls[1][1]!.body).toBe('{}')
  })

  it("passes on the server's refusal", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/requests/borrow/br-1/approve': () => json(409, { error: 'Already approved by Librarian One.' }) })
    await expect(approveRequest({ kind: 'borrow', id: 'br-1' })).rejects.toMatchObject({
      status: 409,
      message: 'Already approved by Librarian One.',
    })
  })
})
