import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AttentionPage from '@/app/(console)/attention/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { AttentionItem, AttentionQueue, LastNotice, OverdueItem } from '@/lib/attention'
import { AttentionProvider } from '@/lib/attentionContext'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import { json, mockFetch } from '../helpers'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

// A stable replace (ConsoleGuard-style effects depend on it); `search` is what the URL says.
const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/attention',
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

// Every time derives from now, an hour past the whole day, so a slow test never tips into the next day.
const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000 - 3_600_000).toISOString()

const ADITI = { id: 's1', name: 'Aditi Sharma', email: 'aditi@example.edu' }
const ROHAN = { id: 's2', name: 'Rohan Verma', email: 'rohan@example.edu' }
const MEERA = { id: 's3', name: 'Meera Iyer', email: 'meera@example.edu' }

// `escalated` is whether the loan has ever been escalated, whatever the newest notice is (a reminder can follow an escalation).
function overdue(
  id: string, student: AttentionItem['student'], title: string, days: number, amount: number, lastNotice: LastNotice | null = null,
  escalated = false,
): OverdueItem {
  return {
    id, kind: 'overdue', student, waitingSince: daysAgoIso(days),
    overdue: { loanId: id, title, dueAt: daysAgoIso(days), daysOverdue: days, amount, lastNotice, escalated },
  }
}

// Oldest waiting first, as the server answers.
const CLEAN_CODE = overdue('l1', ADITI, 'Clean Code', 3, 30, { kind: 'reminder', at: daysAgoIso(2), emailStatus: 'sent' })
const NETWORKS = overdue('l2', ROHAN, 'Computer Networks', 2, 20, { kind: 'escalation', at: daysAgoIso(1), emailStatus: 'skipped' }, true)
const SAPIENS = overdue('l3', MEERA, 'Sapiens', 1, 10)

const queue = (items: AttentionItem[], over: Partial<AttentionQueue> = {}): AttentionQueue => ({
  items,
  counts: { all: items.length, overdue: items.filter((i) => i.kind === 'overdue').length, fine_dispute: 0, report: 0 },
  emailEnabled: true,
  ...over,
})
const THREE = queue([CLEAN_CODE, NETWORKS, SAPIENS])

// One tree for render and rerender, so a rerender keeps the providers (and their state) mounted.
const tree = () => (
  <LiveProvider>
    <ToastProvider>
      <AttentionProvider>
        <AttentionPage />
      </AttentionProvider>
    </ToastProvider>
  </LiveProvider>
)

function renderPage() {
  writeToken('t')
  return render(tree())
}

const cardOf = (summary: string) => screen.getByText(summary).closest('.card') as HTMLElement
const chip = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  nav.search = ''
})

describe('Needs attention page', () => {
  it('shows the skeleton, then an overdue card with its tag, student link, waiting time, amount and last-notice line', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch({
      'GET /admin/attention': async () => {
        await gate
        return json(200, queue([CLEAN_CODE]))
      },
    })
    const { container } = renderPage()

    expect(screen.getByLabelText('Loading the queue')).toHaveAttribute('aria-busy', 'true')
    const blocks = container.querySelectorAll('.sla-skel')
    expect(blocks).toHaveLength(3)
    blocks.forEach((block) => expect(block).toHaveStyle({ height: '84px' }))

    release()
    await screen.findByText('Clean Code — 3 days overdue')
    const card = within(cardOf('Clean Code — 3 days overdue'))
    expect(screen.queryByLabelText('Loading the queue')).toBeNull()
    expect(card.getByText('Overdue follow-up')).toHaveClass('tag')
    expect(card.getByRole('link', { name: 'Aditi Sharma' })).toHaveAttribute('href', '/students/s1?from=attention')
    expect(card.getByText('waiting 3 days')).toBeInTheDocument()
    expect(card.getByText('₹30 so far. Reminded 2 days ago · emailed')).toBeInTheDocument()
  })

  it('words the last notice: not emailed, escalated, and nothing at all when there is none', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    renderPage()
    await screen.findByText('Clean Code — 3 days overdue')
    expect(within(cardOf('Computer Networks — 2 days overdue')).getByText('₹20 so far. Escalated 1 day ago · not emailed')).toBeInTheDocument()
    const bare = within(cardOf('Sapiens — 1 day overdue'))
    expect(bare.getByText('₹10 so far.')).toBeInTheDocument()
    expect(bare.getByText('waiting 1 day')).toBeInTheDocument()
  })

  it('says "waiting today" for an item under a day old', async () => {
    const fresh: AttentionItem = {
      ...SAPIENS, waitingSince: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    }
    mockFetch({ 'GET /admin/attention': () => json(200, queue([fresh])) })
    renderPage()
    await screen.findByText('Sapiens — 1 day overdue')
    expect(screen.getByText('waiting today')).toBeInTheDocument()
  })

  it('shows the cards oldest first, as the server sent them', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    renderPage()
    await screen.findByText('Clean Code — 3 days overdue')
    const summaries = screen.getAllByText(/ days? overdue$/).map((el) => el.textContent)
    expect(summaries).toEqual(['Clean Code — 3 days overdue', 'Computer Networks — 2 days overdue', 'Sapiens — 1 day overdue'])
  })

  it('the chips show counts, filter the cards, and ?type=overdue selects Overdue follow-ups', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    const { unmount } = renderPage()
    await screen.findByText('Clean Code — 3 days overdue')
    expect(chip('All (3)')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Overdue follow-ups (3)')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Fine disputes (0)')).toBeInTheDocument()
    expect(chip('Maintenance flags (0)')).toBeInTheDocument()

    await userEvent.click(chip('Overdue follow-ups (3)'))
    expect(chip('Overdue follow-ups (3)')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('All (3)')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByText(/ days? overdue$/)).toHaveLength(3)

    await userEvent.click(chip('Fine disputes (0)'))
    expect(screen.queryByText('Clean Code — 3 days overdue')).toBeNull()

    unmount()
    nav.search = 'type=overdue'
    renderPage()
    expect(await screen.findByRole('button', { name: 'Overdue follow-ups (3)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All (3)' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Clean Code — 3 days overdue')).toBeInTheDocument()
  })

  it('takes every count from the server, so a kind this page cannot draw yet still counts', async () => {
    mockFetch({
      'GET /admin/attention': () => json(200, queue([CLEAN_CODE], { counts: { all: 5, overdue: 1, fine_dispute: 3, report: 1 } })),
    })
    renderPage()
    expect(await screen.findByRole('button', { name: 'All (5)' })).toBeInTheDocument()
    expect(chip('Overdue follow-ups (1)')).toBeInTheDocument()
    expect(chip('Fine disputes (3)')).toBeInTheDocument()
    expect(chip('Maintenance flags (1)')).toBeInTheDocument()
  })

  it('?type=fine_dispute and ?type=report select their chips; an unknown type falls back to All', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    nav.search = 'type=fine_dispute'
    const first = renderPage()
    expect(await screen.findByRole('button', { name: 'Fine disputes (0)' })).toHaveAttribute('aria-pressed', 'true')
    first.unmount()

    nav.search = 'type=report'
    const second = renderPage()
    expect(await screen.findByRole('button', { name: 'Maintenance flags (0)' })).toHaveAttribute('aria-pressed', 'true')
    second.unmount()

    for (const type of ['nonsense', 'constructor', '__proto__', '']) {
      nav.search = `type=${type}`
      const view = renderPage()
      expect(await screen.findByRole('button', { name: 'All (3)' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Clean Code — 3 days overdue')).toBeInTheDocument()
      view.unmount()
    }
  })

  it('a link to /attention?type=overdue followed while the page is open moves the chip', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    const view = renderPage()
    await screen.findByText('Clean Code — 3 days overdue')
    expect(chip('All (3)')).toHaveAttribute('aria-pressed', 'true')

    nav.search = 'type=overdue'
    view.rerender(tree())
    expect(chip('Overdue follow-ups (3)')).toHaveAttribute('aria-pressed', 'true')
  })

  it('no No-show chip', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    renderPage()
    await screen.findByText('Clean Code — 3 days overdue')
    expect(screen.queryByRole('button', { name: /No-show/ })).toBeNull()
    // The chips are the buttons that can be pressed: the cards' own buttons are not among them.
    expect(screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed')).map((b) => b.textContent)).toEqual([
      'All (3)', 'Overdue follow-ups (3)', 'Fine disputes (0)', 'Maintenance flags (0)',
    ])
  })

  it('a filter that matches nothing says so and Clear filter goes back to All', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    renderPage()
    await screen.findByText('Clean Code — 3 days overdue')

    await userEvent.click(chip('Maintenance flags (0)'))
    expect(screen.getByText('No maintenance flags waiting')).toBeInTheDocument()
    expect(screen.queryByText("You're all caught up")).toBeNull()
    expect(screen.queryByText('Clean Code — 3 days overdue')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(chip('All (3)')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Clean Code — 3 days overdue')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull()
  })

  it('the empty state says everything is handled, whatever the chip', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([])) })
    renderPage()
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(
      screen.getByText('Nothing needs attention right now. Overdue loans, fine disputes and problem reports will show up here.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/handled automatically/)).toBeNull()
    expect(chip('All (0)')).toBeInTheDocument()

    // With nothing queued at all, a chip has nothing to clear: still "all caught up", not "no match".
    await userEvent.click(chip('Overdue follow-ups (0)'))
    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull()
  })

  it('"Couldn\'t load the queue" with Retry', async () => {
    let calls = 0
    mockFetch({ 'GET /admin/attention': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, queue([SAPIENS]))) })
    renderPage()
    expect(await screen.findByText("Couldn't load the queue")).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Sapiens — 1 day overdue')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the queue")).toBeNull()
  })

  it('a live attention event refetches quietly: the cards stay while it runs, then show the new queue', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    mockFetch({
      'GET /admin/attention': async () => {
        if (++calls === 1) return json(200, queue([CLEAN_CODE]))
        await gate
        return json(200, queue([CLEAN_CODE, SAPIENS]))
      },
    })
    renderPage()
    await screen.findByText('Clean Code — 3 days overdue')

    act(() => live.handlers!.onEvent({ type: 'attention.changed', topics: ['attention'] }))
    await waitFor(() => expect(calls).toBe(2), { timeout: 3_000 })

    // The refetch is in flight: no skeleton, the card is still there.
    expect(screen.queryByLabelText('Loading the queue')).toBeNull()
    expect(screen.getByText('Clean Code — 3 days overdue')).toBeInTheDocument()

    release()
    expect(await screen.findByText('Sapiens — 1 day overdue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All (2)' })).toBeInTheDocument()
  })

  it('a quiet refetch that fails keeps the cards', async () => {
    let calls = 0
    mockFetch({ 'GET /admin/attention': () => (++calls === 1 ? json(200, THREE) : json(500, { error: 'Something went wrong.' })) })
    renderPage()
    await screen.findByText('Clean Code — 3 days overdue')

    act(() => live.handlers!.onEvent({ type: 'attention.changed', topics: ['attention'] }))
    await waitFor(() => expect(calls).toBe(2), { timeout: 3_000 })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.getByText('Clean Code — 3 days overdue')).toBeInTheDocument()
    expect(screen.getByText('Sapiens — 1 day overdue')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the queue")).toBeNull()
  })
})

describe('Needs attention overdue actions', () => {
  type Fetch = ReturnType<typeof mockFetch>
  const writes = (fetch: Fetch) => fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  const reads = (fetch: Fetch) => fetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET')
  const gate = () => {
    let open!: () => void
    const promise = new Promise<void>((resolve) => {
      open = resolve
    })
    return { promise, open }
  }
  const dialogOf = (name: string) => screen.getByRole('dialog', { name })
  const confirmOf = (dialog: HTMLElement, label: string) => within(dialog).getByRole('button', { name: label })
  const inCard = (summary: string) => within(cardOf(summary))
  const buttonOf = (summary: string, name: string) => inCard(summary).getByRole('button', { name })
  // The item as the server answers after a notice: the newest notice changes, and `escalated` once an escalation was sent.
  const noticed = (item: OverdueItem, lastNotice: LastNotice, escalated = item.overdue.escalated): OverdueItem => ({
    ...item, overdue: { ...item.overdue, lastNotice, escalated },
  })
  const justNow = (kind: LastNotice['kind'], emailStatus: LastNotice['emailStatus'] = 'sent'): LastNotice => ({
    kind, at: new Date().toISOString(), emailStatus,
  })
  const SAPIENS_SUMMARY = 'Sapiens — 1 day overdue'

  it('Send reminder posts and toasts "Reminder sent." and the card shows "Reminded just now"', async () => {
    let current = queue([SAPIENS])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/loans/l3/remind': () => {
        const reminded = noticed(SAPIENS, justNow('reminder'))
        current = queue([reminded])
        return json(200, reminded)
      },
    })
    renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    expect(inCard(SAPIENS_SUMMARY).getByText('₹10 so far.')).toBeInTheDocument()

    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Send reminder'))
    await userEvent.click(confirmOf(dialogOf('Send an overdue reminder?'), 'Send reminder'))

    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/loans\/l3\/remind$/)
    expect(writes(fetch)[0][1]!.body).toBeUndefined()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(inCard(SAPIENS_SUMMARY).getByText('₹10 so far. Reminded just now · emailed')).toBeInTheDocument()
  })

  it('the reminder dialog says whether email goes too', async () => {
    const cases: [boolean, string][] = [
      [true, 'Meera Iyer gets a notice in the app and an email about Sapiens.'],
      [false, "Meera Iyer gets a notice in the app about Sapiens. Email isn't set up."],
    ]
    for (const [emailEnabled, body] of cases) {
      const fetch = mockFetch({ 'GET /admin/attention': () => json(200, queue([SAPIENS], { emailEnabled })) })
      const view = renderPage()
      await screen.findByText(SAPIENS_SUMMARY)
      await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Send reminder'))

      const dialog = dialogOf('Send an overdue reminder?')
      expect(within(dialog).getByText(body)).toBeInTheDocument()
      expect(confirmOf(dialog, 'Send reminder')).toBeEnabled()

      // Cancel sends nothing (an unexpected request would have failed the mock).
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(writes(fetch)).toHaveLength(0)
      view.unmount()
    }
  })

  it('Escalate sends the note, shows Escalated, and hides the button', async () => {
    let current = queue([SAPIENS])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/loans/l3/escalate': () => {
        const escalated = noticed(SAPIENS, justNow('escalation', 'skipped'), true)
        current = queue([escalated])
        return json(200, escalated)
      },
    })
    renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    expect(inCard(SAPIENS_SUMMARY).queryByText('Escalated')).toBeNull()

    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Escalate'))
    const dialog = dialogOf('Escalate to a formal notice?')
    expect(dialog).toHaveTextContent(
      'Meera Iyer will receive a formal overdue notice for Sapiens (and an email when email is set up). The fine keeps growing at ₹10 a day until the book is back.',
    )
    const note = within(dialog).getByLabelText('Note (optional)')
    expect(note).toHaveFocus()
    await userEvent.type(note, '  Please return it by Friday  ')
    await userEvent.click(confirmOf(dialog, 'Escalate'))

    expect(await screen.findByText('Escalated.')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/loans\/l3\/escalate$/)
    expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({ note: 'Please return it by Friday' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const card = inCard(SAPIENS_SUMMARY)
    expect(card.getByText('Escalated')).toHaveClass('tag')
    expect(card.getByText('₹10 so far. Escalated just now · not emailed')).toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Escalate' })).toBeNull()
    expect(card.getByRole('button', { name: 'Send reminder' })).toBeEnabled()
  })

  it('a blank escalation note sends an empty body', async () => {
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([SAPIENS])),
      'POST /admin/loans/l3/escalate': () => json(200, noticed(SAPIENS, justNow('escalation'), true)),
    })
    renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Escalate'))
    const dialog = dialogOf('Escalate to a formal notice?')
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), '   ')
    await userEvent.click(confirmOf(dialog, 'Escalate'))
    expect(await screen.findByText('Escalated.')).toBeInTheDocument()
    expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({})
  })

  it('an escalated loan (escalated: true) loads with the tag and no Escalate button, and can still be reminded', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, THREE) })
    renderPage()
    await screen.findByText('Computer Networks — 2 days overdue')

    const escalated = inCard('Computer Networks — 2 days overdue')
    expect(escalated.getByText('Escalated')).toHaveClass('tag')
    expect(escalated.queryByRole('button', { name: 'Escalate' })).toBeNull()
    expect(escalated.getByRole('button', { name: 'Send reminder' })).toBeEnabled()

    // A reminded or untouched loan (escalated: false) has no tag and both buttons.
    for (const summary of ['Clean Code — 3 days overdue', SAPIENS_SUMMARY]) {
      expect(inCard(summary).queryByText('Escalated')).toBeNull()
      expect(buttonOf(summary, 'Send reminder')).toBeEnabled()
      expect(buttonOf(summary, 'Escalate')).toBeEnabled()
    }
  })

  it('an escalated loan keeps the Escalated tag and no Escalate button after a later reminder', async () => {
    // The queue item carries only the newest notice, which is now a reminder; `escalated` still says the loan was escalated.
    const remindedAfter = overdue(
      'l4', ROHAN, 'Computer Networks', 2, 20, { kind: 'reminder', at: daysAgoIso(1), emailStatus: 'sent' }, true,
    )
    mockFetch({ 'GET /admin/attention': () => json(200, queue([remindedAfter])) })
    renderPage()
    await screen.findByText('Computer Networks — 2 days overdue')

    const card = inCard('Computer Networks — 2 days overdue')
    expect(card.getByText('Escalated')).toHaveClass('tag')
    expect(card.getByText('₹20 so far. Reminded 1 day ago · emailed')).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Send reminder' })).toBeEnabled()
    expect(card.queryByRole('button', { name: 'Escalate' })).toBeNull()
  })

  it('reminding an escalated loan leaves the Escalated tag up and still offers no Escalate button', async () => {
    let current = queue([NETWORKS])
    mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/loans/l2/remind': () => {
        // The reminder is now the newest notice; the loan is still an escalated one.
        const reminded = noticed(NETWORKS, justNow('reminder'))
        current = queue([reminded])
        return json(200, reminded)
      },
    })
    renderPage()
    await screen.findByText('Computer Networks — 2 days overdue')
    expect(buttonOf('Computer Networks — 2 days overdue', 'Send reminder')).toBeEnabled()

    await userEvent.click(buttonOf('Computer Networks — 2 days overdue', 'Send reminder'))
    await userEvent.click(confirmOf(dialogOf('Send an overdue reminder?'), 'Send reminder'))
    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const card = inCard('Computer Networks — 2 days overdue')
    expect(card.getByText('₹20 so far. Reminded just now · emailed')).toBeInTheDocument()
    expect(card.getByText('Escalated')).toHaveClass('tag')
    expect(card.queryByRole('button', { name: 'Escalate' })).toBeNull()
    expect(card.getByRole('button', { name: 'Send reminder' })).toBeEnabled()
  })

  it("a 409 (reminded recently, no longer overdue) shows the server's message, keeps the dialog and refetches", async () => {
    // Reminded recently: the refetch shows the reminder someone else sent, and the dialog stays for the librarian to cancel.
    let current = queue([SAPIENS])
    const first = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/loans/l3/remind': () => {
        current = queue([noticed(SAPIENS, { kind: 'reminder', at: new Date(Date.now() - 3 * 3_600_000).toISOString(), emailStatus: 'sent' })])
        return json(409, { error: 'A reminder was sent 3 hours ago.' })
      },
    })
    const view = renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Send reminder'))
    const remindDialog = dialogOf('Send an overdue reminder?')
    const confirm = confirmOf(remindDialog, 'Send reminder')
    await userEvent.click(confirm)

    expect(await screen.findByText('A reminder was sent 3 hours ago.')).toBeInTheDocument()
    expect(screen.queryByText('Reminder sent.')).toBeNull()
    await waitFor(() => expect(reads(first)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Send an overdue reminder?' })).toBe(remindDialog)
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(confirm).toHaveFocus()
    expect(await inCard(SAPIENS_SUMMARY).findByText('₹10 so far. Reminded today · emailed')).toBeInTheDocument()
    expect(writes(first)).toHaveLength(1)
    view.unmount()

    // No longer overdue: the refetch drops the card, and the dialog (and the note typed into it) stays.
    let gone = queue([SAPIENS])
    const second = mockFetch({
      'GET /admin/attention': () => json(200, gone),
      'POST /admin/loans/l3/escalate': () => {
        gone = queue([])
        return json(409, { error: 'This loan is no longer overdue.' })
      },
    })
    renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Escalate'))
    const escalateDialog = dialogOf('Escalate to a formal notice?')
    await userEvent.type(within(escalateDialog).getByLabelText('Note (optional)'), 'Please return it by Friday')
    await userEvent.click(confirmOf(escalateDialog, 'Escalate'))

    expect(await screen.findByText('This loan is no longer overdue.')).toBeInTheDocument()
    expect(screen.queryByText('Escalated.')).toBeNull()
    await waitFor(() => expect(reads(second)).toHaveLength(2))
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Escalate to a formal notice?' })).toBe(escalateDialog)
    expect(within(escalateDialog).getByLabelText('Note (optional)')).toHaveValue('Please return it by Friday')
    await userEvent.click(within(escalateDialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows "This loan was already escalated." as the server worded it', async () => {
    mockFetch({
      'GET /admin/attention': () => json(200, queue([SAPIENS])),
      'POST /admin/loans/l3/escalate': () => json(409, { error: 'This loan was already escalated.' }),
    })
    renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Escalate'))
    await userEvent.click(confirmOf(dialogOf('Escalate to a formal notice?'), 'Escalate'))
    expect(await screen.findByText('This loan was already escalated.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Escalate to a formal notice?' })).toBeInTheDocument()
  })

  it('buttons stay disabled until the list has refetched', async () => {
    const refetching = gate()
    let served = 0
    let current = THREE
    mockFetch({
      'GET /admin/attention': async () => {
        if (++served > 1) await refetching.promise
        return json(200, current)
      },
      'POST /admin/loans/l3/remind': () => {
        const reminded = noticed(SAPIENS, justNow('reminder'))
        current = queue([CLEAN_CODE, NETWORKS, reminded])
        return json(200, reminded)
      },
    })
    renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Send reminder'))
    const dialog = dialogOf('Send an overdue reminder?')
    await userEvent.click(confirmOf(dialog, 'Send reminder'))

    // The write landed and the list is not back yet: the dialog is up and cannot be confirmed again,
    // and every action on every card behind it is disabled.
    await screen.findByText('Reminder sent.')
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(confirmOf(dialog, 'Send reminder')).toBeDisabled()
    const cards: [string, string[]][] = [
      ['Clean Code — 3 days overdue', ['Send reminder', 'Escalate']],
      ['Computer Networks — 2 days overdue', ['Send reminder']],
      [SAPIENS_SUMMARY, ['Send reminder', 'Escalate']],
    ]
    for (const [summary, names] of cards) {
      for (const name of names) expect(buttonOf(summary, name)).toBeDisabled()
    }

    refetching.open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    for (const [summary, names] of cards) {
      for (const name of names) expect(buttonOf(summary, name)).toBeEnabled()
    }
    expect(inCard(SAPIENS_SUMMARY).getByText('₹10 so far. Reminded just now · emailed')).toBeInTheDocument()
  })

  it('a second click in flight sends nothing', async () => {
    const saving = gate()
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, THREE),
      'POST /admin/loans/l3/remind': async () => {
        await saving.promise
        return json(200, noticed(SAPIENS, justNow('reminder')))
      },
    })
    renderPage()
    await screen.findByText(SAPIENS_SUMMARY)
    await userEvent.click(buttonOf(SAPIENS_SUMMARY, 'Send reminder'))
    const dialog = dialogOf('Send an overdue reminder?')

    // A double click on the confirm button is one write.
    await userEvent.dblClick(confirmOf(dialog, 'Send reminder'))
    expect(writes(fetch)).toHaveLength(1)
    expect(confirmOf(dialog, 'Send reminder')).toBeDisabled()

    // Another card's buttons are off while it is in flight, so no second dialog opens and no second write is sent.
    await userEvent.click(buttonOf('Clean Code — 3 days overdue', 'Send reminder'))
    await userEvent.click(buttonOf('Clean Code — 3 days overdue', 'Escalate'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    saving.open()
    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
  })
})
