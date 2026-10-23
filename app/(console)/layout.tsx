'use client'

import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { DashboardSkeleton } from '@/components/dashboard/DashboardStates'
import { RequestToasts } from '@/components/RequestToasts'
import { Sidebar } from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toasts'
import { TopBar } from '@/components/TopBar'
import { LiveProvider, useLiveStatus } from '@/lib/liveContext'
import { RequestsProvider, useRequests, waitingCount } from '@/lib/requestsContext'
import { ConsoleGuard, useSession } from '@/lib/session'

const PAGE_TITLES: Record<string, string> = { '/dashboard': 'Dashboard', '/requests': 'Requests' }
const APP_TITLE = 'SmartLib Admin'

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleGuard fallback={<ConsoleSkeleton />}>
      <LiveProvider>
        <ToastProvider>
          <RequestsProvider>
            <ConsoleFrame>{children}</ConsoleFrame>
          </RequestsProvider>
        </ToastProvider>
      </LiveProvider>
    </ConsoleGuard>
  )
}

// The session check is the first request after the API sleeps, so it can take a
// minute: show the shell's outline and the loading skeleton, never a blank page.
function ConsoleSkeleton() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <div style={{ width: 212, flex: 'none', background: 'var(--color-surface)', borderRight: '1px solid var(--color-divider)' }} />
      <div style={{ flex: 1, minWidth: 0, padding: '22px 28px 40px' }}>
        <DashboardSkeleton />
      </div>
    </div>
  )
}

function ConsoleFrame({ children }: { children: ReactNode }) {
  const { user, logOut } = useSession()
  const pathname = usePathname()
  const liveStatus = useLiveStatus()
  const waiting = waitingCount(useRequests().state)

  // The browser tab shows how many requests are waiting.
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) ${APP_TITLE}` : APP_TITLE
    return () => {
      document.title = APP_TITLE
    }
  }, [waiting])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      <RequestToasts />
      <Sidebar userName={user.name} onLogOut={logOut} requestCount={waiting} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TopBar title={PAGE_TITLES[pathname] ?? 'Dashboard'} liveStatus={liveStatus} />
        <main style={{ flex: 1, overflow: 'auto', padding: '22px 28px 40px' }}>{children}</main>
      </div>
    </div>
  )
}
