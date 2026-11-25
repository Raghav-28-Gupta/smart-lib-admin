'use client'

import { useEffect, useState } from 'react'
import { RequestCard } from '@/components/requests/RequestCard'
import { FilterEmpty, RequestsEmpty, RequestsError, RequestsSkeleton } from '@/components/requests/RequestsStates'
import type { RequestKind } from '@/lib/requests'
import { useRequests } from '@/lib/requestsContext'

type Filter = 'all' | RequestKind

export default function RequestsPage() {
  const { state, retry, order, setOrder } = useRequests()
  const [filter, setFilter] = useState<Filter>('all')

  // The toggle lives only while this page is open: the badge and the Dashboard read the same list, so leaving
  // puts them back on the suggested order (a refetch only when the toggle was on).
  useEffect(() => () => setOrder('suggested'), [setOrder])

  if (state.kind === 'loading') return <RequestsSkeleton />
  if (state.kind === 'error') return <RequestsError onRetry={retry} />

  const { requests, counts } = state.data
  const shown = filter === 'all' ? requests : requests.filter((r) => r.kind === filter)
  const chips: { value: Filter; label: string }[] = [
    { value: 'all', label: `All (${counts.all})` },
    { value: 'borrow', label: `Borrows (${counts.borrow})` },
    { value: 'room', label: `Rooms (${counts.room})` },
  ]

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`tag sla-chip ${filter === chip.value ? 'tag-accent' : 'tag-neutral'}`}
            aria-pressed={filter === chip.value}
            onClick={() => setFilter(chip.value)}
          >
            {chip.label}
          </button>
        ))}
        <label htmlFor="requests-by-time" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
          <input id="requests-by-time" type="checkbox" checked={order === 'request'} onChange={(e) => setOrder(e.target.checked ? 'request' : 'suggested')} />
          By request time
        </label>
      </div>
      {requests.length === 0 ? (
        <RequestsEmpty />
      ) : shown.length === 0 ? (
        <FilterEmpty kind={filter === 'room' ? 'room' : 'borrow'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((r) => <RequestCard key={`${r.kind}:${r.id}`} request={r} showOrderNote={order !== 'request'} />)}
        </div>
      )}
    </>
  )
}
