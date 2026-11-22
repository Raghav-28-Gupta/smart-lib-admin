import { describe, expect, it } from 'vitest'
import { ApiError, writeToken } from '@/lib/api'
import {
  escalateLoan, fetchAttention, noticeLine, overdueDetail, overdueSummary, remindLoan, waitingText,
  type AttentionQueue, type LastNotice, type OverdueDetails,
} from '@/lib/attention'
import { json, mockFetch } from '../helpers'

// Every time is derived from now, an hour past the whole day, so a slow test never tips into the next day.
const NOW = Date.now()
const daysAgoIso = (days: number) => new Date(NOW - days * 86_400_000 - 3_600_000).toISOString()

const QUEUE: AttentionQueue = {
  items: [
    {
      id: 'loan-1', kind: 'overdue', student: { id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu' }, waitingSince: daysAgoIso(3),
      overdue: { loanId: 'loan-1', title: 'Clean Code', dueAt: daysAgoIso(3), daysOverdue: 3, amount: 30, lastNotice: null, escalated: false },
    },
  ],
  counts: { all: 1, overdue: 1, fine_dispute: 0, report: 0 },
  emailEnabled: true,
}

describe('fetchAttention', () => {
  it('fetches the whole queue with GET and the token', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'GET /admin/attention': () => json(200, QUEUE) })
    await expect(fetchAttention()).resolves.toEqual(QUEUE)
    expect(fetch.mock.calls[0][1]!.method).toBe('GET')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    // The chips filter on the client, so no `kind` is asked for.
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/attention$/)
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'GET /admin/attention': () => json(500, { error: 'Boom' }) })
    const error = await fetchAttention().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(500)
  })
})

describe('waitingText', () => {
  it('counts whole days since the item started waiting', () => {
    expect(waitingText(daysAgoIso(3), NOW)).toBe('waiting 3 days')
    expect(waitingText(daysAgoIso(1), NOW)).toBe('waiting 1 day')
  })

  it('says "waiting today" under a day', () => {
    expect(waitingText(new Date(NOW - 5 * 3_600_000).toISOString(), NOW)).toBe('waiting today')
  })
})

describe('noticeLine', () => {
  const notice = (kind: LastNotice['kind'], emailStatus: LastNotice['emailStatus'], days: number): LastNotice => ({ kind, at: daysAgoIso(days), emailStatus })

  it('says nothing when there is no notice', () => {
    expect(noticeLine(null, NOW)).toBe('')
  })

  it('reads "Reminded 2 days ago · emailed" for a reminder that was emailed', () => {
    expect(noticeLine(notice('reminder', 'sent', 2), NOW)).toBe('Reminded 2 days ago · emailed')
  })

  it('reads "not emailed" when the email failed or was skipped', () => {
    expect(noticeLine(notice('reminder', 'failed', 2), NOW)).toBe('Reminded 2 days ago · not emailed')
    expect(noticeLine(notice('reminder', 'skipped', 2), NOW)).toBe('Reminded 2 days ago · not emailed')
  })

  it('reads "Escalated 1 day ago" for an escalation, emailed or not', () => {
    expect(noticeLine(notice('escalation', 'sent', 1), NOW)).toBe('Escalated 1 day ago · emailed')
    expect(noticeLine(notice('escalation', 'skipped', 1), NOW)).toBe('Escalated 1 day ago · not emailed')
  })

  it('says "today" for a notice sent in the last day', () => {
    expect(noticeLine({ kind: 'reminder', at: new Date(NOW - 3_600_000).toISOString(), emailStatus: 'sent' }, NOW)).toBe('Reminded today · emailed')
  })

  it('says "just now" for a notice sent under a minute ago, also when this clock runs slightly behind the server', () => {
    const at = (offsetMs: number): LastNotice => ({ kind: 'reminder', at: new Date(NOW - offsetMs).toISOString(), emailStatus: 'sent' })
    expect(noticeLine(at(0), NOW)).toBe('Reminded just now · emailed')
    expect(noticeLine(at(59_000), NOW)).toBe('Reminded just now · emailed')
    expect(noticeLine(at(-2_000), NOW)).toBe('Reminded just now · emailed')
    expect(noticeLine(at(60_000), NOW)).toBe('Reminded today · emailed')
    expect(noticeLine({ ...at(5_000), kind: 'escalation', emailStatus: 'failed' }, NOW)).toBe('Escalated just now · not emailed')
  })
})

describe('remindLoan and escalateLoan', () => {
  it('remindLoan POSTs to the loan\'s remind route with the token and no body', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/loans/loan-1/remind': () => json(200, QUEUE.items[0]) })
    await expect(remindLoan('loan-1')).resolves.toEqual(QUEUE.items[0])
    const init = fetch.mock.calls[0][1]!
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t')
  })

  it('escalateLoan sends the trimmed note, and {} when the note is blank', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/loans/loan-1/escalate': () => json(200, QUEUE.items[0]) })
    await escalateLoan('loan-1', '  Bring it back Friday \n')
    await escalateLoan('loan-1', '')
    await escalateLoan('loan-1', '  \n ')
    expect(fetch.mock.calls.map(([, init]) => init!.body)).toEqual(['{"note":"Bring it back Friday"}', '{}', '{}'])
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Content-Type')).toBe('application/json')
  })

  it('escapes the loan id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/loans/a%2Fb/remind': () => json(200, {}) })
    await remindLoan('a/b')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/loans\/a%2Fb\/remind$/)
  })

  it("passes the server's 409 message through", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/loans/loan-1/remind': () => json(409, { error: 'A reminder was sent 3 hours ago.' }) })
    const error = await remindLoan('loan-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).message).toBe('A reminder was sent 3 hours ago.')
  })
})

describe('overdue card text', () => {
  const overdue = (over: Partial<OverdueDetails> = {}): OverdueDetails => ({
    loanId: 'loan-1', title: 'Clean Code', dueAt: daysAgoIso(3), daysOverdue: 3, amount: 30, lastNotice: null, escalated: false, ...over,
  })

  it('summarises as "<title> — <n> days overdue"', () => {
    expect(overdueSummary(overdue())).toBe('Clean Code — 3 days overdue')
    expect(overdueSummary(overdue({ daysOverdue: 1 }))).toBe('Clean Code — 1 day overdue')
  })

  it('details the amount so far, then the last notice line', () => {
    const withNotice = overdue({ lastNotice: { kind: 'reminder', at: daysAgoIso(2), emailStatus: 'sent' } })
    expect(overdueDetail(withNotice, NOW)).toBe('₹30 so far. Reminded 2 days ago · emailed')
  })

  it('details the newest notice, whichever kind, also for a loan escalated earlier', () => {
    const remindedAfter = overdue({ escalated: true, lastNotice: { kind: 'reminder', at: daysAgoIso(1), emailStatus: 'sent' } })
    expect(overdueDetail(remindedAfter, NOW)).toBe('₹30 so far. Reminded 1 day ago · emailed')
  })

  it('details only the amount when nothing was sent yet', () => {
    expect(overdueDetail(overdue({ amount: 180 }), NOW)).toBe('₹180 so far.')
  })
})
