import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StudentLink } from '@/components/StudentLink'

// The mock hands `prefetch` back as `data-prefetch` ("false", "true" or "undefined" for Next's default), so a test can read it.
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean | null }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>{children}</a>
  ),
}))

describe('StudentLink', () => {
  it('points at /students/<id>?from=<from>', () => {
    render(<StudentLink student={{ id: 's1', name: 'Aditi Sharma' }} from="fines" />)
    expect(screen.getByRole('link', { name: 'Aditi Sharma' })).toHaveAttribute('href', '/students/s1?from=fines')
  })

  it('does not prefetch the student page: it is rendered on demand, so every visible name would cost a function call', () => {
    render(<StudentLink student={{ id: 's1', name: 'Aditi Sharma' }} from="fines" />)
    expect(screen.getByRole('link', { name: 'Aditi Sharma' })).toHaveAttribute('data-prefetch', 'false')
  })

  it('carries each section it is opened from', () => {
    render(
      <>
        <StudentLink student={{ id: 's1', name: 'From bookings' }} from="bookings" />
        <StudentLink student={{ id: 's1', name: 'From requests' }} from="requests" />
        <StudentLink student={{ id: 's1', name: 'From catalogue' }} from="catalogue" />
      </>,
    )
    expect(screen.getByRole('link', { name: 'From bookings' })).toHaveAttribute('href', '/students/s1?from=bookings')
    expect(screen.getByRole('link', { name: 'From requests' })).toHaveAttribute('href', '/students/s1?from=requests')
    expect(screen.getByRole('link', { name: 'From catalogue' })).toHaveAttribute('href', '/students/s1?from=catalogue')
  })

  it('encodes an id that is not path-safe', () => {
    render(<StudentLink student={{ id: 'a/b c', name: 'Odd Id' }} from="bookings" />)
    expect(screen.getByRole('link', { name: 'Odd Id' })).toHaveAttribute('href', '/students/a%2Fb%20c?from=bookings')
  })

  it("shows the name as text, never as markup", () => {
    render(<StudentLink student={{ id: 's9', name: 'A <b>B</b>' }} from="fines" />)
    const link = screen.getByRole('link', { name: 'A <b>B</b>' })
    expect(link).toHaveTextContent('A <b>B</b>')
    expect(link.querySelector('b')).toBeNull()
  })

  it("is styled as the canvas's student link: accent-700, underlined, the surrounding font size", () => {
    render(<StudentLink student={{ id: 's1', name: 'Aditi Sharma' }} from="fines" />)
    const link = screen.getByRole('link', { name: 'Aditi Sharma' })
    expect(link.style.color).toBe('var(--color-accent-700)')
    expect(link.style.textDecoration).toBe('underline')
    expect(link.style.fontSize).toBe('inherit')
  })
})
