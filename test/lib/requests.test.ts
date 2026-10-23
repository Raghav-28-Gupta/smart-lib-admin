import { describe, expect, it } from 'vitest'
import { writeToken } from '@/lib/api'
import { approveRequest, declineRequest, fetchPendingRequests } from '@/lib/requests'
import { json, mockFetch } from '../helpers'

const NONE = { requests: [], counts: { all: 0, borrow: 0, room: 0 } }

describe('request API', () => {
  it('fetches the pending requests with the token', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/requests': () => json(200, NONE) })
    await expect(fetchPendingRequests()).resolves.toEqual(NONE)
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
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
