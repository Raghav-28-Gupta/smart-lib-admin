'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardEmpty, DashboardError, DashboardSkeleton } from '@/components/dashboard/DashboardStates'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { WaitingPanel } from '@/components/dashboard/WaitingPanel'
import { ApiError } from '@/lib/api'
import { useLiveRefresh } from '@/lib/liveContext'
import { fetchDashboardMetrics, isEmpty, type DashboardMetrics } from '@/lib/metrics'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; metrics: DashboardMetrics }

export default function DashboardPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  // `quiet` is a live refresh: no skeleton, and a failure keeps the numbers on screen.
  const load = useCallback((quiet = false) => {
    if (!quiet) setState({ kind: 'loading' })
    fetchDashboardMetrics()
      .then((metrics) => setState({ kind: 'loaded', metrics }))
      .catch((error: unknown) => {
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
        if (!quiet) setState({ kind: 'error' })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useLiveRefresh(['metrics'], () => load(true))

  return (
    <>
      <WaitingPanel />
      {state.kind === 'loading' ? (
        <DashboardSkeleton />
      ) : state.kind === 'error' ? (
        <DashboardError onRetry={() => load()} />
      ) : isEmpty(state.metrics) ? (
        <DashboardEmpty />
      ) : (
        <DashboardView metrics={state.metrics} />
      )}
    </>
  )
}
