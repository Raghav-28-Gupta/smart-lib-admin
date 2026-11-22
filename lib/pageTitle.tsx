'use client'

import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

// What a page can tell the console frame about itself. A page whose title or sidebar section the layout cannot
// work out from the path alone (the student page: "Fines / Aditi Sharma", with Fines highlighted) sets them here;
// every other page sets nothing and the layout keeps deriving both from the path.
interface PageChrome {
  title: string | null
  activeHref: string | null
}

const ChromeContext = createContext<PageChrome>({ title: null, activeHref: null })
const SetChromeContext = createContext<{ setTitle: (title: string | null) => void; setActiveHref: (href: string | null) => void }>({
  setTitle: () => {},
  setActiveHref: () => {},
})

/** Holds the title and the section a page has set. The console layout wraps its frame in it and reads it with `usePageChrome`. */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  const [activeHref, setActiveHref] = useState<string | null>(null)
  const chrome = useMemo(() => ({ title, activeHref }), [title, activeHref])
  // The setters are state setters, so this value never changes and a page calling them is not re-rendered by them.
  const setters = useMemo(() => ({ setTitle, setActiveHref }), [])
  return (
    <SetChromeContext.Provider value={setters}>
      <ChromeContext.Provider value={chrome}>{children}</ChromeContext.Provider>
    </SetChromeContext.Provider>
  )
}

// The hooks below use layout effects, not passive ones: a passive effect lets the browser paint one frame of the
// layout's own title ("Dashboard") and no highlighted section before the page's own appear.

/** For the layout: the title and sidebar section the page on screen has set; null for whatever it has not set. */
export function usePageChrome(): PageChrome {
  return useContext(ChromeContext)
}

/**
 * A page sets the top bar's title while it is mounted. `null` leaves the layout's own title (`PAGE_TITLES`, by path).
 * When the page goes away, or the title changes, the previous one is cleared in the same commit, so nothing stale shows.
 * Outside a PageTitleProvider it does nothing.
 */
export function usePageTitle(title: string | null): void {
  const { setTitle } = useContext(SetChromeContext)
  useLayoutEffect(() => {
    setTitle(title)
    return () => setTitle(null)
  }, [setTitle, title])
}

/**
 * A page names the sidebar section to highlight (its `href`, e.g. '/fines') while it is mounted, in place of the one
 * the path would pick. `null` leaves the sidebar following the path.
 */
export function useActiveHref(href: string | null): void {
  const { setActiveHref } = useContext(SetChromeContext)
  useLayoutEffect(() => {
    setActiveHref(href)
    return () => setActiveHref(null)
  }, [setActiveHref, href])
}
