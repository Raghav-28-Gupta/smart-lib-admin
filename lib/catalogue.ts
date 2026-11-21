import { apiRequest } from './api'

/** `held` is a copy kept for a pending borrow request. */
export type CopyStatus = 'available' | 'on_loan' | 'held' | 'maintenance' | 'lost'

// GET /admin/books (backend: src/services/adminCatalogueService.ts).
export interface AdminCopy {
  id: string
  barcode: string
  status: CopyStatus
  /** The open loan's student; null when the copy is not on loan, or was marked borrowed with no loan (seed data). */
  borrower: { id: string; name: string } | null
  /** ISO timestamp (UTC) the open loan is due; show it in the library time zone. */
  dueAt: string | null
  /** A lost copy whose replacement charge the student still owes; the Restore dialog offers to waive it. */
  owedReplacement: { fineId: string; amount: number; student: { id: string; name: string } } | null
}

export interface AdminBook {
  id: string
  isbn: string
  title: string
  author: string
  genre: string | null
  description: string | null
  publishedYear: number | null
  /** The copies that are not lost. */
  totalCopies: number
  availableCopies: number
  /** In barcode order. */
  copies: AdminCopy[]
}

export interface BooksPage {
  books: AdminBook[]
  total: number
  page: number
  pageSize: number
  /** The genres in use, for the book form's suggestions. */
  genres: string[]
}

export const CATALOGUE_PAGE_SIZE = 25

/** The book form's fields as the dialog holds them: every one is the text of a box. */
export interface BookForm {
  isbn: string
  title: string
  author: string
  genre: string
  description: string
  publishedYear: string
}

/** Title order, 25 to a page. A blank search sends no parameter. */
export function fetchBooks(q: { search: string; page: number }): Promise<BooksPage> {
  const params = new URLSearchParams()
  const search = q.search.trim()
  if (search) params.set('search', search)
  params.set('page', String(q.page))
  params.set('pageSize', String(CATALOGUE_PAGE_SIZE))
  return apiRequest<BooksPage>(`/admin/books?${params.toString()}`)
}

/** How many copies a book can be given at once, when it is added or later. */
export const MIN_COPIES = 1
export const MAX_COPIES = 20

/** The box's text as a whole number of copies from 1 to 20 (digits only: no sign, fraction or exponent), or null. */
export function parseCopies(text: string): number | null {
  const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN
  return n >= MIN_COPIES && n <= MAX_COPIES ? n : null
}

/** A blank year is none; anything else must be a whole number. */
export function isYearText(text: string): boolean {
  return text.trim() === '' || /^-?\d+$/.test(text.trim())
}

/** The server accepts published years from 1450 to the current year. */
export const MIN_PUBLISHED_YEAR = 1450
export const maxPublishedYear = () => new Date().getFullYear()

/** What the book form allows in the year box: blank, or a whole number from 1450 to this year. The server checks again. */
export function isPublishedYear(text: string): boolean {
  const year = text.trim()
  return year === '' || (isYearText(year) && Number(year) >= MIN_PUBLISHED_YEAR && Number(year) <= maxPublishedYear())
}

function bookBody(input: BookForm) {
  if (!isYearText(input.publishedYear)) throw new Error('The published year must be a whole number.')
  return {
    isbn: input.isbn.trim(),
    title: input.title.trim(),
    author: input.author.trim(),
    genre: input.genre.trim(),
    description: input.description.trim() || null,
    publishedYear: input.publishedYear.trim() === '' ? null : Number(input.publishedYear.trim()),
  }
}

/** The server answers 201 with the new book, and 409 for an ISBN already in the catalogue. */
export async function createBook(input: BookForm & { copies: number }): Promise<AdminBook> {
  return apiRequest<AdminBook>('/admin/books', { method: 'POST', body: { ...bookBody(input), copies: input.copies } })
}

export async function updateBook(id: string, input: BookForm): Promise<AdminBook> {
  return apiRequest<AdminBook>(`/admin/books/${encodeURIComponent(id)}`, { method: 'PATCH', body: bookBody(input) })
}

/** Adds `count` available copies (1 to 20); the server answers the book with them. */
export function addCopies(id: string, count: number): Promise<AdminBook> {
  return apiRequest<AdminBook>(`/admin/books/${encodeURIComponent(id)}/copies`, { method: 'POST', body: { count } })
}

/** The replacement charge for a copy lost on loan: whole rupees, 0 (no charge) to 10,000. */
export const MIN_REPLACEMENT_CHARGE = 0
export const MAX_REPLACEMENT_CHARGE = 10_000

/** The box's text as a whole number of rupees from 0 to 10,000 (digits only: no sign, fraction or exponent), or null. */
export function parseReplacementCharge(text: string): number | null {
  const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN
  return n >= MIN_REPLACEMENT_CHARGE && n <= MAX_REPLACEMENT_CHARGE ? n : null
}

const copyPath = (id: string, action: 'maintenance' | 'lost' | 'restore') => `/admin/copies/${encodeURIComponent(id)}/${action}`

/** An available copy goes into maintenance; the server answers the book. 409 if it changed, or the waitlist needs it. */
export function markCopyMaintenance(id: string): Promise<AdminBook> {
  return apiRequest<AdminBook>(copyPath(id, 'maintenance'), { method: 'POST' })
}

/**
 * A copy goes to lost; the server answers the book. A copy a student has on loan needs `replacementCharge`
 * (whole rupees, 0 to 10,000): their loan closes and the charge becomes a Lost book fine. A shelf copy sends none.
 */
export function markCopyLost(id: string, replacementCharge?: number): Promise<AdminBook> {
  return apiRequest<AdminBook>(copyPath(id, 'lost'), {
    method: 'POST',
    body: replacementCharge === undefined ? {} : { replacementCharge },
  })
}

/**
 * A maintenance or lost copy returns to circulation. `waiveReplacementCharge` asks the server to waive the replacement
 * fine of a copy lost on loan; `replacementWaived` says whether it did (not, if the fine was settled a moment earlier).
 */
export function restoreCopy(id: string, waiveReplacementCharge: boolean): Promise<{ book: AdminBook; replacementWaived: boolean }> {
  return apiRequest<{ book: AdminBook; replacementWaived: boolean }>(copyPath(id, 'restore'), {
    method: 'POST',
    body: { waiveReplacementCharge },
  })
}
