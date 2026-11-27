'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import type { AdminResource, ResourceType } from '@/lib/resources'

export interface ResourceFormValues {
  type: ResourceType
  name: string
  location: string
  capacity: number
  /** Both a whole number from 1 to 50, or both null (a seat off the map, and always a room). */
  row: number | null
  column: number | null
}

const MAX_CAPACITY = 100
const MAX_POSITION = 50

type Part = number | 'empty' | 'invalid'

/** One of the Row and Column boxes: empty, a whole number from 1 to 50, or something else. */
function readPart(text: string): Part {
  if (text.trim() === '') return 'empty'
  const value = Number(text)
  return Number.isInteger(value) && value >= 1 && value <= MAX_POSITION ? value : 'invalid'
}

/**
 * Why a seat's position cannot be saved, in the server's own words and order (the server checks the seat as it will be
 * after the write), or null. The clash is looked up in `otherSeats`, so a librarian sees it before sending: the console's
 * write path closes the dialog and toasts a 409, which would throw away what was typed.
 */
function positionProblem(row: Part, column: Part, location: string, otherSeats: AdminResource[]): string | null {
  if (row === 'invalid' || column === 'invalid') return `Row and column are whole numbers from 1 to ${MAX_POSITION}.`
  if (row === 'empty' && column === 'empty') return null
  if (row === 'empty' || column === 'empty') return 'Enter both row and column, or leave both empty.'
  const zone = location.trim()
  if (zone === '') return 'A seat on the map needs a location: its zone.'
  // A zone is its location's exact text, and an offline seat still holds its spot.
  const holder = otherSeats.find((s) => s.type === 'seat' && s.location === zone && s.row === row && s.column === column)
  return holder ? `Row ${row}, column ${column} in ${zone} is already taken by ${holder.name}.` : null
}

/**
 * The canvas's add and edit dialogs. With a `resource` it edits: the type is
 * locked after creation, so the field is shown but disabled. Row and Column are for
 * a seat's place on the seat map; `otherSeats` is every seat but the one being edited.
 */
export function ResourceFormDialog({
  resource, otherSeats, onCancel, onSubmit,
}: {
  resource?: AdminResource
  otherSeats: AdminResource[]
  onCancel: () => void
  onSubmit: (values: ResourceFormValues) => void
}) {
  const editing = resource !== undefined
  const [name, setName] = useState(resource?.name ?? '')
  const [type, setType] = useState<ResourceType>(resource?.type ?? 'seat')
  const [location, setLocation] = useState(resource?.location ?? '')
  const [capacity, setCapacity] = useState(String(resource?.capacity ?? 1))
  const [row, setRow] = useState(String(resource?.row ?? ''))
  const [column, setColumn] = useState(String(resource?.column ?? ''))
  const id = useId()

  const capacityValue = Number(capacity)
  const capacityValid = capacity.trim() !== '' && Number.isInteger(capacityValue) && capacityValue >= 1 && capacityValue <= MAX_CAPACITY

  const isSeat = type === 'seat'
  const rowPart = readPart(row)
  const columnPart = readPart(column)
  const problem = isSeat ? positionProblem(rowPart, columnPart, location, otherSeats) : null
  // A room has no position, whatever was typed before the type was switched.
  const placement = isSeat && typeof rowPart === 'number' && typeof columnPart === 'number' ? { row: rowPart, column: columnPart } : null

  const valid = name.trim() !== '' && capacityValid && problem === null

  return (
    <Dialog title={editing ? 'Edit resource' : 'Add a resource'} onCancel={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSubmit({ type, name, location, capacity: capacityValue, row: placement?.row ?? null, column: placement?.column ?? null })
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
        {isSeat && (
          <div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor={`${id}-row`}>Row</label>
                <input
                  id={`${id}-row`}
                  className="input"
                  type="number"
                  min={1}
                  max={MAX_POSITION}
                  step={1}
                  aria-invalid={problem !== null}
                  aria-describedby={`${id}-position-hint`}
                  value={row}
                  onChange={(e) => setRow(e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor={`${id}-column`}>Column</label>
                <input
                  id={`${id}-column`}
                  className="input"
                  type="number"
                  min={1}
                  max={MAX_POSITION}
                  step={1}
                  aria-invalid={problem !== null}
                  aria-describedby={`${id}-position-hint`}
                  value={column}
                  onChange={(e) => setColumn(e.target.value)}
                />
              </div>
            </div>
            <div id={`${id}-position-hint`} className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              Both empty keeps this seat off the map.
            </div>
            {problem && (
              <div role="alert" style={{ fontSize: 11.5, marginTop: 4, color: 'var(--color-accent-800)' }}>{problem}</div>
            )}
          </div>
        )}
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
