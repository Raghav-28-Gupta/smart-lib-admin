import { useId } from 'react'
import { LIBRARY_TIMEZONE, shortDay } from '@/lib/format'
import { reliabilityChart, ringDash, type AdminStudent } from '@/lib/students'

/**
 * The canvas's reliability card: the score ring, the line through the history (oldest to newest, though the
 * server sends it newest first) and the dated list, newest first, with the score each entry left and its reason.
 * A manual adjustment names the librarian who made it.
 */
export function ReliabilityCard({ student }: { student: Pick<AdminStudent, 'score' | 'history'> }) {
  const titleId = useId()
  const chart = reliabilityChart(student.history)
  return (
    <section
      aria-labelledby={titleId}
      className="card elev-sm"
      style={{ padding: '16px 18px', flexDirection: 'row', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}
    >
      <svg width="86" height="86" viewBox="0 0 120 120" role="img" aria-label={`Reliability score ${student.score} out of 100`} style={{ flex: 'none' }}>
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-neutral-300)" strokeWidth="10" />
        <circle
          cx="60" cy="60" r="52" fill="none" stroke="var(--color-accent-2-600)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={ringDash(student.score)} transform="rotate(-90 60 60)"
        />
        <text x="60" y="67" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="28" fill="var(--color-text)">{student.score}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 220 }}>
        <h3 id={titleId} className="card-title" style={{ fontSize: 13.5, margin: '0 0 8px' }}>Reliability history</h3>
        <svg
          width="100%" height="56" viewBox="0 0 280 56" preserveAspectRatio="none" role="img" aria-label="Reliability score over time"
          style={{ display: 'block', marginBottom: 8 }}
        >
          <polyline points={chart.points} fill="none" stroke="var(--color-accent-2-600)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {chart.dots.map((dot, i) => (
            <circle key={i} cx={dot.x} cy={dot.y} r="3.2" fill="var(--color-accent-2-700)" />
          ))}
        </svg>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {student.history.map((entry, i) => (
            <li key={`${entry.date}:${i}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12 }}>
              <span className="text-muted" style={{ width: 88, flex: 'none' }}>{shortDay(entry.date, LIBRARY_TIMEZONE)}</span>
              <span style={{ fontWeight: 600, width: 26, flex: 'none' }}>{entry.score}</span>
              <span className="text-muted" style={{ overflowWrap: 'anywhere' }}>{entry.by ? `${entry.reason} — ${entry.by}` : entry.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
