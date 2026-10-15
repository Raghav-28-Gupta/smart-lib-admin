'use client'

import { BookOpen, Calendar, DoorOpen, LayoutDashboard, Wallet, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { initials } from '@/lib/format'

interface Section {
  label: string
  icon: LucideIcon
  /** Absent until the section is built (slices 2 and 3). */
  href?: string
}

// "Needs attention" is deferred with no slice, so it is left out entirely.
const SECTIONS: Section[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Bookings', icon: Calendar },
  { label: 'Catalogue', icon: BookOpen },
  { label: 'Resources', icon: DoorOpen },
  { label: 'Fines', icon: Wallet },
]

export function Sidebar({ userName, onLogOut }: { userName: string; onLogOut: () => void }) {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Console"
      style={{
        width: 212, flex: 'none', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column',
        padding: '18px 12px', gap: 2, position: 'sticky', top: 0, height: '100vh', boxSizing: 'border-box',
        borderRight: '1px solid var(--color-divider)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 16px' }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--color-accent-2-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <BookOpen size={15} strokeWidth={2.75} color="var(--color-accent-2-800)" aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, lineHeight: 1.1 }}>SmartLib</div>
          <div style={{ fontSize: 10.5, opacity: 0.55 }}>Admin console</div>
        </div>
      </div>

      {SECTIONS.map(({ label, icon: Icon, href }) => {
        if (!href) {
          return (
            <button key={label} type="button" className="sla-nav-btn" disabled style={{ background: 'transparent', color: 'var(--color-text)' }}>
              <Icon size={17} strokeWidth={2.75} aria-hidden="true" />
              {/* The tag sits under the label: beside it, it overflows the 212px sidebar. */}
              <span className="sla-nav-text">
                <span>{label}</span>
                <span className="sla-soon">Coming soon</span>
              </span>
            </button>
          )
        }
        const active = pathname === href
        return (
          <Link
            key={label}
            href={href}
            className="sla-nav-btn"
            aria-current={active ? 'page' : undefined}
            style={{
              background: active ? 'var(--color-accent-100)' : 'transparent',
              color: active ? 'var(--color-accent-800)' : 'var(--color-text)',
              textDecoration: 'none',
            }}
          >
            <Icon size={17} strokeWidth={2.75} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        )
      })}

      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', borderTop: '1px solid var(--color-divider)', marginTop: 8 }}>
        <div
          aria-hidden="true"
          style={{
            width: 28, height: 28, borderRadius: '50%', background: 'var(--color-accent-100)', color: 'var(--color-accent-800)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontSize: 11, flex: 'none',
          }}
        >
          {initials(userName)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
          <div style={{ fontSize: 10.5, opacity: 0.55 }}>Librarian admin</div>
          <button type="button" className="sla-link-btn" onClick={onLogOut}>Log out</button>
        </div>
      </div>
    </nav>
  )
}
