'use client'

import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { AddCopiesDialog } from '@/components/catalogue/AddCopiesDialog'
import { BookCard } from '@/components/catalogue/BookCard'
import { BookFormDialog } from '@/components/catalogue/BookFormDialog'
import { CatalogueEmpty, CatalogueError, CatalogueNoMatch, CatalogueSkeleton } from '@/components/catalogue/CatalogueStates'
import type { CopyAction } from '@/components/catalogue/CopyChip'
import { CopyStatusDialog } from '@/components/catalogue/CopyStatusDialog'
import { LostOnLoanDialog } from '@/components/catalogue/LostOnLoanDialog'
import { useCatalogueActions } from '@/components/catalogue/useCatalogueActions'
import { Pager } from '@/components/Pager'
import { fetchBooks, type AdminBook, type AdminCopy, type BooksPage } from '@/lib/catalogue'
import { pageRange } from '@/lib/format'
import { useLiveRefresh } from '@/lib/liveContext'
import { useListQuery } from '@/lib/useListQuery'

type OpenDialog =
  | null
  | { kind: 'add' }
  | { kind: 'edit' | 'copies'; book: AdminBook }
  | { kind: 'copy'; action: CopyAction; copy: AdminCopy }

export default function CataloguePage() {
  const { state, data, refresh, retry, searchInput, setSearchInput, setPage, pastEnd, filtered, clearFilters } =
    useListQuery<BooksPage>(fetchBooks, (reply) => reply.books.length)
  // A pending borrow request holds a copy, so request events change the page too.
  useLiveRefresh(['catalogue', 'requests'], () => void refresh())

  const [dialog, setDialog] = useState<OpenDialog>(null)
  const actions = useCatalogueActions(refresh)
  const close = useCallback(() => setDialog(null), [])
  // A dialog stays open, with what was typed, until its write has gone through; a refusal is toasted and the librarian fixes it.
  const closeWhenSaved = async (write: Promise<boolean>) => {
    const saved = await write
    if (saved) close()
    return saved
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          aria-label="Search books"
          placeholder="Search title, author, ISBN or barcode"
          maxLength={100}
          style={{ maxWidth: 340 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <span className="text-muted" style={{ fontSize: 12, flex: 1 }}>
          {data && !pastEnd ? pageRange(data.page, data.pageSize, data.total, ['title', 'titles']) : ''}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '8px 14px', fontSize: 13 }}
          disabled={actions.busy}
          onClick={() => setDialog({ kind: 'add' })}
        >
          <Plus size={14} strokeWidth={2.75} aria-hidden="true" style={{ marginRight: 5, verticalAlign: -2 }} />
          Add book
        </button>
      </div>

      {state.kind === 'loading' || pastEnd ? (
        <CatalogueSkeleton />
      ) : state.kind === 'error' ? (
        <CatalogueError onRetry={retry} />
      ) : state.data.books.length === 0 ? (
        filtered ? <CatalogueNoMatch onClear={clearFilters} /> : <CatalogueEmpty />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {state.data.books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                busy={actions.busy}
                onEdit={(b) => setDialog({ kind: 'edit', book: b })}
                onAddCopies={(b) => setDialog({ kind: 'copies', book: b })}
                onCopyAction={(copy, action) => setDialog({ kind: 'copy', action, copy })}
              />
            ))}
          </div>
          <Pager page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onPage={setPage} />
        </>
      )}

      {dialog?.kind === 'add' && (
        <BookFormDialog
          genres={data?.genres ?? []}
          onCancel={close}
          onSubmit={(values) => closeWhenSaved(actions.create(values))}
        />
      )}
      {dialog?.kind === 'edit' && (
        <BookFormDialog
          book={dialog.book}
          genres={data?.genres ?? []}
          onCancel={close}
          onSubmit={(values) => closeWhenSaved(actions.update(dialog.book, values))}
        />
      )}
      {dialog?.kind === 'copies' && (
        <AddCopiesDialog
          book={dialog.book}
          onCancel={close}
          onConfirm={(count) => closeWhenSaved(actions.addCopies(dialog.book, count))}
        />
      )}
      {dialog?.kind === 'copy' &&
        // A copy a student has on loan asks for the replacement charge. One marked borrowed with no open loan
        // (seed data) has nobody to charge, so it gets the plain confirmation.
        (dialog.action === 'lost' && dialog.copy.status === 'on_loan' && dialog.copy.borrower ? (
          <LostOnLoanDialog
            student={dialog.copy.borrower.name}
            dueAt={dialog.copy.dueAt}
            onCancel={close}
            onConfirm={(charge) => closeWhenSaved(actions.lost(dialog.copy, charge))}
          />
        ) : (
          <CopyStatusDialog
            copy={dialog.copy}
            action={dialog.action}
            onCancel={close}
            onConfirm={(waive) =>
              closeWhenSaved(
                dialog.action === 'maintenance'
                  ? actions.maintenance(dialog.copy)
                  : dialog.action === 'lost'
                    ? actions.lost(dialog.copy)
                    : actions.restore(dialog.copy, waive),
              )
            }
          />
        ))}
    </>
  )
}
