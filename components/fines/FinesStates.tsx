import { Wallet } from 'lucide-react'
import { EmptyBlock, ErrorBlock, LoadingBlock, NoMatchBlock } from '@/components/StateBlocks'

export function FinesSkeleton() {
  return <LoadingBlock label="Loading fines" height={260} />
}

export function FinesError({ onRetry }: { onRetry: () => void }) {
  return <ErrorBlock title="Couldn't load fines" onRetry={onRetry} />
}

/** The search or the status filter matches nothing. */
export function FinesFilterEmpty({ onClear }: { onClear: () => void }) {
  return <NoMatchBlock title="No fines match these filters" clearLabel="Clear filters" onClear={onClear} />
}

/** There are no fines at all, so there is no filter to clear. */
export function FinesEmpty() {
  return <EmptyBlock icon={Wallet} title="No fines yet" hint="Overdue loans, no-shows and lost books appear here as they happen." />
}
