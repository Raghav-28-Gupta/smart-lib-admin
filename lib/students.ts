import { apiRequest } from './api'
import type { AdminFine } from './fines'

/** One entry of the reliability log. */
export interface ReliabilityEntry {
  /** ISO timestamp (UTC); show it in the library time zone. */
  date: string
  /** The score after this change. */
  score: number
  /** The change this entry made. */
  delta: number
  reason: string
  /** The librarian's name, for a manual adjustment; null for the automatic ones. */
  by: string | null
}

/** A loan's state, derived by the server. A lost loan carries `lostAt` and no `returnedAt`. */
export type LoanStatus = 'active' | 'overdue' | 'returned' | 'lost'

export interface StudentLoan {
  id: string
  title: string
  /** ISO timestamps (UTC). */
  borrowedAt: string
  dueAt: string
  returnedAt: string | null
  lostAt: string | null
  status: LoanStatus
}

export interface StudentBooking {
  id: string
  /** The resource's name. */
  resource: string
  /** ISO timestamps (UTC). */
  startTime: string
  endTime: string
  /**
   * booked, released, checked_in, completed, cancelled, requested, declined, expired or no_show.
   * A string, not a union: a value a newer server adds still shows, as itself.
   */
  status: string
}

// GET /admin/students/:id (backend: src/services/adminStudentService.ts). Every list is newest first, at most 50.
export interface AdminStudent {
  id: string
  name: string
  email: string
  /** 'Pending' when the student has none yet. */
  roll: string
  score: number
  /** The server's own tier name (Good standing, Building back up, ...). */
  tier: string
  history: ReliabilityEntry[]
  loans: StudentLoan[]
  bookings: StudentBooking[]
  /** The Fines page's row type, accruing rows included. */
  fines: AdminFine[]
}

/** The sections a student is opened from; the URL's `?from=` names one. */
export type StudentFrom = 'bookings' | 'fines' | 'requests' | 'catalogue'

const SECTIONS: Record<StudentFrom, { label: string; href: string }> = {
  bookings: { label: 'Bookings', href: '/bookings' },
  fines: { label: 'Fines', href: '/fines' },
  requests: { label: 'Requests', href: '/requests' },
  catalogue: { label: 'Catalogue', href: '/catalogue' },
}
const DASHBOARD = { label: 'Dashboard', href: '/dashboard' }

/**
 * The section a student page was opened from: its sidebar label and link. A missing or unknown value (the page
 * opened directly, or a hand-edited URL) is the Dashboard. Only the four own keys count: `?from=constructor` is unknown too.
 */
export function studentSection(from: string | null | undefined): { label: string; href: string } {
  return from && Object.hasOwn(SECTIONS, from) ? SECTIONS[from as StudentFrom] : DASHBOARD
}

/** `/students/<id>?from=<from>`: the link every student name in the console points at. */
export function studentHref(id: string, from: StudentFrom): string {
  return `/students/${encodeURIComponent(id)}?from=${from}`
}

const studentPath = (id: string) => `/admin/students/${encodeURIComponent(id)}`

/** 404 (`Student not found`) for an unknown id or an admin account: an ApiError with that status. */
export function fetchStudent(id: string): Promise<AdminStudent> {
  return apiRequest<AdminStudent>(studentPath(id))
}

/**
 * Moves the score by `delta`, a whole number from −10 to 10 and not 0, with the librarian's reason (required, trimmed;
 * the student sees it). The server answers the updated student, and refuses with 409 when the score is already at 100 or 0.
 */
export function adjustReliability(id: string, delta: number, reason: string): Promise<AdminStudent> {
  return apiRequest<AdminStudent>(`${studentPath(id)}/reliability`, { method: 'POST', body: { delta, reason: reason.trim() } })
}

/** The range of one manual adjustment, in points; 0 is not an adjustment. */
export const MIN_ADJUSTMENT = -10
export const MAX_ADJUSTMENT = 10

/** The tier tag: Good standing is accent-2, every other tier accent (the spec's one rule). */
export function tierTagClass(tier: string): string {
  return tier === 'Good standing' ? 'tag-accent-2' : 'tag-accent'
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 52

/** The `stroke-dasharray` of the canvas's score ring (radius 52): the score's share of the circle, then the circle. */
export function ringDash(score: number): string {
  const share = Math.max(0, Math.min(100, score)) / 100
  return `${share * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`
}

// The canvas's chart box (a 280 x 56 viewBox) and its inner padding.
const CHART_WIDTH = 280
const CHART_HEIGHT = 56
const CHART_PAD = 6

/**
 * The reliability line, as the canvas draws it. The history arrives newest first; the line runs oldest to newest, left to
 * right, so it is reversed here (a copy: the caller's list is untouched). A single entry sits in the middle.
 */
export function reliabilityChart(newestFirst: { score: number }[]): { points: string; dots: { x: number; y: number }[] } {
  const oldestFirst = [...newestFirst].reverse()
  const last = oldestFirst.length - 1
  const dots = oldestFirst.map((entry, i) => {
    const x = last > 0 ? CHART_PAD + (i * (CHART_WIDTH - 2 * CHART_PAD)) / last : CHART_WIDTH / 2
    const score = Math.max(0, Math.min(100, entry.score))
    const y = CHART_HEIGHT - CHART_PAD - (score / 100) * (CHART_HEIGHT - 2 * CHART_PAD)
    return { x: Math.round(x), y: Math.round(y) }
  })
  return { points: dots.map((d) => `${d.x},${d.y}`).join(' '), dots }
}
