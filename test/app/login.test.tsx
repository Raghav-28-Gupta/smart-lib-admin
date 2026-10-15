import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '@/app/login/page'
import { NETWORK_MESSAGE, readToken } from '@/lib/api'
import { NOT_ADMIN_MESSAGE, SESSION_EXPIRED_MESSAGE } from '@/lib/session'
import { json, mockFetch } from '../helpers'

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const user = (role: 'admin' | 'student') => ({ id: 'u', name: 'Someone', email: 'lib@thapar.edu', roll: 'Pending', role })

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'lib@thapar.edu')
  await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

beforeEach(() => {
  nav.replace.mockReset()
  nav.search = ''
})

describe('LoginPage', () => {
  it('logs an admin in and opens the dashboard', async () => {
    mockFetch({ 'POST /auth/login': () => json(200, { user: user('admin'), token: 'tok' }) })
    render(<LoginPage />)
    await fillAndSubmit()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard'))
    expect(readToken()).toBe('tok')
  })

  it('refuses a student account and keeps no token', async () => {
    mockFetch({ 'POST /auth/login': () => json(200, { user: user('student'), token: 'tok' }) })
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByText(NOT_ADMIN_MESSAGE)).toBeInTheDocument()
    expect(readToken()).toBeNull()
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it("shows the server's message for wrong credentials", async () => {
    mockFetch({ 'POST /auth/login': () => json(401, { error: "That email and password don't match our records." }) })
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByText("That email and password don't match our records.")).toBeInTheDocument()
  })

  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByText(NETWORK_MESSAGE)).toBeInTheDocument()
  })

  it('explains why the previous session ended', () => {
    nav.search = 'reason=expired'
    const { unmount } = render(<LoginPage />)
    expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeInTheDocument()
    unmount()
    nav.search = 'reason=not-admin'
    render(<LoginPage />)
    expect(screen.getByText(NOT_ADMIN_MESSAGE)).toBeInTheDocument()
  })

  it('sends one request when submitted twice quickly', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetch)
    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'lib@thapar.edu')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
    const form = screen.getByRole('button', { name: 'Log in' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
