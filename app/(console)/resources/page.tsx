'use client'

import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { OfflineDialog } from '@/components/resources/OfflineDialog'
import { OnlineDialog } from '@/components/resources/OnlineDialog'
import { ResourceFormDialog } from '@/components/resources/ResourceFormDialog'
import { ResourcesEmpty, ResourcesError, ResourcesFilterEmpty, ResourcesSkeleton } from '@/components/resources/ResourcesStates'
import { ResourcesTable } from '@/components/resources/ResourcesTable'
import { useResourceActions } from '@/components/resources/useResourceActions'
import { useLiveRefresh } from '@/lib/liveContext'
import { fetchResources, type AdminResource, type ResourceType } from '@/lib/resources'
import { useLoader } from '@/lib/useLoader'

type Filter = 'all' | ResourceType
type OpenDialog = null | { kind: 'add' } | { kind: 'edit' | 'offline' | 'online'; resource: AdminResource }

// Module-level, so the loader sees the same fetcher on every render.
const loadResources = () => fetchResources()

export default function ResourcesPage() {
  const { state, refresh, retry } = useLoader(loadResources)
  const [filter, setFilter] = useState<Filter>('all')
  const [dialog, setDialog] = useState<OpenDialog>(null)

  useLiveRefresh(['resources'], () => void refresh())

  const actions = useResourceActions(refresh)
  const close = useCallback(() => setDialog(null), [])

  const resources = state.kind === 'loaded' ? state.data : []
  const shown = filter === 'all' ? resources : resources.filter((r) => r.type === filter)

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="input"
          aria-label="Filter by type"
          style={{ maxWidth: 150 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          <option value="all">All types</option>
          <option value="seat">Seats</option>
          <option value="room">Rooms</option>
        </select>
        <span className="text-muted" style={{ fontSize: 12, flex: 1 }}>
          {state.kind === 'loaded' ? `${shown.length} of ${resources.length} resources` : ''}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '8px 14px', fontSize: 13 }}
          disabled={actions.busy}
          onClick={() => setDialog({ kind: 'add' })}
        >
          <Plus size={14} strokeWidth={2.75} aria-hidden="true" style={{ marginRight: 5, verticalAlign: -2 }} />
          Add resource
        </button>
      </div>

      {state.kind === 'loading' ? (
        <ResourcesSkeleton />
      ) : state.kind === 'error' ? (
        <ResourcesError onRetry={retry} />
      ) : resources.length === 0 ? (
        <ResourcesEmpty />
      ) : shown.length === 0 ? (
        <ResourcesFilterEmpty onClear={() => setFilter('all')} />
      ) : (
        <ResourcesTable
          resources={shown}
          busy={actions.busy}
          onEdit={(resource) => setDialog({ kind: 'edit', resource })}
          onToggle={(resource) => setDialog({ kind: resource.status === 'available' ? 'offline' : 'online', resource })}
        />
      )}

      {dialog?.kind === 'add' && (
        <ResourceFormDialog
          onCancel={close}
          onSubmit={(values) => {
            close()
            void actions.create(values)
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <ResourceFormDialog
          resource={dialog.resource}
          onCancel={close}
          onSubmit={({ name, location, capacity }) => {
            close()
            void actions.update(dialog.resource, { name, location, capacity })
          }}
        />
      )}
      {dialog?.kind === 'offline' && (
        <OfflineDialog
          resource={dialog.resource}
          onCancel={close}
          onConfirm={(note) => {
            close()
            void actions.takeOffline(dialog.resource, note)
          }}
        />
      )}
      {dialog?.kind === 'online' && (
        <OnlineDialog
          resource={dialog.resource}
          onCancel={close}
          onConfirm={() => {
            close()
            void actions.bringOnline(dialog.resource)
          }}
        />
      )}
    </>
  )
}
