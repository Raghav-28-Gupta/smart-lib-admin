import { weekdayShort } from '@/lib/format'
import type { Utilization } from '@/lib/metrics'

const MAX_BAR = 110

function barHeight(percent: number): number {
  return Math.round((Math.min(100, Math.max(0, percent)) / 100) * MAX_BAR)
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

export function UtilisationChart({ days }: { days: Utilization['days'] }) {
  return (
    <div className="card elev-sm" style={{ padding: '16px 18px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <span className="card-title" style={{ fontSize: 14 }}>Seat &amp; room utilisation, last 7 days</span>
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5 }}>
          <Legend color="var(--color-accent-600)" label="Seats" />
          <Legend color="var(--color-accent-2-600)" label="Rooms" />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 140 }}>
        {days.map((d) => (
          <div
            key={d.date}
            role="img"
            aria-label={`${weekdayShort(d.date)}: seats ${d.seatPercent}%, rooms ${d.roomPercent}%`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end', minWidth: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: MAX_BAR }}>
              <div style={{ width: 12, height: barHeight(d.seatPercent), background: 'var(--color-accent-600)', borderRadius: '3px 3px 0 0' }} />
              <div style={{ width: 12, height: barHeight(d.roomPercent), background: 'var(--color-accent-2-600)', borderRadius: '3px 3px 0 0' }} />
            </div>
            <span className="text-muted" style={{ fontSize: 11 }} aria-hidden="true">{weekdayShort(d.date)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
