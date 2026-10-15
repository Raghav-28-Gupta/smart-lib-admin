import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NETWORK_MESSAGE, readToken, SESSION_ENDED_EVENT, writeToken } from '@/lib/api'
import { ConsoleGuard, useSession } from '@/lib/session'
import { json, mockFetch } from '../helpers'

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }) }))

const ADMIN = { id: 'a1', name: 'Librarian One', email: 'lib@thapar.edu', roll: 'Pending', role: 'admin' }

function Probe() {
  const { user, logOut } = useSession()
  return (
    <div>
      <p>Signed in as {user.name}</p>
      <button type="button" onClick={logOut}>Log out</button>
    </div>
  )
}

const renderGuard = () => render(<ConsoleGuard><Probe /></ConsoleGuard>)

beforeEach(() => nav.replace.mockReset())

describe('ConsoleGuard', () => {
  it('sends a visitor without a token to the login page', () => {
    renderGuard()
    expect(nav.replace).toHaveBeenCalledWith('/login')
    expect(screen.queryByText(/Signed in/)).toBeNull()
  })

  it('lets an admin in', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, ADMIN) })
    renderGuard()
    expect(await screen.findByText('Signed in as Librarian One')).toBeInTheDocument()
  })

  it('turns away an account that is no longer an admin', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, { ...ADMIN, role: 'student' }) })
    renderGuard()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login?reason=not-admin'))
    expect(readToken()).toBeNull()
  })

  it('sends a deleted account to the login page', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(404, { error: 'User not found' }) })
    renderGuard()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'))
    expect(readToken()).toBeNull()
  })

  it('keeps the token and offers Retry when the server cannot be reached', async () => {
    writeToken('t')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, ADMIN)))
    renderGuard()
    expect(await screen.findByText(NETWORK_MESSAGE)).toBeInTheDocument()
    expect(readToken()).toBe('t')
    expect(nav.replace).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Signed in as Librarian One')).toBeInTheDocument()
  })

  it('follows a session-ended event to the login page with its reason', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, ADMIN) })
    renderGuard()
    await screen.findByText('Signed in as Librarian One')
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: 'expired' }))
    })
    expect(nav.replace).toHaveBeenCalledWith('/login?reason=expired')
  })

  it('logs out by clearing the token and returning to the login page', async () => {
    writeToken('t')
    mockFetch({ 'GET /auth/me': () => json(200, ADMIN) })
    renderGuard()
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(readToken()).toBeNull()
    expect(nav.replace).toHaveBeenCalledWith('/login')
  })
})
