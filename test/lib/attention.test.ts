import { describe, expect, it } from 'vitest'
import { ApiError, writeToken } from '@/lib/api'
import {
  ATTENTION_KINDS, confirmReport, disputeSummary, dismissReport, escalateLoan, fetchAttention, fineFromDispute, noShowBookingLine,
  noShowSummary, noticeLine, overdueDetail, overdueSummary, overturnNoShowDispute, remindLoan, reportCategoryLabel, reportSummary,
  upholdDispute, upholdNoShowDispute, waitingText,
  type AttentionQueue, type DisputeDetails, type FineDisputeItem, type LastNotice, type NoShowDetails, type OverdueDetails,
  type ReportDetails,
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
  counts: { all: 1, overdue: 1, fine_dispute: 0, report: 0, no_show_dispute: 0 },
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

describe('upholdDispute', () => {
  it("POSTs to the dispute's uphold route with the token, the note trimmed, and {} when it is blank", async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/disputes/d-1/uphold': () => json(200, { id: 'd-1' }) })
    await expect(upholdDispute('d-1', '  The receipt is for another book \n')).resolves.toEqual({ id: 'd-1' })
    await upholdDispute('d-1', '')
    await upholdDispute('d-1', '  \n ')
    expect(fetch.mock.calls.map(([, init]) => init!.body)).toEqual(['{"note":"The receipt is for another book"}', '{}', '{}'])
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Content-Type')).toBe('application/json')
  })

  it('escapes the dispute id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/disputes/a%2Fb/uphold': () => json(200, {}) })
    await upholdDispute('a/b', '')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/disputes\/a%2Fb\/uphold$/)
  })

  it("passes the server's refusals through", async () => {
    writeToken('t')
    mockFetch({
      'POST /admin/disputes/d-1/uphold': () => json(409, { error: 'This dispute was already resolved.' }),
      'POST /admin/disputes/d-2/uphold': () => json(404, { error: 'Dispute not found' }),
    })
    const resolved = await upholdDispute('d-1', '').catch((e: unknown) => e)
    expect(resolved).toBeInstanceOf(ApiError)
    expect([(resolved as ApiError).status, (resolved as ApiError).message]).toEqual([409, 'This dispute was already resolved.'])
    const missing = await upholdDispute('d-2', '').catch((e: unknown) => e)
    expect([(missing as ApiError).status, (missing as ApiError).message]).toEqual([404, 'Dispute not found'])
  })
})

describe('fine dispute card text and fineFromDispute', () => {
  const details = (over: Partial<DisputeDetails['fine']> = {}): DisputeDetails => ({
    disputeId: 'd-1',
    studentReason: 'I returned it on Monday.',
    fine: { id: 'f-1', item: 'Clean Code', reason: 'overdue', amount: 150, originalAmount: 150, status: 'outstanding', ...over },
  })
  const item = (over: Partial<DisputeDetails['fine']> = {}): FineDisputeItem => ({
    id: 'item-1', kind: 'fine_dispute', student: { id: 's2', name: 'Rohan Verma', email: 'rohan@example.edu' }, waitingSince: daysAgoIso(2),
    dispute: details(over),
  })

  it('summarises as "Disputes ₹<amount> <reason> fine on <item>", naming each reason as the Fines table does', () => {
    expect(disputeSummary(details())).toBe('Disputes ₹150 Overdue fine on Clean Code')
    expect(disputeSummary(details({ reason: 'no_show', amount: 40, item: 'Group Room 201' }))).toBe('Disputes ₹40 No-show fine on Group Room 201')
    expect(disputeSummary(details({ reason: 'lost', amount: 250, item: 'Sapiens' }))).toBe('Disputes ₹250 Lost book fine on Sapiens')
  })

  it('shows a reason this console does not know as it came, not as undefined', () => {
    expect(disputeSummary(details({ reason: 'damaged' as 'lost' }))).toBe('Disputes ₹150 damaged fine on Clean Code')
  })

  it('builds the fine the adjust dialog needs, carrying the dispute the librarian is looking at', () => {
    const disputed = item({ amount: 100, originalAmount: 150, status: 'adjusted' })
    expect(fineFromDispute(disputed)).toEqual({
      id: 'f-1', kind: 'fine', student: disputed.student, reason: 'overdue', item: 'Clean Code',
      amount: 100, originalAmount: 150, status: 'adjusted',
      // Not read by the adjust dialog: obvious stand-ins.
      date: disputed.waitingSince, note: null, recordedBy: null,
      canSettle: true,
      dispute: { id: 'd-1', reason: 'I returned it on Monday.', createdAt: disputed.waitingSince },
    })
  })
})

describe('confirmReport', () => {
  it("POSTs to the report's confirm route with the token, the outcome, and the note trimmed", async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/reports/r-1/confirm': () => json(200, { id: 'r-1' }) })
    await expect(confirmReport('r-1', { outcome: 'maintenance', note: '  Cover torn off \n' })).resolves.toEqual({ id: 'r-1' })
    await confirmReport('r-1', { outcome: 'lost', note: 'Not on the shelf' })
    expect(fetch.mock.calls.map(([, init]) => init!.body)).toEqual([
      '{"outcome":"maintenance","note":"Cover torn off"}',
      '{"outcome":"lost","note":"Not on the shelf"}',
    ])
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Content-Type')).toBe('application/json')
  })

  it('leaves the note out when it is blank, and the outcome out when there is none (a resource report)', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/reports/r-1/confirm': () => json(200, { id: 'r-1' }) })
    await confirmReport('r-1', { outcome: 'maintenance', note: '' })
    await confirmReport('r-1', { outcome: 'maintenance', note: '  \n ' })
    await confirmReport('r-1', { outcome: 'lost' })
    await confirmReport('r-1', { note: ' The projector shows no picture. ' })
    await confirmReport('r-1', {})
    expect(fetch.mock.calls.map(([, init]) => init!.body)).toEqual([
      '{"outcome":"maintenance"}',
      '{"outcome":"maintenance"}',
      '{"outcome":"lost"}',
      '{"note":"The projector shows no picture."}',
      '{}',
    ])
  })

  it('escapes the report id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/reports/a%2Fb/confirm': () => json(200, {}) })
    await confirmReport('a/b', {})
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/reports\/a%2Fb\/confirm$/)
  })

  it("passes the server's refusals through", async () => {
    writeToken('t')
    mockFetch({
      'POST /admin/reports/r-1/confirm': () => json(409, { error: 'This copy is now on loan.' }),
      'POST /admin/reports/r-2/confirm': () => json(409, { error: 'This report was already resolved.' }),
    })
    const onLoan = await confirmReport('r-1', { outcome: 'maintenance' }).catch((e: unknown) => e)
    expect(onLoan).toBeInstanceOf(ApiError)
    expect([(onLoan as ApiError).status, (onLoan as ApiError).message]).toEqual([409, 'This copy is now on loan.'])
    const resolved = await confirmReport('r-2', {}).catch((e: unknown) => e)
    expect([(resolved as ApiError).status, (resolved as ApiError).message]).toEqual([409, 'This report was already resolved.'])
  })
})

describe('dismissReport', () => {
  it("POSTs to the report's dismiss route with the token, the note trimmed, and {} when it is blank", async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/reports/r-1/dismiss': () => json(200, { id: 'r-1' }) })
    await expect(dismissReport('r-1', '  The cover was already like that \n')).resolves.toEqual({ id: 'r-1' })
    await dismissReport('r-1', '')
    await dismissReport('r-1', '  \n ')
    expect(fetch.mock.calls.map(([, init]) => init!.body)).toEqual(['{"note":"The cover was already like that"}', '{}', '{}'])
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Content-Type')).toBe('application/json')
  })

  it('escapes the report id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/reports/a%2Fb/dismiss': () => json(200, {}) })
    await dismissReport('a/b', '')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/reports\/a%2Fb\/dismiss$/)
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/reports/r-1/dismiss': () => json(409, { error: 'This report was already resolved.' }) })
    const resolved = await dismissReport('r-1', '').catch((e: unknown) => e)
    expect(resolved).toBeInstanceOf(ApiError)
    expect([(resolved as ApiError).status, (resolved as ApiError).message]).toEqual([409, 'This report was already resolved.'])
  })
})

describe('problem report card text', () => {
  const copy = { id: 'c-1', barcode: 'SL-000123', title: 'Clean Code' }
  const resource = { id: 'res-1', name: 'Group Room 201' }
  const report = (over: Partial<ReportDetails> = {}): ReportDetails => ({
    reportId: 'r-1', target: 'copy', category: 'damaged', note: null, copy, ...over,
  })

  it('names the categories as the card does', () => {
    expect(
      ['damaged', 'missing_pages', 'not_working', 'dirty', 'other'].map(reportCategoryLabel),
    ).toEqual(['Damaged', 'Missing pages', 'Not working', 'Dirty', 'Other'])
  })

  it('shows a category this console does not know as the server named it, capitalized, and never a built-in property', () => {
    expect(reportCategoryLabel('wrong_spot')).toBe('Wrong_spot')
    expect(reportCategoryLabel('constructor')).toBe('Constructor')
    expect(reportCategoryLabel('__proto__')).toBe('__proto__')
    expect(reportCategoryLabel('')).toBe('')
  })

  it('summarises a copy report as "Copy <barcode> of <title>, reported at return: <category>"', () => {
    expect(reportSummary(report())).toBe('Copy SL-000123 of Clean Code, reported at return: Damaged')
    expect(reportSummary(report({ category: 'missing_pages' }))).toBe('Copy SL-000123 of Clean Code, reported at return: Missing pages')
    expect(reportSummary(report({ category: 'other' }))).toBe('Copy SL-000123 of Clean Code, reported at return: Other')
  })

  it('summarises a resource report as "<resource> — <category>"', () => {
    const seat = report({ target: 'resource', category: 'not_working', copy: undefined, resource })
    expect(reportSummary(seat)).toBe('Group Room 201 — Not working')
    expect(reportSummary({ ...seat, category: 'dirty' })).toBe('Group Room 201 — Dirty')
  })

  it('still reads when the server leaves out the target it names', () => {
    expect(reportSummary(report({ copy: undefined }))).toBe('A copy, reported at return: Damaged')
    expect(reportSummary(report({ target: 'resource', category: 'dirty', copy: undefined }))).toBe('A resource — Dirty')
  })
})

describe('ATTENTION_KINDS', () => {
  it('names every kind this console can draw, so a kind it does not know is left out of the list', () => {
    expect([...ATTENTION_KINDS]).toEqual(['overdue', 'fine_dispute', 'report', 'no_show_dispute'])
  })
})

describe('no-show dispute card text', () => {
  const kolkataDay = (at: Date) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }).format(at)
  // The library's clock is Asia/Kolkata (UTC+5:30): 08:30Z to 10:30Z is 2 to 4 PM there.
  const afternoon = new Date(NOW - 2 * 86_400_000)
  afternoon.setUTCHours(8, 30, 0, 0)
  const noShow = (over: Partial<NoShowDetails> = {}): NoShowDetails => ({
    disputeId: 'nd-1',
    bookingId: 'b-1',
    resource: { id: 'res-1', name: 'Discussion Pod 3' },
    startTime: afternoon.toISOString(),
    endTime: new Date(afternoon.getTime() + 2 * 3_600_000).toISOString(),
    studentReason: 'I checked in at the desk but the app never registered it.',
    ...over,
  })

  it('summarises as "Disputes no-show flag on <resource>"', () => {
    expect(noShowSummary(noShow())).toBe('Disputes no-show flag on Discussion Pod 3')
    expect(noShowSummary(noShow({ resource: { id: 'res-2', name: 'Seat 14' } }))).toBe('Disputes no-show flag on Seat 14')
  })

  it("words the booking as \"<day>, <start>–<end>\" in the library's time zone", () => {
    expect(noShowBookingLine(noShow())).toBe(`${kolkataDay(afternoon)}, 2–4 PM`)
  })

  it('takes the day from the library clock, not UTC: a late-evening UTC slot is the next morning there', () => {
    const lateUtc = new Date(NOW - 3 * 86_400_000)
    lateUtc.setUTCHours(20, 0, 0, 0)
    const line = noShowBookingLine(noShow({
      startTime: lateUtc.toISOString(), endTime: new Date(lateUtc.getTime() + 2 * 3_600_000).toISOString(),
    }))
    expect(line).toBe(`${kolkataDay(lateUtc)}, 1:30–3:30 AM`)
    expect(kolkataDay(lateUtc)).not.toBe(new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(lateUtc))
  })
})

describe('overturnNoShowDispute', () => {
  it("POSTs to the dispute's overturn route with the token and the reason trimmed", async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/no-show-disputes/nd-1/overturn': () => json(200, { id: 'nd-1' }) })
    await expect(overturnNoShowDispute('nd-1', '  The desk log shows the check-in \n')).resolves.toEqual({ id: 'nd-1' })
    expect(fetch.mock.calls[0][1]!.body).toBe('{"reason":"The desk log shows the check-in"}')
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Content-Type')).toBe('application/json')
  })

  it('escapes the dispute id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/no-show-disputes/a%2Fb/overturn': () => json(200, {}) })
    await overturnNoShowDispute('a/b', 'Because')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/no-show-disputes\/a%2Fb\/overturn$/)
  })

  it("passes the server's refusals through", async () => {
    writeToken('t')
    mockFetch({
      'POST /admin/no-show-disputes/nd-1/overturn': () => json(409, { error: 'This dispute was already resolved.' }),
      'POST /admin/no-show-disputes/nd-2/overturn': () => json(404, { error: 'No-show dispute not found' }),
    })
    const resolved = await overturnNoShowDispute('nd-1', 'Because').catch((e: unknown) => e)
    expect(resolved).toBeInstanceOf(ApiError)
    expect([(resolved as ApiError).status, (resolved as ApiError).message]).toEqual([409, 'This dispute was already resolved.'])
    const missing = await overturnNoShowDispute('nd-2', 'Because').catch((e: unknown) => e)
    expect([(missing as ApiError).status, (missing as ApiError).message]).toEqual([404, 'No-show dispute not found'])
  })
})

describe('upholdNoShowDispute', () => {
  it("POSTs to the dispute's uphold route with the token, the note trimmed, and {} when it is blank", async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/no-show-disputes/nd-1/uphold': () => json(200, { id: 'nd-1' }) })
    await expect(upholdNoShowDispute('nd-1', '  The desk has no record of it \n')).resolves.toEqual({ id: 'nd-1' })
    await upholdNoShowDispute('nd-1', '')
    await upholdNoShowDispute('nd-1', '  \n ')
    expect(fetch.mock.calls.map(([, init]) => init!.body)).toEqual(['{"note":"The desk has no record of it"}', '{}', '{}'])
    expect(fetch.mock.calls[0][1]!.method).toBe('POST')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer t')
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Content-Type')).toBe('application/json')
  })

  it('escapes the dispute id in the path', async () => {
    writeToken('t')
    const fetch = mockFetch({ 'POST /admin/no-show-disputes/a%2Fb/uphold': () => json(200, {}) })
    await upholdNoShowDispute('a/b', '')
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/admin\/no-show-disputes\/a%2Fb\/uphold$/)
  })

  it("passes the server's refusal through", async () => {
    writeToken('t')
    mockFetch({ 'POST /admin/no-show-disputes/nd-1/uphold': () => json(409, { error: 'This dispute was already resolved.' }) })
    const resolved = await upholdNoShowDispute('nd-1', '').catch((e: unknown) => e)
    expect(resolved).toBeInstanceOf(ApiError)
    expect([(resolved as ApiError).status, (resolved as ApiError).message]).toEqual([409, 'This dispute was already resolved.'])
  })
})
