import { TrendingUp, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

const centered: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '70px 20px', textAlign: 'center',
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard metrics">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="sla-skel" style={{ height: 76 }} />)}
      </div>
      <div className="sla-skel" style={{ height: 180, marginBottom: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div className="sla-skel" style={{ height: 200 }} />
        <div className="sla-skel" style={{ height: 200 }} />
      </div>
    </div>
  )
}

export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" style={centered}>
      <TriangleAlert size={30} strokeWidth={2.5} color="var(--color-neutral-600)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>Couldn&apos;t load dashboard metrics</h3>
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Check your connection and try again.</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function DashboardEmpty() {
  return (
    <div style={centered}>
      <TrendingUp size={30} strokeWidth={2.5} color="var(--color-neutral-500)" aria-hidden="true" />
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: 18 }}>No activity recorded yet</h3>
      <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: '36ch' }}>
        Utilisation, circulation and demand metrics will appear here once bookings and loans start coming in.
      </p>
    </div>
  )
}
