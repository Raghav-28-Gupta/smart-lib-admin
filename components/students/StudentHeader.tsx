import { initials } from '@/lib/format'
import { tierTagClass, type AdminStudent } from '@/lib/students'

/**
 * The canvas's student header: initials, name, "<roll> · <email>", the server's tier as a tag, and Adjust reliability
 * (disabled while a change is settling, as the other pages' row actions are).
 */
export function StudentHeader({ student, busy, onAdjust }: { student: AdminStudent; busy: boolean; onAdjust: () => void }) {
  return (
    <div className="card elev-sm" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '18px 20px', flexWrap: 'wrap' }}>
      <div
        aria-hidden="true"
        style={{
          width: 52, height: 52, borderRadius: '50%', background: 'var(--color-accent-2-200)', color: 'var(--color-accent-2-800)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontSize: 18, flex: 'none',
        }}
      >
        {initials(student.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 600, overflowWrap: 'anywhere' }}>{student.name}</div>
        <div className="text-muted" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{`${student.roll} · ${student.email}`}</div>
      </div>
      <span className={`tag ${tierTagClass(student.tier)}`}>{student.tier}</span>
      <button type="button" className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }} disabled={busy} onClick={onAdjust}>
        Adjust reliability
      </button>
    </div>
  )
}
