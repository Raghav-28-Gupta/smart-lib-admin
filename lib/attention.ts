import { apiRequest } from './api'
import type { AdminFine, FineStatus } from './fines'
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

/** A student's open dispute of a fine, and the fine it is about (the Needs attention design, section 6.2). */
export interface DisputeDetails {
  disputeId: string
  /** The student's own words, at most 300 characters. */
  studentReason: string
  fine: {
    id: string
    /** The book's title, or the resource's name. */
    item: string
    reason: AdminFine['reason']
    /** Whole rupees, as the fine stands now. */
    amount: number
    originalAmount: number
    status: FineStatus
  }
}

export interface FineDisputeItem extends AttentionItemBase {
  kind: 'fine_dispute'
  /** `waitingSince` is when the student filed the dispute. */
  dispute: DisputeDetails
}

/**
 * A student's open problem report (the Needs attention design, section 6.4): on a copy, made when it was returned, or on a
 * seat or room. `category` is what the student chose (`damaged`, `missing_pages`, `not_working`, `dirty` or `other`), kept as
 * a string so a category a newer server adds still shows. A copy report carries `copy`, a resource report `resource`.
 */
export interface ReportDetails {
  reportId: string
  target: 'copy' | 'resource'
  category: string
  /** The student's own words, at most 300 characters; null when they gave none. */
  note: string | null
  copy?: { id: string; barcode: string; title: string }
  resource?: { id: string; name: string }
}

export interface ReportItem extends AttentionItemBase {
  kind: 'report'
  /** The report's id, which the confirm and dismiss routes take; `waitingSince` is when the student filed it. */
  report: ReportDetails
}

// GET /admin/attention (the Needs attention design, section 6.1). A discriminated union on `kind`.
export type AttentionItem = OverdueItem | FineDisputeItem | ReportItem

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

/**
 * Closes a student's fine dispute with the fine standing. The note is optional and goes in the notice the student gets:
 * it is sent trimmed, and a blank one sends `{}`. The server answers `{ id }`, or refuses (409) a dispute that was
 * already resolved, or (404) one that does not exist. Waiving or adjusting the fine is `adjustFine` with the dispute's id.
 */
export function upholdDispute(disputeId: string, note: string): Promise<unknown> {
  const trimmed = note.trim()
  return apiRequest<unknown>(`/admin/disputes/${encodeURIComponent(disputeId)}/uphold`, {
    method: 'POST',
    body: trimmed ? { note: trimmed } : {},
  })
}

/** What `confirmReport` settles a copy report as: sent to maintenance, or written off as lost from the shelf. */
export type ReportOutcome = 'maintenance' | 'lost'

/**
 * Confirms a problem report. A copy report names the `outcome` (the copy goes to maintenance, or is marked lost; neither
 * charges the student); a resource report sends none, and the server takes the resource offline. The note is optional and
 * goes in the notice the student gets: it is sent trimmed, and left out when blank. The server answers `{ id }`, or refuses
 * (409) when the copy was lent again or is set aside for a waitlisted student, or the report was already resolved (404 when
 * there is no such report); a refusal leaves the report open. A resource that is already offline is not a refusal: the
 * report just closes.
 */
export function confirmReport(id: string, body: { outcome?: ReportOutcome; note?: string }): Promise<unknown> {
  const note = body.note?.trim()
  return apiRequest<unknown>(`/admin/reports/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: { ...(body.outcome ? { outcome: body.outcome } : {}), ...(note ? { note } : {}) },
  })
}

/**
 * Closes a problem report with no action. The note is optional and goes in the notice the student gets: it is sent trimmed,
 * and a blank one sends `{}`. The server answers `{ id }`, or refuses (409) a report that was already resolved.
 */
export function dismissReport(id: string, note: string): Promise<unknown> {
  const trimmed = note.trim()
  return apiRequest<unknown>(`/admin/reports/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    body: trimmed ? { note: trimmed } : {},
  })
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

// What a fine was charged for, in the card's words (the same as the Fines table's Reason column: "Lost book", not "Lost").
const FINE_REASON_LABELS: Record<AdminFine['reason'], string> = { overdue: 'Overdue', no_show: 'No-show', lost: 'Lost book' }

/** "Disputes ₹150 Overdue fine on Clean Code". A reason this console does not know shows as the server named it. */
export function disputeSummary(dispute: DisputeDetails): string {
  const { amount, item, reason } = dispute.fine
  const label = Object.hasOwn(FINE_REASON_LABELS, reason) ? FINE_REASON_LABELS[reason] : reason
  return `Disputes ${rupees(amount)} ${label} fine on ${item}`
}

/**
 * The fine the Fines page's adjust dialog needs, built from the queue item so that dialog is reused as it is. It reads
 * the student, the item and the amount; the dispute is what the adjustment names. `date`, `note` and `recordedBy` are
 * stand-ins the dialog never shows (the item does not carry them).
 */
export function fineFromDispute(item: FineDisputeItem): AdminFine {
  const { disputeId, studentReason, fine } = item.dispute
  return {
    id: fine.id,
    kind: 'fine',
    student: item.student,
    reason: fine.reason,
    item: fine.item,
    amount: fine.amount,
    originalAmount: fine.originalAmount,
    status: fine.status,
    date: item.waitingSince,
    note: null,
    recordedBy: null,
    canSettle: true,
    dispute: { id: disputeId, reason: studentReason, createdAt: item.waitingSince },
  }
}

// What the student chose, in the card's words.
const REPORT_CATEGORY_LABELS: Record<string, string> = {
  damaged: 'Damaged',
  missing_pages: 'Missing pages',
  not_working: 'Not working',
  dirty: 'Dirty',
  other: 'Other',
}

/** "Missing pages". A category this console does not know shows as the server named it, capitalized. */
export function reportCategoryLabel(category: string): string {
  return Object.hasOwn(REPORT_CATEGORY_LABELS, category)
    ? REPORT_CATEGORY_LABELS[category]
    : category.charAt(0).toUpperCase() + category.slice(1)
}

/**
 * "Copy SL-000123 of Clean Code, reported at return: Damaged" for a copy, "Group Room 201 — Not working" for a resource. The
 * server names the target it reports on; if it ever leaves that out the line still reads ("A copy, reported at return: …").
 */
export function reportSummary(report: ReportDetails): string {
  const category = reportCategoryLabel(report.category)
  if (report.target === 'copy') {
    return report.copy
      ? `Copy ${report.copy.barcode} of ${report.copy.title}, reported at return: ${category}`
      : `A copy, reported at return: ${category}`
  }
  return `${report.resource?.name ?? 'A resource'} — ${category}`
}
