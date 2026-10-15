import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const renderSidebar = (onLogOut = vi.fn()) => {
  render(<Sidebar userName="Librarian One" onLogOut={onLogOut} />)
  return onLogOut
}

describe('Sidebar', () => {
  it('marks the Dashboard as the current page', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the unbuilt sections as disabled and marked Coming soon', () => {
    renderSidebar()
    for (const name of ['Bookings', 'Catalogue', 'Resources', 'Fines']) {
      const button = screen.getByRole('button', { name: new RegExp(name) })
      expect(button).toBeDisabled()
      expect(button).toHaveTextContent('Coming soon')
    }
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
