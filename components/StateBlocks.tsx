import { CircleAlert, Search, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

// The loading, error and empty blocks a list page shows in place of its table.
// Each page words them for its own list (see ResourcesStates, BookingsStates).

const centered: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '70px 20px', textAlign: 'center',
}
const heading: CSSProperties = { margin: 0, fontWeight: 400, fontSize: 18 }

export function LoadingBlock({ label, height }: { label: string; height: number }) {
  return <div aria-busy="true" aria-label={label} className="sla-skel" style={{ height }} />
}

export function ErrorBlock({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div role="alert" style={centered}>
      <CircleAlert size={30} strokeWidth={2.5} color="var(--color-neutral-600)" aria-hidden="true" />
      <h3 style={heading}>{title}</h3>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  )
}

/** The filters match nothing: offers to clear them. */
export function NoMatchBlock({ title, clearLabel, onClear }: { title: string; clearLabel: string; onClear: () => void }) {
  return (
    <div style={centered}>
      <Search size={30} strokeWidth={2.5} color="var(--color-neutral-500)" aria-hidden="true" />
      <h3 style={heading}>{title}</h3>
      <button type="button" className="btn btn-secondary" onClick={onClear}>{clearLabel}</button>
    </div>
  )
}

/** There is nothing at all, so there is no filter to clear. `hint` is left out when the title says it all. */
export function EmptyBlock({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div style={centered}>
      <Icon size={30} strokeWidth={2.5} color="var(--color-neutral-500)" aria-hidden="true" />
      <h3 style={heading}>{title}</h3>
      {hint && <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: '38ch' }}>{hint}</p>}
    </div>
  )
}
