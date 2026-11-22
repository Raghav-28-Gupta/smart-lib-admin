import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const renderSidebar = (onLogOut = vi.fn(), requestCount = 0, attentionCount?: number) => {
  render(<Sidebar userName="Librarian One" onLogOut={onLogOut} requestCount={requestCount} attentionCount={attentionCount} />)
  return onLogOut
}

describe('Sidebar', () => {
  it('marks the Dashboard as the current page', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('activeHref overrides the path: a page outside the sections can keep one highlighted', () => {
    render(<Sidebar userName="Librarian One" onLogOut={vi.fn()} requestCount={0} activeHref="/fines" />)
    expect(screen.getByRole('link', { name: 'Fines' })).toHaveAttribute('aria-current', 'page')
    // The current path is /dashboard, but the override wins: only one section is current.
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('without activeHref, or with null, it follows the path', () => {
    const { rerender } = render(<Sidebar userName="Librarian One" onLogOut={vi.fn()} requestCount={0} activeHref={null} />)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    rerender(<Sidebar userName="Librarian One" onLogOut={vi.fn()} requestCount={0} activeHref={undefined} />)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('links to Requests with the number waiting', () => {
    renderSidebar(vi.fn(), 3)
    const link = screen.getByRole('link', { name: /Requests/ })
    expect(link).toHaveAttribute('href', '/requests')
    expect(link).toHaveTextContent('3')
  })

  it('shows no count when nothing is waiting', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Requests' })).toBeInTheDocument()
  })

  it('Sidebar: every section is a link, none says Coming soon', () => {
    renderSidebar()
    const sections = {
      Dashboard: '/dashboard', Requests: '/requests', 'Needs attention': '/attention', Bookings: '/bookings', Catalogue: '/catalogue',
      Resources: '/resources', Fines: '/fines',
    }
    for (const [label, href] of Object.entries(sections)) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
      expect(screen.queryByRole('button', { name: new RegExp(label) })).toBeNull()
    }
    expect(screen.getAllByRole('link')).toHaveLength(Object.keys(sections).length)
    expect(screen.queryByText('Coming soon')).toBeNull()
  })

  it('the sidebar has Needs attention right after Requests, with the count as a badge', () => {
    renderSidebar(vi.fn(), 2, 5)
    const labels = screen.getAllByRole('link').map((l) => l.textContent)
    expect(labels.indexOf('Needs attention5')).toBe(labels.indexOf('Requests2') + 1)
    const link = screen.getByRole('link', { name: /Needs attention/ })
    expect(link).toHaveAttribute('href', '/attention')
    expect(link).toHaveTextContent('5')
    // Each entry has its own badge: Requests keeps its own count.
    expect(screen.getByRole('link', { name: /Requests/ })).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: /Requests/ })).not.toHaveTextContent('5')
  })

  it('hides the Needs attention badge at 0, and when the count is not given', () => {
    const { unmount } = render(<Sidebar userName="Librarian One" onLogOut={vi.fn()} requestCount={0} attentionCount={0} />)
    expect(screen.getByRole('link', { name: 'Needs attention' })).toBeInTheDocument()
    unmount()
    // An older caller that does not know the prop still renders: it defaults to 0.
    render(<Sidebar userName="Librarian One" onLogOut={vi.fn()} requestCount={0} />)
    expect(screen.getByRole('link', { name: 'Needs attention' })).toBeInTheDocument()
  })

  it('the Needs attention entry is highlighted on /attention, and when a student page was opened from it', () => {
    render(<Sidebar userName="Librarian One" onLogOut={vi.fn()} requestCount={0} activeHref="/attention" />)
    expect(screen.getByRole('link', { name: 'Needs attention' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Requests' })).not.toHaveAttribute('aria-current')
  })

  it("shows the admin's name and initials, and logs out", async () => {
    const onLogOut = renderSidebar()
    expect(screen.getByText('Librarian One')).toBeInTheDocument()
    expect(screen.getByText('LO')).toBeInTheDocument()
    expect(screen.getByText('Librarian admin')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogOut).toHaveBeenCalledOnce()
  })
})
