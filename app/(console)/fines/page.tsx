'use client'

import { useCallback, useState } from 'react'
import { AdjustFineDialog } from '@/components/fines/AdjustFineDialog'
import { FinesTable } from '@/components/fines/FinesTable'
import { FinesEmpty, FinesError, FinesFilterEmpty, FinesSkeleton } from '@/components/fines/FinesStates'
import { MarkPaidDialog } from '@/components/fines/MarkPaidDialog'
import { useFineActions } from '@/components/fines/useFineActions'
import { Pager } from '@/components/Pager'
import { FINE_STATUS_FILTERS, fetchFines, type AdminFine, type FinesPage as FinesResponse, type FineStatus } from '@/lib/fines'
import { pageRange } from '@/lib/format'
import { useLiveRefresh } from '@/lib/liveContext'
import { useListQuery } from '@/lib/useListQuery'

type OpenDialog = null | { kind: 'paid' | 'adjust'; fine: AdminFine }

export default function FinesPage() {
  const { state, data, refresh, retry, searchInput, setSearchInput, status, setStatus, setPage, pastEnd, filtered, clearFilters } =
    useListQuery<FinesResponse, FineStatus>(fetchFines, (reply) => reply.fines.length)
  useLiveRefresh(['fines'], () => void refresh())

  const [dialog, setDialog] = useState<OpenDialog>(null)
  const actions = useFineActions(refresh)
  const close = useCallback(() => setDialog(null), [])

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          aria-label="Search fines"
          placeholder="Search student"
          maxLength={100}
          style={{ maxWidth: 220 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className="input"
          aria-label="Filter by status"
          style={{ maxWidth: 160 }}
          value={status}
          onChange={(e) => setStatus(e.target.value as FineStatus | 'all')}
        >
          {FINE_STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {data && !pastEnd ? pageRange(data.page, data.pageSize, data.total, ['fine', 'fines']) : ''}
        </span>
      </div>

      {state.kind === 'loading' || pastEnd ? (
        <FinesSkeleton />
      ) : state.kind === 'error' ? (
        <FinesError onRetry={retry} />
      ) : state.data.fines.length === 0 ? (
        filtered ? <FinesFilterEmpty onClear={clearFilters} /> : <FinesEmpty />
      ) : (
        <>
          <FinesTable
            fines={state.data.fines}
            busy={actions.busy}
            onMarkPaid={(fine) => setDialog({ kind: 'paid', fine })}
            onAdjust={(fine) => setDialog({ kind: 'adjust', fine })}
          />
          <Pager page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onPage={setPage} />
        </>
      )}

      {dialog?.kind === 'paid' && (
        <MarkPaidDialog
          fine={dialog.fine}
          onCancel={close}
          onConfirm={() => {
            close()
            void actions.markPaid(dialog.fine)
          }}
        />
      )}
      {dialog?.kind === 'adjust' && (
        <AdjustFineDialog
          fine={dialog.fine}
          onCancel={close}
          onConfirm={(amount, reason) => {
            close()
            void actions.adjust(dialog.fine, amount, reason)
          }}
        />
      )}
    </>
  )
}
