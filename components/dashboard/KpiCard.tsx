import Link from 'next/link'
import type { CSSProperties } from 'react'

/** One number on the Dashboard. With an `href` the whole card is a link (same look, no underline or link colour). */
export function KpiCard({
  kicker, value, note, valueStyle, noteStyle, href,
}: {
  kicker: string
  value: string
  note?: string
  valueStyle?: CSSProperties
  noteStyle?: CSSProperties
  href?: string
}) {
  const style: CSSProperties = { padding: '14px 16px' }
  const content = (
    <>
      <span className="card-kicker">{kicker}</span>
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 26, ...valueStyle }}>{value}</span>
      {note && <span className="text-muted" style={{ fontSize: 12, ...noteStyle }}>{note}</span>}
    </>
  )

  return href ? (
    <Link href={href} className="card elev-sm" style={{ ...style, color: 'inherit', textDecoration: 'none' }}>
      {content}
    </Link>
  ) : (
    <div className="card elev-sm" style={style}>
      {content}
    </div>
  )
}
