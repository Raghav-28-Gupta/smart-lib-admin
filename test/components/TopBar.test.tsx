import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from '@/components/TopBar'

afterEach(() => vi.useRealTimers())

describe('TopBar', () => {
  it("shows the page title and the library's date", () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T20:00:00Z')) // already 15 Oct in India
    render(<TopBar title="Dashboard" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Thursday, Oct 15, 2026')).toBeInTheDocument()
  })
})
