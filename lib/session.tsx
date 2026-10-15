'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  ApiError,
  apiRequest,
  clearToken,
  readToken,
  SESSION_ENDED_EVENT,
  writeToken,
  type SessionEndReason,
} from './api'

export interface AdminUser {
  id: string
  name: string
  email: string
  roll: string
  role: 'student' | 'admin'
}

export const NOT_ADMIN_MESSAGE = "This account doesn't have admin access."
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Log in again.'

/** Logs in and keeps the token only for an admin. Throws an ApiError carrying the message to show. */
export async function logIn(email: string, password: string): Promise<AdminUser> {
  const { user, token } = await apiRequest<{ user: AdminUser; token: string }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  })
  if (user.role !== 'admin') throw new ApiError(403, NOT_ADMIN_MESSAGE)
  writeToken(token)
  return user
}

/** The login page's notice for `?reason=`. */
export function loginNotice(reason: string | null): string | null {
  if (reason === 'expired') return SESSION_EXPIRED_MESSAGE
  if (reason === 'not-admin') return NOT_ADMIN_MESSAGE
  return null
}

interface Session {
  user: AdminUser
  logOut: () => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside <ConsoleGuard>')
  return session
}

type GuardState = { kind: 'checking' } | { kind: 'unreachable'; message: string } | { kind: 'ready'; user: AdminUser }

/**
 * Lets an admin into the console and sends everyone else to /login. `fallback`
 * shows while the session is checked, which takes up to a minute when the API is waking.
 */
export function ConsoleGuard({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  // Depend on replace, not the router object, so effects never re-run on a new router identity.
  const { replace } = useRouter()
  const [state, setState] = useState<GuardState>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)

  const logOut = useCallback(() => {
    clearToken()
    replace('/login')
  }, [replace])

  // Any API call can end the session: 401 (expired) or 403 (no longer an admin).
  useEffect(() => {
    const onEnded = (e: Event) => replace(`/login?reason=${(e as CustomEvent<SessionEndReason>).detail}`)
    window.addEventListener(SESSION_ENDED_EVENT, onEnded)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded)
  }, [replace])

  useEffect(() => {
    if (!readToken()) {
      replace('/login')
      return
    }
    let cancelled = false
    setState({ kind: 'checking' })
    apiRequest<AdminUser>('/auth/me')
      .then((user) => {
        if (cancelled) return
        if (user.role !== 'admin') {
          clearToken()
          replace('/login?reason=not-admin')
          return
        }
        setState({ kind: 'ready', user })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return // the listener above handles it
        if (error instanceof ApiError && error.status === 404) {
          clearToken() // the account no longer exists
          replace('/login')
          return
        }
        setState({ kind: 'unreachable', message: error instanceof ApiError ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [replace, attempt])

  if (state.kind === 'ready') {
    return <SessionContext.Provider value={{ user: state.user, logOut }}>{children}</SessionContext.Provider>
  }
  if (state.kind === 'unreachable') {
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '0 16px', textAlign: 'center', background: 'var(--color-bg)', color: 'var(--color-text)',
        }}
      >
        <p style={{ margin: 0 }}>{state.message}</p>
        <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    )
  }
  return (
    <div aria-busy="true" aria-label="Checking your session" style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      {fallback}
    </div>
  )
}
