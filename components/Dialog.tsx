'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'

/**
 * The canvas's dialog shell: backdrop, titled `role="dialog"` box, Escape to
 * cancel, Tab kept inside, and focus handed back to the opener on close.
 * Children supply the body, fields and a `.dialog-actions` row.
 */
export function Dialog({
  title, onCancel, children,
}: {
  title: string
  onCancel: () => void
  children: ReactNode
}) {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // The button that opened the dialog: read while rendering, before autoFocus moves focus into it.
  const [opener] = useState(() => document.activeElement)

  // Escape cancels, and Tab stays inside the dialog, so Enter can never reach a control behind it.
  useEffect(() => {
    const dialog = dialogRef.current!
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      // Filter every descendant instead of querying the group selector: jsdom lists a
      // group's matches selector by selector, but Tab order is document order.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('*')).filter((el) => el.matches(FOCUSABLE))
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!dialog.contains(active)) {
        event.preventDefault()
        const edge = event.shiftKey ? last : first
        edge.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  // Closing hands focus back to where it came from. Skipped while the dialog is
  // still in the page, which is only React Strict Mode re-running this effect in development.
  useEffect(() => {
    const dialog = dialogRef.current!
    return () => {
      if (!dialog.isConnected && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [opener])

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="dialog-title" id={`${id}-title`}>{title}</div>
        {children}
      </div>
    </div>
  )
}
