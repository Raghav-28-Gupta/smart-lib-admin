'use client'

import { useId, useState } from 'react'
import { useWriteAction } from '@/components/useWriteAction'
import { useLiveRefresh } from '@/lib/liveContext'
import { fetchSeatZones, saveZoneFrontLabel, type SeatZone } from '@/lib/resources'
import { useLoader } from '@/lib/useLoader'

const MAX_FRONT_LABEL = 40

function seatCounts({ seats, placed }: SeatZone): string {
  return `${seats} ${seats === 1 ? 'seat' : 'seats'}, ${placed} on the map`
}

/**
 * The Resources page's "Seat map zones" box: one line per zone (a distinct seat location, so a new zone appears the
 * moment a seat is given that location), with the label the student app prints at the front of its map.
 * It loads its own list and refetches on a `resources` live event, which also covers a seat being added or moved.
 */
export function SeatZonesBox() {
  const { state, refresh, retry } = useLoader(fetchSeatZones)
  useLiveRefresh(['resources'], () => void refresh())
  const { busy, run } = useWriteAction(refresh)
  const headingId = useId()

  return (
    <section className="card elev-sm" aria-labelledby={headingId} style={{ marginTop: 24, padding: '14px 16px' }}>
      <h2 id={headingId} className="card-title" style={{ fontSize: 14, margin: 0 }}>Seat map zones</h2>
      {state.kind === 'loading' && <div className="sla-skel" aria-busy="true" aria-label="Loading seat map zones" style={{ height: 22 }} />}
      {state.kind === 'error' && (
        <span className="text-muted" style={{ fontSize: 12.5 }}>
          Couldn&apos;t load the seat map zones.{' '}
          <button type="button" className="sla-link-btn" onClick={retry}>Retry</button>
        </span>
      )}
      {state.kind === 'loaded' &&
        (state.data.length === 0 ? (
          <span className="text-muted" style={{ fontSize: 12.5 }}>Add a seat with a location to make a zone.</span>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {state.data.map((zone) => (
              <ZoneLine
                key={zone.name}
                zone={zone}
                busy={busy}
                onSave={(label) => void run(() => saveZoneFrontLabel(zone.name, label), `Saved the front of ${zone.name}.`)}
              />
            ))}
          </ul>
        ))}
    </section>
  )
}

function ZoneLine({ zone, busy, onSave }: { zone: SeatZone; busy: boolean; onSave: (label: string) => void }) {
  const id = useId()
  const [label, setLabel] = useState(zone.frontLabel ?? '')
  // What the server holds can change under an open box (a save, another librarian): follow it, but only then, so a
  // refetch that changes nothing here leaves a half-typed label alone.
  const [stored, setStored] = useState(zone.frontLabel)
  if (stored !== zone.frontLabel) {
    setStored(zone.frontLabel)
    setLabel(zone.frontLabel ?? '')
  }
  const changed = label.trim() !== (zone.frontLabel ?? '')

  return (
    <li>
      <form
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (changed && !busy) onSave(label)
        }}
      >
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ fontSize: 13.5 }}>{zone.name}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>{seatCounts(zone)}</div>
        </div>
        <div className="field" style={{ flex: '1 1 200px', maxWidth: 280 }}>
          <label htmlFor={`${id}-front`}>Front of room</label>
          <input
            id={`${id}-front`}
            className="input"
            aria-label={`Front of room for ${zone.name}`}
            maxLength={MAX_FRONT_LABEL}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }} disabled={busy || !changed}>
          Save
        </button>
      </form>
    </li>
  )
}
