import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, endSession, NETWORK_MESSAGE, readToken, SESSION_ENDED_EVENT, writeToken } from '@/lib/api'
import { json, mockFetch } from '../helpers'

function listenForSessionEnd() {
  const reasons: string[] = []
  const listener = (e: Event) => reasons.push((e as CustomEvent<string>).detail)
  window.addEventListener(SESSION_ENDED_EVENT, listener)
  return { reasons, stop: () => window.removeEventListener(SESSION_ENDED_EVENT, listener) }
}

describe('apiRequest', () => {
  it('sends the stored token with a timeout and returns the JSON body', async () => {
    writeToken('t1')
    const fetch = mockFetch({ 'GET /admin/metrics/overdue': () => json(200, { count: 1, countYesterday: 0 }) })
    await expect(apiRequest('/admin/metrics/overdue')).resolves.toEqual({ count: 1, countYesterday: 0 })
    const init = fetch.mock.calls[0][1]!
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t1')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends no token when auth is false, and posts JSON', async () => {
    writeToken('t1')
    const fetch = mockFetch({ 'POST /auth/login': () => json(200, { ok: true }) })
    await apiRequest('/auth/login', { method: 'POST', body: { email: 'a@b.c' }, auth: false })
    const init = fetch.mock.calls[0][1]!
    expect(new Headers(init.headers).get('Authorization')).toBeNull()
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(init.body).toBe('{"email":"a@b.c"}')
  })

  it("turns an error body into an ApiError carrying the server's message", async () => {
    mockFetch({ 'POST /auth/login': () => json(401, { error: "That email and password don't match our records." }) })
    await expect(apiRequest('/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      status: 401,
      message: "That email and password don't match our records.",
    })
  })

  it('reports an unreachable server with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ status: 0, message: NETWORK_MESSAGE })
  })

  it('ends the session on a 401 when a token was sent', async () => {
    writeToken('stale')
    const ended = listenForSessionEnd()
    mockFetch({ 'GET /admin/metrics/demand': () => json(401, { error: 'Invalid or expired token' }) })
    await expect(apiRequest('/admin/metrics/demand')).rejects.toBeInstanceOf(ApiError)
    expect(readToken()).toBeNull()
    expect(ended.reasons).toEqual(['expired'])
    ended.stop()
  })

  it('ends the session on a 403 from an account that is no longer an admin', async () => {
    writeToken('demoted')
    const ended = listenForSessionEnd()
    mockFetch({ 'GET /admin/metrics/demand': () => json(403, { error: 'Admin access required' }) })
    await expect(apiRequest('/admin/metrics/demand')).rejects.toMatchObject({ status: 403 })
    expect(readToken()).toBeNull()
    expect(ended.reasons).toEqual(['not-admin'])
    ended.stop()
  })

  it('leaves the session alone when a login is refused', async () => {
    const ended = listenForSessionEnd()
    mockFetch({ 'POST /auth/login': () => json(401, { error: 'no' }) })
    await expect(apiRequest('/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toBeInstanceOf(ApiError)
    expect(ended.reasons).toEqual([])
    ended.stop()
  })

  it('endSession clears the token and says why the session ended', () => {
    writeToken('t')
    const ended = listenForSessionEnd()
    endSession('not-admin')
    expect(readToken()).toBeNull()
    expect(ended.reasons).toEqual(['not-admin'])
    ended.stop()
  })
})
