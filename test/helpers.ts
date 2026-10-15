import { vi } from 'vitest'

/** A JSON response, as the SmartLib API sends them. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * Replaces fetch with routes keyed by "METHOD /path". Each handler is called
 * per request, so it can return a fresh Response every time. Unknown routes fail the test.
 */
export function mockFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`
    const handler = routes[key]
    if (!handler) throw new Error(`Unexpected request: ${key}`)
    return handler()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
