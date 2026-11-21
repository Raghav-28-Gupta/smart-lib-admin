import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const renderSidebar = (onLogOut = vi.fn(), requestCount = 0) => {
  render(<Sidebar userName="Librarian One" onLogOut={onLogOut} requestCount={requestCount} />)
  return onLogOut
}

describe('Sidebar', () => {
  it('marks the Dashboard as the current page', () => {
    renderSidebar()
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

  it('Resources is a link; Catalogue is still Coming soon', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/resources')
    expect(screen.queryByRole('button', { name: /Resources/ })).toBeNull()
    const button = screen.getByRole('button', { name: /Catalogue/ })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Coming soon')
  })

  it('Bookings is a link, Catalogue still Coming soon', () => {
    renderSidebar()
    const link = screen.getByRole('link', { name: 'Bookings' })
    expect(link).toHaveAttribute('href', '/bookings')
    expect(link).not.toHaveTextContent('Coming soon')
    expect(screen.queryByRole('button', { name: /Bookings/ })).toBeNull()
    const button = screen.getByRole('button', { name: /Catalogue/ })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Coming soon')
  })

  it('Fines is a link, Catalogue still Coming soon', () => {
    renderSidebar()
    const link = screen.getByRole('link', { name: 'Fines' })
    expect(link).toHaveAttribute('href', '/fines')
    expect(link).not.toHaveTextContent('Coming soon')
    expect(screen.queryByRole('button', { name: /Fines/ })).toBeNull()
    const button = screen.getByRole('button', { name: /Catalogue/ })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Coming soon')
  })

  it('leaves out the deferred Needs attention queue', () => {
    renderSidebar()
    expect(screen.queryByText('Needs attention')).toBeNull()
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
