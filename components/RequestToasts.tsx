'use client'

import { useLiveMessages } from '@/lib/liveContext'
import { useToast } from './Toasts'

/** A toast for every new request, on any console page. */
export function RequestToasts() {
  const toast = useToast()
  useLiveMessages((message) => {
    if (message.type !== 'request.created' || !message.summary) return
    toast({
      title: message.kind === 'room' ? 'New room request' : 'New borrow request',
      message: message.summary,
      action: { label: 'Review', href: '/requests' },
    })
  })
  return null
}
