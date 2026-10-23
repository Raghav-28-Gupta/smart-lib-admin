'use client'

import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ToastInput {
  title?: string
  message: string
  action?: { label: string; href: string }
}

export const TOAST_MS = 6_000
export const MAX_TOASTS = 3

type Toast = ToastInput & { id: number }

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})

/** The console's toasts: newest at the bottom, at most three, each for six seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++
    setToasts((list) => [...list, { ...toast, id }].slice(-MAX_TOASTS))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts((list) => list.filter((t) => t.id !== id))
    }, TOAST_MS)
    timers.current.add(timer)
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="sla-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="sla-toast card elev-md">
            {t.title && <strong className="sla-toast-title">{t.title}</strong>}
            <span>{t.message}</span>
            {t.action && (
              <Link href={t.action.href} className="sla-toast-link">
                {t.action.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext)
}
