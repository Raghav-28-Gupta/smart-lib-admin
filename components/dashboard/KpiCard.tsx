import type { CSSProperties } from 'react'

export function KpiCard({
  kicker, value, note, valueStyle, noteStyle,
}: {
  kicker: string
  value: string
  note?: string
  valueStyle?: CSSProperties
  noteStyle?: CSSProperties
}) {
  return (
    <div className="card elev-sm" style={{ padding: '14px 16px' }}>
      <span className="card-kicker">{kicker}</span>
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 26, ...valueStyle }}>{value}</span>
      {note && <span className="text-muted" style={{ fontSize: 12, ...noteStyle }}>{note}</span>}
    </div>
  )
}
