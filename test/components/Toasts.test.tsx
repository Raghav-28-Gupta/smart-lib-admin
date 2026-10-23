import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOASTS, TOAST_MS, ToastProvider, useToast, type ToastInput } from '@/components/Toasts'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

let push: (toast: ToastInput) => void = () => {}
function Grab() {
  push = useToast()
  return null
}

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a toast with its title, message and link, then hides it after six seconds', () => {
    render(<ToastProvider><Grab /></ToastProvider>)
    act(() =>
      push({ title: 'New borrow request', message: 'Aditi Sharma wants to borrow Clean Code', action: { label: 'Review', href: '/requests' } }),
    )
    expect(screen.getByText('New borrow request')).toBeInTheDocument()
    expect(screen.getByText('Aditi Sharma wants to borrow Clean Code')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/requests')

    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(screen.queryByText('Aditi Sharma wants to borrow Clean Code')).toBeNull()
  })

  it('shows at most three at a time, dropping the oldest', () => {
    render(<ToastProvider><Grab /></ToastProvider>)
    act(() => {
      for (let i = 1; i <= MAX_TOASTS + 1; i++) push({ message: `Toast ${i}` })
    })
    expect(screen.queryByText('Toast 1')).toBeNull()
    expect(screen.getByText('Toast 4')).toBeInTheDocument()
  })
})
