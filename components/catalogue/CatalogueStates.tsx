import { BookOpen } from 'lucide-react'
import { EmptyBlock, ErrorBlock, LoadingBlock, NoMatchBlock } from '@/components/StateBlocks'

export function CatalogueSkeleton() {
  return <LoadingBlock label="Loading the catalogue" height={300} />
}

export function CatalogueError({ onRetry }: { onRetry: () => void }) {
  return <ErrorBlock title="Couldn't load the catalogue" onRetry={onRetry} />
}

/** The search matches nothing. */
export function CatalogueNoMatch({ onClear }: { onClear: () => void }) {
  return <NoMatchBlock title="No books match your search" clearLabel="Clear search" onClear={onClear} />
}

/** There are no books at all, so there is no search to clear. */
export function CatalogueEmpty() {
  return <EmptyBlock icon={BookOpen} title="No books yet" hint="Add a title with its copies to start the catalogue." />
}
