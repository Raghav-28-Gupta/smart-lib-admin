import { apiRequest } from './api'

// Response shapes of GET /admin/metrics/* (backend: src/services/adminMetrics.ts).
export interface Utilization {
  today: { date: string; percent: number; lastWeekPercent: number }
  days: { date: string; seatPercent: number; roomPercent: number }[]
}

export interface Circulation {
  borrows: number
  returns: number
  topTitles: { bookId: string; title: string; borrows: number }[]
}

export interface Overdue {
  count: number
  countYesterday: number
}

export interface Demand {
  areas: { area: string; percent: number; busiestSlot: string | null }[]
}

export interface DashboardMetrics {
  utilization: Utilization
  circulation: Circulation
  overdue: Overdue
  demand: Demand
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const [utilization, circulation, overdue, demand] = await Promise.all([
    apiRequest<Utilization>('/admin/metrics/utilization'),
    apiRequest<Circulation>('/admin/metrics/circulation'),
    apiRequest<Overdue>('/admin/metrics/overdue'),
    apiRequest<Demand>('/admin/metrics/demand'),
  ])
  return { utilization, circulation, overdue, demand }
}

/** No bookings in the 7 days, no borrows or returns, and nothing overdue. */
export function isEmpty(m: DashboardMetrics): boolean {
  return (
    m.utilization.days.every((d) => d.seatPercent === 0 && d.roomPercent === 0) &&
    m.circulation.borrows === 0 &&
    m.circulation.returns === 0 &&
    m.overdue.count === 0
  )
}
