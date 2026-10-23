// The console's only route to the SmartLib API.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const TOKEN_KEY = 'smartlib.admin.token'
export const NETWORK_MESSAGE = "Can't reach the SmartLib server. Try again in a minute."
// Render's free tier sleeps when idle and takes up to a minute to wake; waiting
// that long shows the loading state instead of an error.
export const REQUEST_TIMEOUT_MS = 60_000

export type SessionEndReason = 'expired' | 'not-admin'
/** Fired on window, as a CustomEvent<SessionEndReason>, when the API ends the session. */
export const SESSION_ENDED_EVENT = 'smartlib:session-ended'

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage unavailable: there is nothing to clear.
  }
}

/** Clears the token and tells ConsoleGuard why the session ended; it sends the user to /login. */
export function endSession(reason: SessionEndReason): void {
  clearToken()
  window.dispatchEvent(new CustomEvent<SessionEndReason>(SESSION_ENDED_EVENT, { detail: reason }))
}

export async function apiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = options.auth === false ? null : readToken()
  if (token) headers.Authorization = `Bearer ${token}`

  // An AbortController with a timer, rather than AbortSignal.timeout, so the
  // timeout works in every browser and in the test DOM.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE)
  } finally {
    clearTimeout(timer)
  }

  const data = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) {
    // With a token, 401 means the session expired and 403 means the account
    // is no longer an admin (every console route is admin-only).
    if (token && (res.status === 401 || res.status === 403)) {
      endSession(res.status === 401 ? 'expired' : 'not-admin')
    }
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`)
  }
  return data as T
}
