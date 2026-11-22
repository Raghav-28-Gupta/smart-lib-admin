'use client'

import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { DashboardSkeleton } from '@/components/dashboard/DashboardStates'
import { RequestToasts } from '@/components/RequestToasts'
import { Sidebar } from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toasts'
import { TopBar } from '@/components/TopBar'
import { AttentionProvider, attentionCount, useAttention } from '@/lib/attentionContext'
import { LiveProvider, useLiveStatus } from '@/lib/liveContext'
import { PageTitleProvider, usePageChrome } from '@/lib/pageTitle'
import { RequestsProvider, useRequests, waitingCount } from '@/lib/requestsContext'
import { ConsoleGuard, useSession } from '@/lib/session'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard', '/requests': 'Requests', '/bookings': 'Bookings', '/catalogue': 'Catalogue', '/resources': 'Resources',
  '/fines': 'Fines', '/attention': 'Needs attention',
}
const APP_TITLE = 'SmartLib Admin'

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleGuard fallback={<ConsoleSkeleton />}>
      <LiveProvider>
        <ToastProvider>
          <RequestsProvider>
            <AttentionProvider>
              <PageTitleProvider>
                <ConsoleFrame>{children}</ConsoleFrame>
              </PageTitleProvider>
            </AttentionProvider>
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
  // A page the path cannot title (the student page) sets its own title and the sidebar section to keep highlighted.
  const { title, activeHref } = usePageChrome()
  const liveStatus = useLiveStatus()
  const waiting = waitingCount(useRequests().state)
  const needAttention = attentionCount(useAttention().state)

  // The browser tab shows how many requests are waiting. Next re-applies the
  // page's own <title> when you navigate, so the title is put back whenever it changes.
  useEffect(() => {
    const title = waiting > 0 ? `(${waiting}) ${APP_TITLE}` : APP_TITLE
    const apply = () => {
      if (document.title !== title) document.title = title
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, characterData: true, subtree: true })
    return () => {
      observer.disconnect()
      document.title = APP_TITLE
    }
  }, [waiting])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      <RequestToasts />
      <Sidebar userName={user.name} onLogOut={logOut} requestCount={waiting} attentionCount={needAttention} activeHref={activeHref} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TopBar title={title ?? PAGE_TITLES[pathname] ?? 'Dashboard'} liveStatus={liveStatus} />
        <main style={{ flex: 1, overflow: 'auto', padding: '22px 28px 40px' }}>{children}</main>
      </div>
    </div>
  )
}
