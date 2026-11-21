import { CopyChip, type CopyAction } from '@/components/catalogue/CopyChip'
import type { AdminBook, AdminCopy } from '@/lib/catalogue'

const smallButton = { padding: '5px 10px', fontSize: 12 }

/**
 * The canvas's catalogue card: title, author, genre tag, "n of m available" (the server's counts, which
 * leave lost copies out), Edit and + Copies, then a chip per copy with its actions. `busy` disables
 * every button while a change is settling.
 */
export function BookCard({
  book, busy, onEdit, onAddCopies, onCopyAction,
}: {
  book: AdminBook
  busy: boolean
  onEdit: (book: AdminBook) => void
  onAddCopies: (book: AdminBook) => void
  onCopyAction: (copy: AdminCopy, action: CopyAction) => void
}) {
  return (
    <article aria-label={book.title} className="card elev-sm" style={{ padding: '14px 16px', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{book.title}</div>
          <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{book.author}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 'none' }}>
          {book.genre && <span className="tag tag-neutral">{book.genre}</span>}
          <span className="text-muted" style={{ fontSize: 12 }}>{`${book.availableCopies} of ${book.totalCopies} available`}</span>
          <button type="button" className="btn btn-ghost" style={smallButton} disabled={busy} onClick={() => onEdit(book)}>
            Edit
          </button>
          <button type="button" className="btn btn-ghost" style={smallButton} disabled={busy} onClick={() => onAddCopies(book)}>
            + Copies
          </button>
        </div>
      </div>
      <ul aria-label={`Copies of ${book.title}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
        {book.copies.map((copy) => (
          <CopyChip key={copy.id} copy={copy} busy={busy} onAction={onCopyAction} />
        ))}
      </ul>
    </article>
  )
}
