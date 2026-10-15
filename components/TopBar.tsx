'use client'

import { todayLabel } from '@/lib/format'

const LIBRARY_TIMEZONE = process.env.NEXT_PUBLIC_LIBRARY_TIMEZONE ?? 'Asia/Kolkata'

export function TopBar({ title }: { title: string }) {
  return (
    <header
      style={{
        flex: 'none', padding: '16px 28px', borderBottom: '1px solid var(--color-divider)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 19, fontFamily: 'var(--font-heading)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </h2>
      <span className="text-muted" style={{ fontSize: 12, flex: 'none' }}>{todayLabel(new Date(), LIBRARY_TIMEZONE)}</span>
    </header>
  )
}
