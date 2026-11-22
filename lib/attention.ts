import { apiRequest } from './api'
import { daysAgo, dayCount, rupees, wholeDaysSince } from './format'

/** What a queue item is about; `?type=` on the page and the chips use the same names. */
export type AttentionKind = 'overdue' | 'fine_dispute' | 'report'

/** The newest notice sent about an overdue loan. `emailStatus` says whether the email went out. */
export interface LastNotice {
  kind: 'reminder' | 'escalation'
  /** ISO timestamp (UTC). */
  at: string
  emailStatus: 'sent' | 'failed' | 'skipped'
}

export interface OverdueDetails {
  loanId: string
  title: string
  /** ISO timestamp (UTC). */
  dueAt: string
  /** Whole days, at least 1. */
  daysOverdue: number
  /** The fine so far, in whole rupees. */
  amount: number
  /** The newest notice of either kind, so after an escalation followed by a reminder this is the reminder. */
  lastNotice: LastNotice | null
  /** Whether the loan has ever been escalated, even when a reminder was sent after it. An escalation happens once per loan. */
  escalated: boolean
}

interface AttentionItemBase {
  id: string
  student: { id: string; name: string; email: string }
  /** ISO timestamp (UTC): the due date, for an overdue loan. */
  waitingSince: string
}

export interface OverdueItem extends AttentionItemBase {
  kind: 'overdue'
  overdue: OverdueDetails
}

// GET /admin/attention (the Needs attention design, section 6.1). A discriminated union on `kind`: the fine dispute
// and problem report variants join it with their own tasks.
export type AttentionItem = OverdueItem

export interface AttentionCounts {
  all: number
  overdue: number
  fine_dispute: number
  report: number
}

/** The whole queue, oldest waiting first. `emailEnabled` is whether a notice goes out by email as well as in the app. */
export interface AttentionQueue {
  items: AttentionItem[]
  counts: AttentionCounts
  emailEnabled: boolean
}

export function fetchAttention(): Promise<AttentionQueue> {
  return apiRequest<AttentionQueue>('/admin/attention')
}

const loanPath = (loanId: string, action: string) => `/admin/loans/${encodeURIComponent(loanId)}/${action}`

/**
 * Sends the student an overdue reminder (a notice in the app, and an email when email is set up). The server answers the
 * updated queue item; it refuses (409) within 24 hours of the last reminder, or when the loan is no longer overdue.
 */
export function remindLoan(loanId: string): Promise<unknown> {
  return apiRequest<unknown>(loanPath(loanId, 'remind'), { method: 'POST' })
}

/**
 * Sends the student a formal overdue notice, once per loan. The note is optional and goes in the notice: it is sent
 * trimmed, and a blank one sends `{}`. The server answers the updated queue item, or refuses (409) when the loan was
 * already escalated or is no longer overdue.
 */
export function escalateLoan(loanId: string, note: string): Promise<unknown> {
  const trimmed = note.trim()
  return apiRequest<unknown>(loanPath(loanId, 'escalate'), { method: 'POST', body: trimmed ? { note: trimmed } : {} })
}

/** "waiting 3 days", "waiting 1 day", "waiting today". */
export function waitingText(waitingSince: string, now: number): string {
  const days = wholeDaysSince(waitingSince, now)
  return `waiting ${days === 0 ? 'today' : dayCount(days)}`
}

const JUST_NOW_MS = 60_000

/**
 * "Reminded 2 days ago · emailed", "Escalated 1 day ago · not emailed" (failed or skipped); '' when there is no notice.
 * A notice under a minute old (the one the librarian just sent), or stamped slightly ahead of this clock, reads "just
 * now"; the rest of that day reads "today".
 */
export function noticeLine(notice: LastNotice | null, now: number): string {
  if (!notice) return ''
  const what = notice.kind === 'escalation' ? 'Escalated' : 'Reminded'
  const when = now - Date.parse(notice.at) < JUST_NOW_MS ? 'just now' : daysAgo(notice.at, now)
  return `${what} ${when} · ${notice.emailStatus === 'sent' ? 'emailed' : 'not emailed'}`
}

/** "Clean Code — 3 days overdue". */
export function overdueSummary(overdue: OverdueDetails): string {
  return `${overdue.title} — ${dayCount(overdue.daysOverdue)} overdue`
}

/** "₹30 so far. Reminded 2 days ago · emailed", or just "₹30 so far." before any notice. */
export function overdueDetail(overdue: OverdueDetails, now: number): string {
  return [`${rupees(overdue.amount)} so far.`, noticeLine(overdue.lastNotice, now)].filter(Boolean).join(' ')
}
