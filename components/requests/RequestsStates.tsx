import { CircleCheckBig, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { RequestKind } from '@/lib/requests'

const centered: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '70px 20px', textAlign: 'center',
}

export function RequestsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading requests" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map((i) => <div key={i} className="sla-skel" style={{ height: 84 }} />)}
    </div>
  )
}

export function RequestsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" style={centered}>
      <TriangleAlert size={30} strokeWidth={2.5} color="var(--color-neutral-600)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>Couldn&apos;t load requests</h3>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function RequestsEmpty() {
  return (
    <div style={centered}>
      <CircleCheckBig size={34} strokeWidth={2.5} color="var(--color-accent-2-700)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>You&apos;re all caught up</h3>
      <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: '38ch' }}>
        No requests waiting. New borrow and room requests appear here the moment students send them.
      </p>
    </div>
  )
}

export function FilterEmpty({ kind }: { kind: RequestKind }) {
  return (
    <p className="text-muted" style={{ margin: '40px 0', textAlign: 'center', fontSize: 13 }}>
      {kind === 'room' ? 'No room requests waiting.' : 'No borrow requests waiting.'}
    </p>
  )
}
