'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardEmpty, DashboardError, DashboardSkeleton } from '@/components/dashboard/DashboardStates'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ApiError } from '@/lib/api'
import { fetchDashboardMetrics, isEmpty, type DashboardMetrics } from '@/lib/metrics'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; metrics: DashboardMetrics }

export default function DashboardPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(() => {
    setState({ kind: 'loading' })
    fetchDashboardMetrics()
      .then((metrics) => setState({ kind: 'loaded', metrics }))
      .catch((error: unknown) => {
        // A 401 or 403 ended the session; ConsoleGuard is already redirecting.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return
        setState({ kind: 'error' })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (state.kind === 'loading') return <DashboardSkeleton />
  if (state.kind === 'error') return <DashboardError onRetry={load} />
  return isEmpty(state.metrics) ? <DashboardEmpty /> : <DashboardView metrics={state.metrics} />
}
