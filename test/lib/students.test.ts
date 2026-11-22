import { describe, expect, it } from 'vitest'
import { ApiError, writeToken } from '@/lib/api'
import {
  adjustReliability, fetchStudent, reliabilityChart, ringDash, studentHref, studentSection, tierTagClass, type AdminStudent,
} from '@/lib/students'
import { json, mockFetch } from '../helpers'

const STUDENT: AdminStudent = {
  id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu', roll: '1024160143', score: 68, tier: 'Building back up',
  history: [], loans: [], bookings: [], fines: [],
}

describe('student API', () => {
  it('fetches a student with GET and the token', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/students/s1': () => json(200, STUDENT) })
    await expect(fetchStudent('s1')).resolves.toEqual(STUDENT)
    expect(fetch.mock.calls[0][1]!.method).toBe('GET')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
  })

  it('encodes the id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/students/a%2Fb': () => json(200, STUDENT) })
    await fetchStudent('a/b')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/students\/a%2Fb$/)
  })

  it('passes a 404 through as an ApiError the page can tell apart', async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/students/nope': () => json(404, { error: 'Student not found' }) })
    const error = await fetchStudent('nope').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(404)
    expect((error as ApiError).message).toBe('Student not found')
  })

  it('adjusts with POST, the delta as a number and the trimmed reason, and answers the updated student', async () => {
    writeToken('t')
    const updated = { ...STUDENT, score: 71 }
    const fetch = mockFetch({ 'POST /admin/students/s1/reliability': () => json(200, updated) })
    await expect(adjustReliability('s1', 3, '  Helped at the desk ')).resolves.toEqual(updated)
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(fetch.mock.calls[0][1]!.body).toBe('{"delta":3,"reason":"Helped at the desk"}')
  })

  it('sends a negative delta as a negative number and encodes the id', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/students/a%2Fb/reliability': () => json(200, STUDENT) })
    await adjustReliability('a/b', -7, 'Misused a room')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/students\/a%2Fb\/reliability$/)
    expect(fetch.mock.calls[0][1]!.body).toBe('{"delta":-7,"reason":"Misused a room"}')
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/students/s1/reliability': () => json(409, { error: 'The score is already at 100.' }) })
    const error = await adjustReliability('s1', 5, 'Good work').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).message).toBe('The score is already at 100.')
  })
})

describe('studentHref', () => {
  it('links to the student with the section it was opened from', () => {
    expect(studentHref('s1', 'fines')).toBe('/students/s1?from=fines')
    expect(studentHref('s1', 'bookings')).toBe('/students/s1?from=bookings')
    expect(studentHref('s1', 'requests')).toBe('/students/s1?from=requests')
    expect(studentHref('s1', 'catalogue')).toBe('/students/s1?from=catalogue')
  })

  it('encodes the id', () => {
    expect(studentHref('a/b c', 'fines')).toBe('/students/a%2Fb%20c?from=fines')
  })
})

describe('studentSection', () => {
  it('names the sidebar section for each place a student is opened from', () => {
    expect(studentSection('bookings')).toEqual({ label: 'Bookings', href: '/bookings' })
    expect(studentSection('fines')).toEqual({ label: 'Fines', href: '/fines' })
    expect(studentSection('requests')).toEqual({ label: 'Requests', href: '/requests' })
    expect(studentSection('catalogue')).toEqual({ label: 'Catalogue', href: '/catalogue' })
  })

  it('falls back to the Dashboard for a missing or unknown value, including names every object has', () => {
    const dashboard = { label: 'Dashboard', href: '/dashboard' }
    for (const from of [null, undefined, '', 'nowhere', 'Fines', 'constructor', 'toString', '__proto__']) {
      expect(studentSection(from)).toEqual(dashboard)
    }
  })
})

describe('tierTagClass', () => {
  it('uses accent-2 for Good standing and accent for every other tier', () => {
    expect(tierTagClass('Good standing')).toBe('tag-accent-2')
    for (const tier of ['Building back up', 'Needs improvement', 'At risk', 'Something newer']) {
      expect(tierTagClass(tier)).toBe('tag-accent')
    }
  })
})

describe('ringDash', () => {
  const circumference = 2 * Math.PI * 52

  it('fills the score as a share of the ring, as the canvas does', () => {
    expect(ringDash(68)).toBe(`${0.68 * circumference} ${circumference}`)
    expect(ringDash(0)).toBe(`0 ${circumference}`)
    expect(ringDash(100)).toBe(`${circumference} ${circumference}`)
  })

  it('keeps an out-of-range score on the ring', () => {
    expect(ringDash(130)).toBe(ringDash(100))
    expect(ringDash(-4)).toBe(ringDash(0))
  })
})

describe('reliabilityChart', () => {
  it('draws the history oldest to newest although it arrives newest first', () => {
    // Newest first: 80, 50, 20. The line starts at the oldest (20) and ends at the newest (80).
    const { dots, points } = reliabilityChart([{ score: 80 }, { score: 50 }, { score: 20 }])
    expect(dots).toHaveLength(3)
    expect(dots.map((d) => d.x)).toEqual([6, 140, 274]) // pad 6, width 280: evenly spread
    // y = 50 - score% * 44 (height 56, pad 6): 20 -> 41.2, 50 -> 28, 80 -> 14.8
    expect(dots.map((d) => d.y)).toEqual([41, 28, 15])
    expect(points).toBe('6,41 140,28 274,15')
  })

  it('centres a single entry', () => {
    const { dots, points } = reliabilityChart([{ score: 100 }])
    expect(dots).toEqual([{ x: 140, y: 6 }])
    expect(points).toBe('140,6')
  })

  it('draws nothing for no history', () => {
    expect(reliabilityChart([])).toEqual({ points: '', dots: [] })
  })

  it('does not reorder the caller\'s array', () => {
    const history = [{ score: 80 }, { score: 20 }]
    reliabilityChart(history)
    expect(history.map((h) => h.score)).toEqual([80, 20])
  })

  it('keeps an out-of-range score inside the chart', () => {
    const { dots } = reliabilityChart([{ score: 140 }, { score: -10 }])
    expect(dots.map((d) => d.y)).toEqual([50, 6])
  })
})
