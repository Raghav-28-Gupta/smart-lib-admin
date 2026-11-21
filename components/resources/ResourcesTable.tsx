import type { AdminResource, ResourceType } from '@/lib/resources'

const TYPE_LABELS: Record<ResourceType, string> = { seat: 'Seat', room: 'Room' }

/** The canvas's resources table. `busy` disables every action while a change is settling. */
export function ResourcesTable({
  resources, busy, onEdit, onToggle,
}: {
  resources: AdminResource[]
  busy: boolean
  onEdit: (resource: AdminResource) => void
  /** Take offline, or bring back online, depending on the resource's status. */
  onToggle: (resource: AdminResource) => void
}) {
  return (
    <div style={{ border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
      <table className="table" style={{ width: '100%', minWidth: 640 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Location</th>
            <th>Capacity</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const offline = r.status === 'offline'
            return (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="text-muted">{TYPE_LABELS[r.type]}</td>
                <td className="text-muted">{r.location ?? '—'}</td>
                <td className="text-muted">{r.capacity}</td>
                <td>
                  <span className={`tag ${offline ? 'tag-accent' : 'tag-accent-2'}`}>{offline ? 'Offline' : 'Available'}</span>
                  {offline && r.statusNote && (
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>{r.statusNote}</div>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => onEdit(r)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 12, color: 'var(--color-accent-700)' }}
                    disabled={busy}
                    onClick={() => onToggle(r)}
                  >
                    {offline ? 'Bring online' : 'Take offline'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
