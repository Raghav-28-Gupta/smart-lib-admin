'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * For a dialog whose confirm button sends a write and must not lose what was typed when the write is refused.
 * `onSubmit` resolves true when the write succeeded (the page then closes the dialog) and false when it failed
 * (the dialog stays open, with its values, and the page has already toasted the reason).
 *
 * - `submit(values)` ignores a second call while one is in flight (a ref, because Enter pressed twice can
 *   arrive before React re-renders); `submitting` is true meanwhile, for disabling the confirm button.
 * - Disabling the button the user just pressed can drop focus to the page behind the dialog, so after a
 *   failure focus goes back to the confirm button (`confirmRef`), unless the user already moved it elsewhere.
 */
export function useDialogSubmit<Values>(onSubmit: (values: Values) => Promise<boolean>) {
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const refocus = useRef(false)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (submitting || !refocus.current) return
    refocus.current = false
    if (!document.activeElement || document.activeElement === document.body) confirmRef.current?.focus()
  }, [submitting])

  async function submit(values: Values) {
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    try {
      refocus.current = !(await onSubmit(values))
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return { submitting, submit, confirmRef }
}
