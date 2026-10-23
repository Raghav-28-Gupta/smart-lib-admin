'use client'

import { useEffect, useState } from 'react'

/** The current time in ms, re-read every `everyMs`, so "waiting 12 min" keeps counting. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
