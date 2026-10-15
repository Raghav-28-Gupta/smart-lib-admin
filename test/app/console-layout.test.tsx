import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ConsoleLayout from '@/app/(console)/layout'
import { writeToken } from '@/lib/api'

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }), usePathname: () => '/dashboard' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

describe('ConsoleLayout', () => {
  it('shows the loading skeleton, not a blank page, while the session check waits for the server', () => {
    writeToken('t')
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))) // Render still waking
    render(<ConsoleLayout><p>page</p></ConsoleLayout>)
    expect(screen.getByLabelText('Loading dashboard metrics')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('page')).toBeNull()
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
