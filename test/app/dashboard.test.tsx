import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import DashboardPage from '@/app/(console)/dashboard/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { DashboardMetrics } from '@/lib/metrics'
import type { PendingRequest, PendingRequests } from '@/lib/requests'
import { RequestsProvider } from '@/lib/requestsContext'
import { json, mockFetch } from '../helpers'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

const METRICS: DashboardMetrics = {
  utilization: {
    today: { date: '2026-10-15', percent: 74, lastWeekPercent: 68 },
    days: [
      { date: '2026-10-09', seatPercent: 62, roomPercent: 58 },
      { date: '2026-10-10', seatPercent: 70, roomPercent: 64 },
      { date: '2026-10-11', seatPercent: 75, roomPercent: 80 },
      { date: '2026-10-12', seatPercent: 68, roomPercent: 72 },
      { date: '2026-10-13', seatPercent: 80, roomPercent: 88 },
      { date: '2026-10-14', seatPercent: 54, roomPercent: 40 },
      { date: '2026-10-15', seatPercent: 48, roomPercent: 35 },
    ],
  },
  circulation: {
    borrows: 142,
    returns: 118,
    topTitles: [
      { bookId: 'b1', title: 'Introduction to Algorithms', borrows: 23 },
      { bookId: 'b8', title: 'Clean Code', borrows: 19 },
    ],
  },
  overdue: { count: 9, countYesterday: 7 },
  demand: {
    areas: [
      { area: 'Group study rooms', percent: 92, busiestSlot: '2:00 PM' },
      { area: 'Silent Zone', percent: 68, busiestSlot: '10:00 AM' },
    ],
  },
}

const EMPTY: DashboardMetrics = {
  utilization: { today: { date: '2026-10-15', percent: 0, lastWeekPercent: 0 }, days: METRICS.utilization.days.map((d) => ({ ...d, seatPercent: 0, roomPercent: 0 })) },
  circulation: { borrows: 0, returns: 0, topTitles: [] },
  overdue: { count: 0, countYesterday: 0 },
  demand: { areas: [{ area: 'Silent Zone', percent: 0, busiestSlot: null }] },
}

const NONE: PendingRequests = { requests: [], counts: { all: 0, borrow: 0, room: 0 } }

function renderDashboard() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <RequestsProvider>
          <DashboardPage />
        </RequestsProvider>
      </ToastProvider>
    </LiveProvider>,
  )
}

function serve(m: DashboardMetrics, status = 200, requests: PendingRequests = NONE) {
  const reply = (body: unknown) => () => (status === 200 ? json(200, body) : json(status, { error: 'Something went wrong.' }))
  return mockFetch({
    'GET /admin/metrics/utilization': reply(m.utilization),
    'GET /admin/metrics/circulation': reply(m.circulation),
    'GET /admin/metrics/overdue': reply(m.overdue),
    'GET /admin/metrics/demand': reply(m.demand),
    'GET /admin/requests': () => json(200, requests),
  })
}

describe('Dashboard', () => {
  it('shows the loading skeleton while the metrics load', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderDashboard()
    expect(screen.getByLabelText('Loading dashboard metrics')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows all four metrics', async () => {
    serve(METRICS)
    renderDashboard()
    expect(await screen.findByText('74%')).toBeInTheDocument()
    expect(screen.getByText('+6 pts vs last week')).toBeInTheDocument()
    expect(screen.getByText('142 / 118')).toBeInTheDocument()
    expect(screen.getByText('Borrows / returns')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('+2 since yesterday')).toBeInTheDocument()
    expect(screen.getAllByText('Group study rooms')).toHaveLength(2) // Peak demand card and the demand list
    expect(screen.getByText('92% booked, 2–3 PM busiest')).toBeInTheDocument()
    expect(screen.getByText('Seat & room utilisation, last 7 days')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Tue: seats 80%, rooms 88%' })).toBeInTheDocument()
    expect(screen.getByText('Top titles, last 7 days')).toBeInTheDocument()
    expect(screen.getByText('Introduction to Algorithms')).toBeInTheDocument()
    expect(screen.getByText('Resource demand, last 7 days')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
  })

  it('offers Retry after a failure, and loads when retried', async () => {
    serve(METRICS, 500)
    renderDashboard()
    expect(await screen.findByText("Couldn't load dashboard metrics")).toBeInTheDocument()
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument()
    serve(METRICS)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('74%')).toBeInTheDocument()
  })

  it('shows the empty state before any activity', async () => {
    serve(EMPTY)
    renderDashboard()
    expect(await screen.findByText('No activity recorded yet')).toBeInTheDocument()
    expect(
      screen.getByText('Utilisation, circulation and demand metrics will appear here once bookings and loans start coming in.'),
    ).toBeInTheDocument()
  })

  it('copes with no busiest slot and with no resources at all', async () => {
    serve({ ...METRICS, demand: { areas: [{ area: 'Silent Zone', percent: 5, busiestSlot: null }] } })
    const { unmount } = renderDashboard()
    expect(await screen.findByText('5% booked')).toBeInTheDocument()
    unmount()
    serve({ ...METRICS, demand: { areas: [] } })
    renderDashboard()
    expect(await screen.findByText('No resources yet')).toBeInTheDocument()
  })

  it('leaves an ended session to the session guard instead of showing an error', async () => {
    const fetch = serve(METRICS, 401)
    renderDashboard()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5))
    expect(screen.queryByText("Couldn't load dashboard metrics")).toBeNull()
  })

  it('lists the three oldest waiting requests, with View all', async () => {
    const asking = (id: string, name: string, minutes: number): PendingRequest => ({
      id,
      kind: 'borrow',
      student: { id: `u-${id}`, name, email: `${id}@thapar.edu` },
      requestedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 1, totalCopies: 4 },
    })
    serve(METRICS, 200, {
      requests: [asking('1', 'Aditi Sharma', 40), asking('2', 'Rohan Verma', 30), asking('3', 'Priya Nair', 20), asking('4', 'Karan Mehta', 10)],
      counts: { all: 4, borrow: 4, room: 0 },
    })
    renderDashboard()
    expect(await screen.findByText('Waiting for approval (4)')).toBeInTheDocument()
    expect(screen.getByText('Aditi Sharma · Clean Code')).toBeInTheDocument()
    expect(screen.getByText('Priya Nair · Clean Code')).toBeInTheDocument()
    expect(screen.queryByText('Karan Mehta · Clean Code')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/requests')
  })

  it('says when no requests are waiting', async () => {
    serve(METRICS)
    renderDashboard()
    expect(await screen.findByText('No requests waiting.')).toBeInTheDocument()
  })

  it('refreshes the numbers on a metrics event without the skeleton', async () => {
    let round = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch({
      'GET /admin/metrics/utilization': async () => {
        const n = ++round
        if (n > 1) await gate
        return json(200, { ...METRICS.utilization, today: { ...METRICS.utilization.today, percent: n === 1 ? 74 : 80 } })
      },
      'GET /admin/metrics/circulation': () => json(200, METRICS.circulation),
      'GET /admin/metrics/overdue': () => json(200, METRICS.overdue),
      'GET /admin/metrics/demand': () => json(200, METRICS.demand),
      'GET /admin/requests': () => json(200, NONE),
    })
    renderDashboard()
    expect(await screen.findByText('74%')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] }))
    // The refetch has started (after the 1 s debounce) and is still pending:
    // the old numbers stay on screen and there is no skeleton.
    await waitFor(() => expect(round).toBe(2), { timeout: 2_000 })
    expect(screen.queryByLabelText('Loading dashboard metrics')).toBeNull()
    expect(screen.getByText('74%')).toBeInTheDocument()

    release()
    expect(await screen.findByText('80%')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading dashboard metrics')).toBeNull()
  })

  it('keeps the numbers on screen when a live refresh fails', async () => {
    let round = 0
    mockFetch({
      'GET /admin/metrics/utilization': () => (++round === 1 ? json(200, METRICS.utilization) : json(500, { error: 'x' })),
      'GET /admin/metrics/circulation': () => json(200, METRICS.circulation),
      'GET /admin/metrics/overdue': () => json(200, METRICS.overdue),
      'GET /admin/metrics/demand': () => json(200, METRICS.demand),
      'GET /admin/requests': () => json(200, NONE),
    })
    renderDashboard()
    expect(await screen.findByText('74%')).toBeInTheDocument()

    act(() => live.handlers!.onEvent({ type: 'activity', topics: ['metrics'] }))
    await waitFor(() => expect(round).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('74%')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load dashboard metrics")).toBeNull()
  })
})
