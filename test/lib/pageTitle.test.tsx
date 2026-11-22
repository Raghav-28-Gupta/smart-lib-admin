import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageTitleProvider, useActiveHref, usePageChrome, usePageTitle } from '@/lib/pageTitle'

/** What the console layout does: show the page's title and active section when it set them. */
function Frame({ fallback }: { fallback: string }) {
  const { title, activeHref } = usePageChrome()
  return <p>{`title=${title ?? fallback} active=${activeHref ?? 'none'}`}</p>
}

function Page({ title, href }: { title: string | null; href: string | null }) {
  usePageTitle(title)
  useActiveHref(href)
  return null
}

describe('PageTitleProvider', () => {
  it('shows the title and the active section a page sets, and clears them when the page goes away', () => {
    const tree = (page: boolean, title = 'Fines / Aditi Sharma') => (
      <PageTitleProvider>
        <Frame fallback="Dashboard" />
        {page && <Page title={title} href="/fines" />}
      </PageTitleProvider>
    )
    const { rerender } = render(tree(true))
    expect(screen.getByText('title=Fines / Aditi Sharma active=/fines')).toBeInTheDocument()

    rerender(tree(true, 'Fines / Rohan Verma'))
    expect(screen.getByText('title=Fines / Rohan Verma active=/fines')).toBeInTheDocument()

    rerender(tree(false))
    expect(screen.getByText('title=Dashboard active=none')).toBeInTheDocument()
  })

  it('null leaves the layout to its own title and section', () => {
    render(
      <PageTitleProvider>
        <Frame fallback="Requests" />
        <Page title={null} href={null} />
      </PageTitleProvider>,
    )
    expect(screen.getByText('title=Requests active=none')).toBeInTheDocument()
  })

  it('a page outside a provider sets nothing and does not fail', () => {
    const { container } = render(<Page title="Anything" href="/fines" />)
    expect(container).toBeEmptyDOMElement()
  })
})
