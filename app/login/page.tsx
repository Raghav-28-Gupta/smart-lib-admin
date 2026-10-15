'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/api'
import { logIn, loginNotice } from '@/lib/session'

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg)', padding: '24px 16px' }}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}

function LoginForm() {
  const router = useRouter()
  const notice = loginNotice(useSearchParams().get('reason'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // a second submit can arrive before React re-renders

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await logIn(email.trim(), password)
      router.replace('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="card elev-sm" aria-labelledby="login-title" style={{ width: '100%', maxWidth: 360, padding: 24, gap: 14 }}>
      <div>
        <h1 id="login-title" style={{ margin: 0, fontSize: 24 }}>SmartLib admin</h1>
        <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Log in with a librarian account.</p>
      </div>
      {notice && !error && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-800)' }}>{notice}</p>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-800)' }}>{error}</p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  )
}
