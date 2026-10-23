'use client'

import { useState } from 'react'
import { waitingLabel } from '@/lib/format'
import type { PendingRequest } from '@/lib/requests'
import { useNow } from '@/lib/useNow'
import { DeclineDialog } from './DeclineDialog'
import { requestDetail, requestTitle } from './requestText'
import { useDecision } from './useDecision'

/** One request on the Requests page, in the canvas's "Needs attention" card layout. */
export function RequestCard({ request }: { request: PendingRequest }) {
  const now = useNow()
  const { busy, approve, decline } = useDecision(request)
  const [declining, setDeclining] = useState(false)
  const borrow = request.kind === 'borrow'

  return (
    <div className="card elev-sm" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`tag ${borrow ? 'tag-accent' : 'tag-accent-2'}`}>{borrow ? 'Borrow request' : 'Room request'}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{request.student.name}</span>
          <span className="text-muted" style={{ fontSize: 11.5 }}>waiting {waitingLabel(now - Date.parse(request.requestedAt))}</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{requestTitle(request)}</div>
        <div className="text-muted" style={{ fontSize: 12.5 }}>{requestDetail(request, now)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none', minWidth: 150 }}>
        <button type="button" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={busy} onClick={() => void approve()}>
          Approve
        </button>
        <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={busy} onClick={() => setDeclining(true)}>
          Decline
        </button>
      </div>
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
    </div>
  )
}
