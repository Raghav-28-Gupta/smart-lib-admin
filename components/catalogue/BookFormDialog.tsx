'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { useDialogSubmit } from '@/components/catalogue/useDialogSubmit'
import {
  isPublishedYear, MAX_COPIES, MIN_COPIES, MIN_PUBLISHED_YEAR, maxPublishedYear, parseCopies, type AdminBook, type BookForm,
} from '@/lib/catalogue'

export type BookFormValues = BookForm & { copies: number }

/**
 * The canvas's Add a book and Edit book details dialogs. With a `book` it edits and starts from that book's
 * fields; without one it adds, and asks for the number of copies too (copies are added later with + Copies).
 * Confirm is disabled until ISBN, title, author and genre are filled, the copies are 1 to 20 and a filled
 * year is a whole number from 1450 to this year; the server checks everything again. The genre is typed,
 * with the genres in use as suggestions.
 *
 * `onSubmit` resolves true once the book is saved and the page closes the dialog; on false the dialog stays open
 * with everything typed (the page has toasted the server's reason). Confirm is disabled while the save is in flight.
 */
export function BookFormDialog({
  book, genres, onCancel, onSubmit,
}: {
  book?: AdminBook
  genres: string[]
  onCancel: () => void
  onSubmit: (values: BookFormValues) => Promise<boolean>
}) {
  const editing = book !== undefined
  const [isbn, setIsbn] = useState(book?.isbn ?? '')
  const [title, setTitle] = useState(book?.title ?? '')
  const [author, setAuthor] = useState(book?.author ?? '')
  const [genre, setGenre] = useState(book?.genre ?? '')
  const [description, setDescription] = useState(book?.description ?? '')
  const [publishedYear, setPublishedYear] = useState(String(book?.publishedYear ?? ''))
  const [copies, setCopies] = useState('1')
  const id = useId()
  const { submitting, submit, confirmRef } = useDialogSubmit(onSubmit)

  const copiesCount = parseCopies(copies)
  const yearValid = isPublishedYear(publishedYear)
  const maxYear = maxPublishedYear()
  const valid = [isbn, title, author, genre].every((text) => text.trim() !== '') && yearValid && (editing || copiesCount !== null)

  return (
    <Dialog title={editing ? 'Edit book details' : 'Add a book'} onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit({ isbn, title, author, genre, description, publishedYear, copies: copiesCount ?? 1 })
        }}
      >
        {!editing && <div className="dialog-body">New title added to the catalogue with its copies.</div>}
        <div className="field">
          <label htmlFor={`${id}-isbn`}>ISBN</label>
          <input id={`${id}-isbn`} className="input" maxLength={20} autoFocus value={isbn} onChange={(e) => setIsbn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-author`}>Author</label>
          <input id={`${id}-author`} className="input" maxLength={200} value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-genre`}>Genre</label>
          <input id={`${id}-genre`} className="input" maxLength={50} list={`${id}-genres`} value={genre} onChange={(e) => setGenre(e.target.value)} />
          <datalist id={`${id}-genres`}>
            {genres.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor={`${id}-description`}>Description</label>
          <textarea
            id={`${id}-description`}
            className="input"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: editing ? '1fr' : '1fr 1fr', gap: 'var(--space-3)' }}>
          <div className="field">
            <label htmlFor={`${id}-year`}>Published year</label>
            <input
              id={`${id}-year`}
              className="input"
              type="number"
              min={MIN_PUBLISHED_YEAR}
              max={maxYear}
              step={1}
              aria-invalid={!yearValid}
              aria-describedby={`${id}-year-hint`}
              value={publishedYear}
              onChange={(e) => setPublishedYear(e.target.value)}
            />
            <div id={`${id}-year-hint`} className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              {`A whole number from ${MIN_PUBLISHED_YEAR} to ${maxYear}.`}
            </div>
          </div>
          {!editing && (
            <div className="field">
              <label htmlFor={`${id}-copies`}>Copies</label>
              <input
                id={`${id}-copies`}
                className="input"
                type="number"
                min={MIN_COPIES}
                max={MAX_COPIES}
                step={1}
                aria-invalid={copiesCount === null}
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="submit" className="btn btn-primary" disabled={!valid || submitting}>
            {editing ? 'Save changes' : 'Add book'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
