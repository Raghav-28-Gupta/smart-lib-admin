export interface RankedRow {
  key: string
  label: string
  value: number
  display: string
}

/** A titled list of rows with bars. `scaleMax: 'top'` scales bars to the largest row. */
export function RankedBars({
  title, rows, scaleMax, color, emptyText,
}: {
  title: string
  rows: RankedRow[]
  scaleMax: number | 'top'
  color: string
  emptyText: string
}) {
  const max = scaleMax === 'top' ? Math.max(1, ...rows.map((r) => r.value)) : scaleMax
  return (
    <div className="card elev-sm" style={{ padding: '16px 18px' }}>
      <span className="card-title" style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>{title}</span>
      {rows.length === 0 ? (
        <span className="text-muted" style={{ fontSize: 12.5 }}>{emptyText}</span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
              <span title={r.label} style={{ fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.label}
              </span>
              <div aria-hidden="true" style={{ width: 80, height: 6, background: 'var(--color-neutral-200)', borderRadius: 3, flex: 'none', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(Math.min(1, r.value / max) * 100)}%`, height: '100%', background: color }} />
              </div>
              <span className="text-muted" style={{ fontSize: 11.5, width: 34, textAlign: 'right', flex: 'none' }}>{r.display}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
