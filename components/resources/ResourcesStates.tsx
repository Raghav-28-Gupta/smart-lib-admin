import { DoorOpen } from 'lucide-react'
import { EmptyBlock, ErrorBlock, LoadingBlock, NoMatchBlock } from '@/components/StateBlocks'

export function ResourcesSkeleton() {
  return <LoadingBlock label="Loading resources" height={240} />
}

export function ResourcesError({ onRetry }: { onRetry: () => void }) {
  return <ErrorBlock title="Couldn't load resources" onRetry={onRetry} />
}

/** The type filter matches nothing. */
export function ResourcesFilterEmpty({ onClear }: { onClear: () => void }) {
  return <NoMatchBlock title="No resources match this filter" clearLabel="Clear filter" onClear={onClear} />
}

/** There are no resources at all, so there is no filter to clear. */
export function ResourcesEmpty() {
  return <EmptyBlock icon={DoorOpen} title="No resources yet" hint="Add a seat or a room to start taking bookings." />
}
