'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import type { AdminResource, ResourceType } from '@/lib/resources'

export interface ResourceFormValues {
  type: ResourceType
  name: string
  location: string
  capacity: number
}

const MAX_CAPACITY = 100

/**
 * The canvas's add and edit dialogs. With a `resource` it edits: the type is
 * locked after creation, so the field is shown but disabled.
 */
export function ResourceFormDialog({
  resource, onCancel, onSubmit,
}: {
  resource?: AdminResource
  onCancel: () => void
  onSubmit: (values: ResourceFormValues) => void
}) {
  const editing = resource !== undefined
  const [name, setName] = useState(resource?.name ?? '')
  const [type, setType] = useState<ResourceType>(resource?.type ?? 'seat')
  const [location, setLocation] = useState(resource?.location ?? '')
  const [capacity, setCapacity] = useState(String(resource?.capacity ?? 1))
  const id = useId()

  const capacityValue = Number(capacity)
  const capacityValid = capacity.trim() !== '' && Number.isInteger(capacityValue) && capacityValue >= 1 && capacityValue <= MAX_CAPACITY
  const valid = name.trim() !== '' && capacityValid

  return (
    <Dialog title={editing ? 'Edit resource' : 'Add a resource'} onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSubmit({ type, name, location, capacity: capacityValue })
        }}
      >
        {!editing && <div className="dialog-body">New seat or room added to the booking inventory.</div>}
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} className="input" maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-type`}>Type</label>
          <select id={`${id}-type`} className="input" disabled={editing} value={type} onChange={(e) => setType(e.target.value as ResourceType)}>
            <option value="seat">Seat</option>
            <option value="room">Room</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-location`}>Location</label>
          <input id={`${id}-location`} className="input" maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-capacity`}>Capacity</label>
          <input
            id={`${id}-capacity`}
            className="input"
            type="number"
            min={1}
            max={MAX_CAPACITY}
            step={1}
            aria-invalid={!capacityValid}
            aria-describedby={`${id}-capacity-hint`}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
          <div id={`${id}-capacity-hint`} className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            A whole number from 1 to {MAX_CAPACITY}.
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>{editing ? 'Save changes' : 'Add resource'}</button>
        </div>
      </form>
    </Dialog>
  )
}
