'use client'

import { LIBRARY_TIMEZONE, todayLabel } from '@/lib/format'
import type { LiveStatus } from '@/lib/live'

const LIVE_LABELS: Record<LiveStatus, string> = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' }

export function TopBar({ title, liveStatus = 'connecting' }: { title: string; liveStatus?: LiveStatus }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
        <span className="sla-live text-muted" data-status={liveStatus}>
          <span className="sla-live-dot" aria-hidden="true">{liveStatus === 'live' ? '●' : '○'}</span>
          {LIVE_LABELS[liveStatus]}
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>{todayLabel(new Date(), LIBRARY_TIMEZONE)}</span>
      </div>
    </header>
  )
}
