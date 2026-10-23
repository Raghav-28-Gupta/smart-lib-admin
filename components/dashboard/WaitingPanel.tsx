'use client'

import Link from 'next/link'
import { useState } from 'react'
import { DeclineDialog } from '@/components/requests/DeclineDialog'
import { requestRow } from '@/components/requests/requestText'
import { useDecision } from '@/components/requests/useDecision'
import { waitingLabel } from '@/lib/format'
import type { PendingRequest } from '@/lib/requests'
import { useRequests } from '@/lib/requestsContext'
import { useNow } from '@/lib/useNow'

const SHOWN = 3

/** The Dashboard's "Waiting for approval" card: the oldest requests, decided in place. */
export function WaitingPanel() {
  const { state, retry } = useRequests()
  const count = state.kind === 'loaded' ? state.data.counts.all : 0
  return (
    <section className="card elev-sm" aria-labelledby="waiting-title" style={{ padding: '14px 16px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span id="waiting-title" className="card-title" style={{ fontSize: 14 }}>
          Waiting for approval ({count})
        </span>
        <Link href="/requests" style={{ fontSize: 12.5 }}>View all</Link>
      </div>
      {state.kind === 'loading' && <div className="sla-skel" aria-busy="true" aria-label="Loading requests" style={{ height: 22 }} />}
      {state.kind === 'error' && (
        <span className="text-muted" style={{ fontSize: 12.5 }}>
          Couldn&apos;t load requests.{' '}
          <button type="button" className="sla-link-btn" onClick={retry}>Retry</button>
        </span>
      )}
      {state.kind === 'loaded' &&
        (state.data.requests.length === 0 ? (
          <span className="text-muted" style={{ fontSize: 12.5 }}>No requests waiting.</span>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {state.data.requests.slice(0, SHOWN).map((r) => (
              <WaitingRow key={`${r.kind}:${r.id}`} request={r} />
            ))}
          </ul>
        ))}
    </section>
  )
}

function WaitingRow({ request }: { request: PendingRequest }) {
  const now = useNow()
  const { busy, approve, decline } = useDecision(request)
  const [declining, setDeclining] = useState(false)
  const borrow = request.kind === 'borrow'
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--color-divider)' }}>
      <span className={`tag ${borrow ? 'tag-accent' : 'tag-accent-2'}`} style={{ flex: 'none' }}>{borrow ? 'Borrow' : 'Room'}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {requestRow(request)}
      </span>
      <span className="text-muted" style={{ fontSize: 11.5, flex: 'none' }}>{waitingLabel(now - Date.parse(request.requestedAt))}</span>
      <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12, flex: 'none' }} disabled={busy} onClick={() => void approve()}>
        Approve
      </button>
      <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, flex: 'none' }} disabled={busy} onClick={() => setDeclining(true)}>
        Decline
      </button>
      {declining && (
        <DeclineDialog
          request={request}
          onCancel={() => setDeclining(false)}
          onConfirm={(reason) => {
            setDeclining(false)
            void decline(reason)
          }}
        />
      )}
    </li>
  )
}
