import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConsoleLayout from '@/app/(console)/layout'
import { writeToken } from '@/lib/api'
import type { PendingRequests } from '@/lib/requests'
import { eventStream, json, mockFetch } from '../helpers'

// One stable replace, as in console-layout.test.tsx: ConsoleGuard's effect depends on it,
// so a fresh vi.fn() per useRouter() call would re-run the session check on every render.
const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }), usePathname: () => '/dashboard' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

const ADMIN = { id: 'a1', name: 'Librarian One', email: 'lib@thapar.edu', roll: 'Pending', role: 'admin' }
const student = (n: number) => ({ id: `u${n}`, name: `Student ${n}`, email: `s${n}@thapar.edu` })
const WAITING: PendingRequests = {
  requests: [
    {
      id: 'br-1', kind: 'borrow', student: student(1), requestedAt: '2026-10-22T08:00:00.000Z', expiresAt: '2026-10-23T08:00:00.000Z',
      book: { id: 'b8', title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 1, totalCopies: 4 },
    },
    {
      id: 'bk-1', kind: 'room', student: student(2), requestedAt: '2026-10-22T08:05:00.000Z', expiresAt: '2026-10-22T08:45:00.000Z',
      room: { resourceId: 'r1', name: 'Group Room 201', location: null, startTime: '2026-10-22T08:30:00.000Z', endTime: '2026-10-22T09:30:00.000Z' },
    },
  ],
  counts: { all: 2, borrow: 1, room: 1 },
}

describe('console shell', () => {
  afterEach(() => {
    document.title = ''
  })

  it('shows the waiting count, goes live, and toasts a new request', async () => {
    writeToken('t')
    const stream = eventStream()
    mockFetch({
      'GET /auth/me': () => json(200, ADMIN),
      'GET /admin/requests': () => json(200, WAITING),
      'GET /admin/events': () => stream.response,
    })

    render(<ConsoleLayout><p>page</p></ConsoleLayout>)

    expect(await screen.findByText('page')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('(2) SmartLib Admin'))
    expect(screen.getByRole('link', { name: /Requests/ })).toHaveTextContent('2')
    expect(screen.getByText('Connecting…')).toBeInTheDocument()

    act(() => stream.send('event: ready\ndata: {}\n\n'))
    expect(await screen.findByText('Live')).toBeInTheDocument()

    act(() =>
      stream.send('event: request.created\ndata: {"topics":["requests"],"kind":"borrow","summary":"Aditi Sharma wants to borrow Sapiens"}\n\n'),
    )
    expect(await screen.findByText('Aditi Sharma wants to borrow Sapiens')).toBeInTheDocument()
    expect(screen.getByText('New borrow request')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/requests')
  })
})
