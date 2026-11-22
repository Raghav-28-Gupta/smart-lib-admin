import { CircleCheckBig } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ErrorBlock, NoMatchBlock } from '@/components/StateBlocks'

const centered: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '70px 20px', textAlign: 'center',
}

export function AttentionSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the queue" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map((i) => <div key={i} className="sla-skel" style={{ height: 84 }} />)}
    </div>
  )
}

export function AttentionError({ onRetry }: { onRetry: () => void }) {
  return <ErrorBlock title="Couldn't load the queue" onRetry={onRetry} />
}

/** The queue is empty. The canvas's "handled automatically" sentence is replaced on purpose: it no longer holds. */
export function AttentionEmpty() {
  return (
    <div style={centered}>
      <CircleCheckBig size={34} strokeWidth={2.5} color="var(--color-accent-2-700)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>You&apos;re all caught up</h3>
      <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: '38ch' }}>
        Nothing needs attention right now. Overdue loans, fine disputes and problem reports will show up here.
      </p>
    </div>
  )
}

/** The chip's kind has nothing queued, though other kinds do: offers to go back to All. `what` is the plural ("fine disputes"). */
export function AttentionFilterEmpty({ what, onClear }: { what: string; onClear: () => void }) {
  return <NoMatchBlock title={`No ${what} waiting`} clearLabel="Clear filter" onClear={onClear} />
}
