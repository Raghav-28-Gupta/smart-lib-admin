import { apiRequest } from './api'

/**
 * `accruing` is computed, not stored: a loan past its due date that has not been returned yet. `disputed` is
 * derived too: a fine with an open dispute is listed as disputed, not as the outstanding or adjusted fine it
 * still is underneath. The others are fines the library has recorded.
 */
export type FineStatus = 'accruing' | 'outstanding' | 'disputed' | 'adjusted' | 'paid' | 'waived'

/** A student's open dispute of a fine (the Needs attention design, section 6.2). */
export interface FineDispute {
  id: string
  /** The student's own words, at most 300 characters. */
  reason: string
  /** ISO timestamp (UTC). */
  createdAt: string
}

// GET /admin/fines (backend: src/services/adminFineService.ts).
export interface AdminFine {
  /** The fine's id; for an accruing row, the loan's id. A fine and an accruing row can share one, so key rows by `kind` and `id`. */
  id: string
  kind: 'fine' | 'accruing'
  student: { id: string; name: string; email: string }
  reason: 'overdue' | 'no_show' | 'lost'
  /** The book's title, or the resource's name. */
  item: string
  /** Whole rupees. */
  amount: number
  /** Equals `amount` unless the fine was adjusted or waived. */
  originalAmount: number
  status: FineStatus
  /** ISO timestamp (UTC); show it in the library time zone. When the fine was created, or an accruing row's due date. */
  date: string
  /** The librarian's reason, for adjusted and waived fines. */
  note: string | null
  /** The librarian's name; null when the library itself made the change. */
  recordedBy: string | null
  /** True while the librarian can still mark it paid or adjust it. */
  canSettle: boolean
  /** The open dispute, or null when there is none. While it is open the fine cannot be marked paid, and adjusting it must name this id. */
  dispute: FineDispute | null
}

export interface FinesPage {
  fines: AdminFine[]
  total: number
  page: number
  pageSize: number
}

export const FINES_PAGE_SIZE = 25

/** The status select's options, in the canvas's order: Disputed sits right after Outstanding. */
export const FINE_STATUS_FILTERS: { value: FineStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'accruing', label: 'Accruing' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'adjusted', label: 'Adjusted' },
  { value: 'paid', label: 'Paid' },
  { value: 'waived', label: 'Waived' },
]

/** Newest first, 25 to a page. A blank search and the status 'all' send no parameter. */
export function fetchFines(q: { search: string; status: FineStatus | 'all'; page: number }): Promise<FinesPage> {
  const params = new URLSearchParams()
  const search = q.search.trim()
  if (search) params.set('search', search)
  if (q.status !== 'all') params.set('status', q.status)
  params.set('page', String(q.page))
  params.set('pageSize', String(FINES_PAGE_SIZE))
  return apiRequest<FinesPage>(`/admin/fines?${params.toString()}`)
}

const finePath = (id: string, action: string) => `/admin/fines/${encodeURIComponent(id)}/${action}`

/**
 * Records payment of an outstanding or adjusted fine, once the student has paid at the desk.
 * `amount` is the fine's current amount as the librarian saw it on the row: the server applies the
 * payment only while the fine still has that amount, and refuses (409) if it was lowered meanwhile.
 * The server answers the updated row.
 */
export function markFinePaid(id: string, amount: number): Promise<unknown> {
  return apiRequest<unknown>(finePath(id, 'paid'), { method: 'POST', body: { amount } })
}

/**
 * Lowers a fine to `amount` whole rupees, strictly below what it is now; 0 waives it. The reason is
 * required and shown on the student's fine history: it goes trimmed. The server answers the updated row.
 * `disputeId` is the id of the open dispute the librarian saw with the fine (null or left out when the fine showed
 * none): the server then closes that dispute too, and refuses (409) a dispute that opened or closed meanwhile.
 */
export function adjustFine(id: string, amount: number, reason: string, disputeId?: string | null): Promise<unknown> {
  const body = { amount, reason: reason.trim(), ...(disputeId ? { disputeId } : {}) }
  return apiRequest<unknown>(finePath(id, 'adjust'), { method: 'POST', body })
}
