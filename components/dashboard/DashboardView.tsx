import { countDelta, pointsDelta, slotRange } from '@/lib/format'
import type { DashboardMetrics } from '@/lib/metrics'
import { KpiCard } from './KpiCard'
import { RankedBars } from './RankedBars'
import { UtilisationChart } from './UtilisationChart'

export function DashboardView({ metrics }: { metrics: DashboardMetrics }) {
  const { utilization: u, circulation: c, overdue: o, demand: d } = metrics
  const peak = d.areas[0]
  const peakNote = peak && `${peak.percent}% booked${peak.busiestSlot ? `, ${slotRange(peak.busiestSlot)} busiest` : ''}`

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 18 }}>
        <KpiCard
          kicker="Utilisation today"
          value={`${u.today.percent}%`}
          note={pointsDelta(u.today.percent, u.today.lastWeekPercent)}
          noteStyle={{ color: 'var(--color-accent-2-800)' }}
        />
        <KpiCard kicker="Circulation, 7 days" value={`${c.borrows} / ${c.returns}`} note="Borrows / returns" />
        <KpiCard
          kicker="Overdue materials"
          value={String(o.count)}
          valueStyle={{ color: 'var(--color-accent-700)' }}
          note={countDelta(o.count, o.countYesterday)}
        />
        <KpiCard
          kicker="Peak demand"
          value={peak ? peak.area : 'No resources yet'}
          valueStyle={{ fontSize: 19 }}
          note={peakNote || undefined}
        />
      </div>

      <UtilisationChart days={u.days} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <RankedBars
          title="Top titles, last 7 days"
          rows={c.topTitles.map((t) => ({ key: t.bookId, label: t.title, value: t.borrows, display: String(t.borrows) }))}
          scaleMax="top"
          color="var(--color-accent-600)"
          emptyText="No borrows in the last 7 days."
        />
        <RankedBars
          title="Resource demand, last 7 days"
          rows={d.areas.map((a) => ({ key: a.area, label: a.area, value: a.percent, display: `${a.percent}%` }))}
          scaleMax={100}
          color="var(--color-accent-2-600)"
          emptyText="No resources yet."
        />
      </div>
    </>
  )
}
