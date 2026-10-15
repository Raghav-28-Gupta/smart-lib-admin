import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DashboardPage from '@/app/(console)/dashboard/page'
import type { DashboardMetrics } from '@/lib/metrics'
import { json, mockFetch } from '../helpers'

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

function serve(m: DashboardMetrics, status = 200) {
  const reply = (body: unknown) => () => (status === 200 ? json(200, body) : json(status, { error: 'Something went wrong.' }))
  return mockFetch({
    'GET /admin/metrics/utilization': reply(m.utilization),
    'GET /admin/metrics/circulation': reply(m.circulation),
    'GET /admin/metrics/overdue': reply(m.overdue),
    'GET /admin/metrics/demand': reply(m.demand),
  })
}

describe('Dashboard', () => {
  it('shows the loading skeleton while the metrics load', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    render(<DashboardPage />)
    expect(screen.getByLabelText('Loading dashboard metrics')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows all four metrics', async () => {
    serve(METRICS)
    render(<DashboardPage />)
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
    render(<DashboardPage />)
    expect(await screen.findByText("Couldn't load dashboard metrics")).toBeInTheDocument()
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument()
    serve(METRICS)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('74%')).toBeInTheDocument()
  })

  it('shows the empty state before any activity', async () => {
    serve(EMPTY)
    render(<DashboardPage />)
    expect(await screen.findByText('No activity recorded yet')).toBeInTheDocument()
    expect(
      screen.getByText('Utilisation, circulation and demand metrics will appear here once bookings and loans start coming in.'),
    ).toBeInTheDocument()
  })

  it('copes with no busiest slot and with no resources at all', async () => {
    serve({ ...METRICS, demand: { areas: [{ area: 'Silent Zone', percent: 5, busiestSlot: null }] } })
    const { unmount } = render(<DashboardPage />)
    expect(await screen.findByText('5% booked')).toBeInTheDocument()
    unmount()
    serve({ ...METRICS, demand: { areas: [] } })
    render(<DashboardPage />)
    expect(await screen.findByText('No resources yet')).toBeInTheDocument()
  })

  it('leaves an ended session to the session guard instead of showing an error', async () => {
    const fetch = serve(METRICS, 401)
    render(<DashboardPage />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    expect(screen.queryByText("Couldn't load dashboard metrics")).toBeNull()
  })
})
