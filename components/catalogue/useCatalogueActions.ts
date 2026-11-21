'use client'

import { useWriteAction } from '@/components/useWriteAction'
import {
  addCopies, createBook, markCopyLost, markCopyMaintenance, restoreCopy, updateBook, type AdminBook, type AdminCopy,
} from '@/lib/catalogue'

/** Shown when Restore was asked to waive the replacement charge but the server found it already settled. */
const NOT_WAIVED = 'Copy restored. The replacement charge was already settled, so it was not waived.'

/**
 * The Catalogue page's writes, through the console's shared write action: one at a time, the
 * server's refusal ("A book with this ISBN is already in the catalogue.", "This copy is set aside for a
 * student on the waitlist.") as a toast, and `busy` until the list has been refetched, so a card or chip
 * cannot be acted on twice.
 */
export function useCatalogueActions(refresh: () => Promise<void>) {
  const { busy, run } = useWriteAction(refresh)

  return {
    busy,
    create: (input: Parameters<typeof createBook>[0]) => run(() => createBook(input), 'Book added.'),
    update: (book: AdminBook, input: Parameters<typeof updateBook>[1]) => run(() => updateBook(book.id, input), 'Book updated.'),
    addCopies: (book: AdminBook, count: number) =>
      run(() => addCopies(book.id, count), count === 1 ? '1 copy added.' : `${count} copies added.`),
    maintenance: (copy: AdminCopy) => run(() => markCopyMaintenance(copy.id), 'Copy marked under maintenance.'),
    /** A charge goes only with a copy a student has on loan. */
    lost: (copy: AdminCopy, replacementCharge?: number) =>
      run(() => markCopyLost(copy.id, replacementCharge), 'Copy marked as lost.'),
    /** `waiveReplacementCharge` is whether the librarian ticked the box; the toast says when the server could not honour it. */
    restore: (copy: AdminCopy, waiveReplacementCharge: boolean) =>
      run(
        () => restoreCopy(copy.id, waiveReplacementCharge),
        (reply) => (waiveReplacementCharge && !reply.replacementWaived ? NOT_WAIVED : 'Copy restored.'),
      ),
  }
}
