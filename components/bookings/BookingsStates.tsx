import { Calendar } from 'lucide-react'
import { EmptyBlock, ErrorBlock, LoadingBlock, NoMatchBlock } from '@/components/StateBlocks'

export function BookingsSkeleton() {
  return <LoadingBlock label="Loading bookings" height={280} />
}

export function BookingsError({ onRetry }: { onRetry: () => void }) {
  return <ErrorBlock title="Couldn't load bookings" onRetry={onRetry} />
}

/** The search or the status filter matches nothing. */
export function BookingsFilterEmpty({ onClear }: { onClear: () => void }) {
  return <NoMatchBlock title="No bookings match these filters" clearLabel="Clear filters" onClear={onClear} />
}

/** There are no bookings at all, so there is no filter to clear. */
export function BookingsEmpty() {
  return <EmptyBlock icon={Calendar} title="No bookings yet" hint="Seat and room bookings appear here as students make them." />
}
