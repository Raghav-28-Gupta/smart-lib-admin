import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AttentionPage from '@/app/(console)/attention/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { AttentionItem, AttentionQueue, FineDisputeItem, LastNotice, OverdueItem, ReportItem } from '@/lib/attention'
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

// A student's dispute of a fine. The queue item's id differs from the dispute's own id on purpose: a write must name the
// dispute (and the fine) from `dispute`, never the item.
function dispute(
  disputeId: string, student: AttentionItem['student'], item: string, days: number, amount: number, studentReason: string,
  reason: FineDisputeItem['dispute']['fine']['reason'] = 'overdue', fineId = `f-${disputeId}`,
): FineDisputeItem {
  return {
    id: `item-${disputeId}`, kind: 'fine_dispute', student, waitingSince: daysAgoIso(days),
    dispute: { disputeId, studentReason, fine: { id: fineId, item, reason, amount, originalAmount: amount, status: 'outstanding' } },
  }
}

// A student's problem report on a copy (reported when it was returned) or on a resource. The item's id is the report's id,
// which is what the confirm and dismiss routes take.
function copyReport(
  reportId: string, student: AttentionItem['student'], days: number, category: string, note: string | null,
  copy: { id: string; barcode: string; title: string } = { id: 'c1', barcode: 'SL-000123', title: 'Clean Code' },
): ReportItem {
  return {
    id: reportId, kind: 'report', student, waitingSince: daysAgoIso(days),
    report: { reportId, target: 'copy', category, note, copy },
  }
}

function resourceReport(
  reportId: string, student: AttentionItem['student'], days: number, category: string, note: string | null,
  resource: { id: string; name: string } = { id: 'res1', name: 'Group Room 201' },
): ReportItem {
  return {
    id: reportId, kind: 'report', student, waitingSince: daysAgoIso(days),
    report: { reportId, target: 'resource', category, note, resource },
  }
}

// Oldest waiting first, as the server answers.
const CLEAN_CODE =overdue('l1', ADITI, 'Clean Code', 3, 30, { kind: 'reminder', at: daysAgoIso(2), emailStatus: 'sent' })
const NETWORKS = overdue('l2', ROHAN, 'Computer Networks', 2, 20, { kind: 'escalation', at: daysAgoIso(1), emailStatus: 'skipped' }, true)
const SAPIENS = overdue('l3', MEERA, 'Sapiens', 1, 10)

const queue = (items: AttentionItem[], over: Partial<AttentionQueue> = {}): AttentionQueue => ({
  items,
  counts: {
    all: items.length,
    overdue: items.filter((i) => i.kind === 'overdue').length,
    fine_dispute: items.filter((i) => i.kind === 'fine_dispute').length,
    report: items.filter((i) => i.kind === 'report').length,
  },
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

  it('an item of a kind this console does not know (a newer server) is left out: the page still renders, and the known items show', async () => {
    // Spec section 2: the queue is built so that a kind can be added later, and the backend deploys before this console.
    const unknown = {
      id: 'n1', kind: 'no_show_dispute', student: ROHAN, waitingSince: daysAgoIso(2), noShow: { bookingId: 'b1' },
    } as unknown as AttentionItem
    mockFetch({ 'GET /admin/attention': () => json(200, queue([CLEAN_CODE, unknown, SAPIENS])) })
    renderPage()

    expect(await screen.findByText('Clean Code — 3 days overdue')).toBeInTheDocument()
    expect(screen.getByText('Sapiens — 1 day overdue')).toBeInTheDocument()
    expect(screen.getAllByText(/ days? overdue$/)).toHaveLength(2)
    expect(screen.queryByText("Couldn't load the queue")).toBeNull()
    // The counts are the server's, so the unknown item still counts in All (and in the sidebar badge, which reads the same number).
    expect(chip('All (3)')).toBeInTheDocument()
    expect(chip('Overdue follow-ups (2)')).toBeInTheDocument()
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

// Shared by the overdue and the fine dispute actions below.
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

describe('Needs attention overdue actions', () => {
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

describe('Needs attention fine disputes', () => {
  const WORDS = 'I returned it on Monday; the desk never scanned it.'
  // Oldest waiting first: D3 (3 days), D1 (2 days), D2 (1 day).
  const D1 = dispute('d1', ROHAN, 'Clean Code', 2, 150, WORDS, 'overdue', 'f1')
  const D2 = dispute('d2', MEERA, 'Group Room 201', 1, 40, 'I cancelled in the app, on time.', 'no_show', 'f2')
  const D3 = dispute('d3', ADITI, 'Sapiens', 3, 250, 'The book was stolen from my bag.', 'lost', 'f3')
  const D1_SUMMARY = 'Disputes ₹150 Overdue fine on Clean Code'
  const D2_SUMMARY = 'Disputes ₹40 No-show fine on Group Room 201'
  const D3_SUMMARY = 'Disputes ₹250 Lost book fine on Sapiens'
  const UPHOLD_BODY = `The dispute is closed and the fine stands. ${D1_SUMMARY}.`
  const CLEAN_CODE_SUMMARY = 'Clean Code — 3 days overdue'

  const openAdjust = async (summary = D1_SUMMARY) => {
    await userEvent.click(buttonOf(summary, 'Waive / adjust'))
    return dialogOf('Waive or adjust this fine')
  }
  const openUphold = async (summary = D1_SUMMARY) => {
    await userEvent.click(buttonOf(summary, 'Uphold fine'))
    return dialogOf('Uphold this fine?')
  }
  /** Types a new amount (replacing the one shown) and a reason into the adjust dialog. */
  async function fillAdjust(dialog: HTMLElement, amount: string, reason: string) {
    const box = within(dialog).getByLabelText('New amount (₹)')
    await userEvent.clear(box)
    await userEvent.type(box, amount)
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), reason)
  }
  const noteOf = (dialog: HTMLElement) => within(dialog).getByLabelText('Note (optional)')

  it("a dispute card shows the tag, summary and the student's words", async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([D3, D1, D2])) })
    renderPage()
    await screen.findByText(D1_SUMMARY)

    const card = inCard(D1_SUMMARY)
    expect(card.getByText('Fine dispute')).toHaveClass('tag')
    expect(card.queryByText('Overdue follow-up')).toBeNull()
    expect(card.getByText('waiting 2 days')).toBeInTheDocument()
    expect(card.getByText(WORDS)).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Waive / adjust' })).toBeEnabled()
    expect(card.getByRole('button', { name: 'Uphold fine' })).toBeEnabled()
    // None of an overdue card's actions.
    expect(card.queryByRole('button', { name: 'Send reminder' })).toBeNull()
    expect(card.queryByRole('button', { name: 'Escalate' })).toBeNull()

    // The reason the fine was charged for, worded as the Fines page words it.
    expect(screen.getByText(D2_SUMMARY)).toBeInTheDocument()
    expect(screen.getByText(D3_SUMMARY)).toBeInTheDocument()
    expect(screen.getAllByText('Fine dispute')).toHaveLength(3)
    const summaries = screen.getAllByText(/^Disputes ₹/).map((el) => el.textContent)
    expect(summaries).toEqual([D3_SUMMARY, D1_SUMMARY, D2_SUMMARY])
  })

  it("shows the student's words as text, never markup, and a long reason in full: no clamp, no tooltip standing in for the rest", async () => {
    const markup = '<img src=x onerror="alert(1)"> <b>please</b> reconsider'
    const long = `${'The desk never scanned it. '.repeat(11)}End.`.slice(0, 300)
    const tricky = dispute('d4', ROHAN, 'Networks', 2, 60, markup)
    const wordy = dispute('d5', MEERA, 'Compilers', 1, 90, long)
    mockFetch({ 'GET /admin/attention': () => json(200, queue([tricky, wordy])) })
    const { container } = renderPage()
    await screen.findByText('Disputes ₹60 Overdue fine on Networks')

    expect(within(cardOf('Disputes ₹60 Overdue fine on Networks')).getByText(markup)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()

    // All 300 characters are in the card's text, and nothing on the line hides any of it: a dispute is read before it is decided.
    expect(long).toHaveLength(300)
    const words = within(cardOf('Disputes ₹90 Overdue fine on Compilers')).getByText(long)
    expect(words).toHaveTextContent(long)
    expect(words.style.getPropertyValue('-webkit-line-clamp')).toBe('')
    expect(words.style.display).not.toBe('-webkit-box')
    expect(words.style.overflow).not.toBe('hidden')
    expect(words).not.toHaveAttribute('title')
  })

  it("the Uphold dialog shows the student's words in full, as text, so the dispute is not closed unread", async () => {
    const long = `${'The desk never scanned it. '.repeat(11)}End.`.slice(0, 300)
    const markup = '<img src=x onerror="alert(1)"> <b>please</b> reconsider'
    const wordy = dispute('d5', MEERA, 'Compilers', 1, 90, long)
    const tricky = dispute('d4', ROHAN, 'Networks', 2, 60, markup)
    mockFetch({ 'GET /admin/attention': () => json(200, queue([tricky, wordy])) })
    renderPage()
    await screen.findByText('Disputes ₹90 Overdue fine on Compilers')

    const dialog = await openUphold('Disputes ₹90 Overdue fine on Compilers')
    expect(within(dialog).getByText(long)).toBeInTheDocument()
    expect(dialog).toHaveTextContent('The dispute is closed and the fine stands. Disputes ₹90 Overdue fine on Compilers.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    const other = await openUphold('Disputes ₹60 Overdue fine on Networks')
    expect(within(other).getByText(markup)).toBeInTheDocument()
    expect(other.querySelector('img')).toBeNull()
    expect(other.querySelector('b')).toBeNull()
    // Another dispute's words are not here.
    expect(within(other).queryByText(long)).toBeNull()
  })

  it("the queue's adjust dialog shows the student's words in full, above the amount and reason the librarian types", async () => {
    const long = `${'The desk never scanned it. '.repeat(11)}End.`.slice(0, 300)
    const wordy = dispute('d5', MEERA, 'Compilers', 1, 90, long)
    mockFetch({ 'GET /admin/attention': () => json(200, queue([wordy, D1])) })
    renderPage()
    await screen.findByText('Disputes ₹90 Overdue fine on Compilers')

    const dialog = await openAdjust('Disputes ₹90 Overdue fine on Compilers')
    expect(within(dialog).getByText(long)).toBeInTheDocument()
    // The dialog's own wording is as it was, and the words are not the reason field's text.
    expect(dialog).toHaveTextContent(
      "Meera Iyer — Compilers, currently ₹90. Enter the new amount (₹0 fully waives it) and a reason; this is recorded on the student's fine history.",
    )
    expect(within(dialog).getByLabelText('Reason (required)')).toHaveValue('')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // Another dispute's dialog shows its own words only.
    const second = await openAdjust()
    expect(within(second).getByText(WORDS)).toBeInTheDocument()
    expect(within(second).queryByText(long)).toBeNull()
  })

  it('the student link carries from=attention', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([D1])) })
    renderPage()
    await screen.findByText(D1_SUMMARY)
    expect(inCard(D1_SUMMARY).getByRole('link', { name: 'Rohan Verma' })).toHaveAttribute('href', '/students/s2?from=attention')
  })

  it('the Fine disputes chip counts them and shows only them', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([D3, CLEAN_CODE, D1, SAPIENS, D2])) })
    const { unmount } = renderPage()
    await screen.findByText(D1_SUMMARY)
    expect(chip('All (5)')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Overdue follow-ups (2)')).toBeInTheDocument()
    expect(chip('Fine disputes (3)')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Maintenance flags (0)')).toBeInTheDocument()
    expect(screen.getByText(CLEAN_CODE_SUMMARY)).toBeInTheDocument()

    await userEvent.click(chip('Fine disputes (3)'))
    expect(chip('Fine disputes (3)')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText(/^Disputes ₹/)).toHaveLength(3)
    expect(screen.queryByText(CLEAN_CODE_SUMMARY)).toBeNull()
    expect(screen.queryByText('Sapiens — 1 day overdue')).toBeNull()

    // The other chip hides them again.
    await userEvent.click(chip('Overdue follow-ups (2)'))
    expect(screen.queryByText(D1_SUMMARY)).toBeNull()
    expect(screen.getByText(CLEAN_CODE_SUMMARY)).toBeInTheDocument()

    unmount()
    nav.search = 'type=fine_dispute'
    renderPage()
    expect(await screen.findByRole('button', { name: 'Fine disputes (3)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(D3_SUMMARY)).toBeInTheDocument()
    expect(screen.queryByText(CLEAN_CODE_SUMMARY)).toBeNull()
  })

  it('a chip with no cards says so whichever kind is queued, and the empty state is only for an empty queue', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([D1])) })
    const only = renderPage()
    await screen.findByText(D1_SUMMARY)
    await userEvent.click(chip('Overdue follow-ups (0)'))
    expect(screen.getByText('No overdue follow-ups waiting')).toBeInTheDocument()
    expect(screen.queryByText("You're all caught up")).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByText(D1_SUMMARY)).toBeInTheDocument()
    only.unmount()

    mockFetch({ 'GET /admin/attention': () => json(200, queue([SAPIENS])) })
    renderPage()
    await screen.findByText('Sapiens — 1 day overdue')
    await userEvent.click(chip('Fine disputes (0)'))
    expect(screen.getByText('No fine disputes waiting')).toBeInTheDocument()
    expect(screen.queryByText("You're all caught up")).toBeNull()
  })

  it('Waive / adjust opens the shared adjust dialog and sends the dispute id', async () => {
    let current = queue([D1, D2])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/fines/f1/adjust': () => {
        current = queue([D2])
        return json(200, { id: 'f1' })
      },
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)

    const dialog = await openAdjust()
    expect(dialog).toHaveTextContent(
      "Rohan Verma — Clean Code, currently ₹150. Enter the new amount (₹0 fully waives it) and a reason; this is recorded on the student's fine history.",
    )
    expect(within(dialog).getByLabelText('New amount (₹)')).toHaveValue(150)
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(writes(fetch)).toHaveLength(0)

    await fillAdjust(dialog, '100', '  Receipt shown  ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Fine adjusted.')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/fines\/f1\/adjust$/)
    // The fine's id in the path, the dispute's in the body: the server closes that dispute with the adjustment.
    expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({ amount: 100, reason: 'Receipt shown', disputeId: 'd1' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(D1_SUMMARY)).toBeNull()
    expect(screen.getByText(D2_SUMMARY)).toBeInTheDocument()
    expect(chip('Fine disputes (1)')).toBeInTheDocument()
  })

  it('waiving a disputed fine (amount 0) sends 0 with the dispute id and toasts "Fine waived."', async () => {
    let current = queue([D1])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/fines/f1/adjust': () => {
        current = queue([])
        return json(200, { id: 'f1' })
      },
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)

    const dialog = await openAdjust()
    await fillAdjust(dialog, '0', 'Receipt shown')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Fine waived.')).toBeInTheDocument()
    expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({ amount: 0, reason: 'Receipt shown', disputeId: 'd1' })
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })

  it('Cancel in the adjust dialog and in the uphold dialog sends nothing', async () => {
    const fetch = mockFetch({ 'GET /admin/attention': () => json(200, queue([D1])) })
    renderPage()
    await screen.findByText(D1_SUMMARY)

    const adjust = await openAdjust()
    await userEvent.click(within(adjust).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(buttonOf(D1_SUMMARY, 'Waive / adjust')).toHaveFocus()

    const uphold = await openUphold()
    await userEvent.click(within(uphold).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes(fetch)).toHaveLength(0)
  })

  it('Uphold fine posts the note, toasts, and the card leaves after the refetch', async () => {
    let current = queue([D1, D2])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/disputes/d1/uphold': () => {
        current = queue([D2])
        return json(200, { id: 'd1' })
      },
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)
    expect(chip('Fine disputes (2)')).toBeInTheDocument()

    const dialog = await openUphold()
    expect(dialog).toHaveTextContent(UPHOLD_BODY)
    const note = noteOf(dialog)
    expect(note).toHaveAttribute('maxlength', '300')
    expect(note).toHaveFocus()
    expect(confirmOf(dialog, 'Uphold fine')).toBeEnabled() // the note is optional
    expect(writes(fetch)).toHaveLength(0)

    await userEvent.type(note, '  The receipt is for a different book  ')
    await userEvent.click(confirmOf(dialog, 'Uphold fine'))

    expect(await screen.findByText('Fine upheld.')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)
    // The dispute's id in the path (not the queue item's), the note trimmed.
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/disputes\/d1\/uphold$/)
    expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({ note: 'The receipt is for a different book' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(D1_SUMMARY)).toBeNull()
    expect(screen.getByText(D2_SUMMARY)).toBeInTheDocument()
    expect(chip('Fine disputes (1)')).toBeInTheDocument()
    expect(chip('All (1)')).toBeInTheDocument()
  })

  it('a blank uphold note sends an empty body', async () => {
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([D1])),
      'POST /admin/disputes/d1/uphold': () => json(200, { id: 'd1' }),
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)
    const dialog = await openUphold()
    await userEvent.type(noteOf(dialog), '   ')
    await userEvent.click(confirmOf(dialog, 'Uphold fine'))
    expect(await screen.findByText('Fine upheld.')).toBeInTheDocument()
    expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({})
  })

  it("a 409 on either shows the server's message, keeps the dialog and refetches", async () => {
    // Uphold: someone else resolved the dispute meanwhile (409), or it is gone (404). The refetch drops the card; the
    // dialog stays up with the note until the librarian cancels.
    const upholds: [number, string][] = [
      [409, 'This dispute was already resolved.'],
      [404, 'Dispute not found'],
    ]
    for (const [status, message] of upholds) {
      let current = queue([D1, D2])
      const fetch = mockFetch({
        'GET /admin/attention': () => json(200, current),
        'POST /admin/disputes/d1/uphold': () => {
          current = queue([D2])
          return json(status, { error: message })
        },
      })
      const view = renderPage()
      await screen.findByText(D1_SUMMARY)
      const dialog = await openUphold()
      await userEvent.type(noteOf(dialog), 'The receipt is for a different book')
      const confirm = confirmOf(dialog, 'Uphold fine')
      await userEvent.click(confirm)

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.queryByText('Fine upheld.')).toBeNull()
      await waitFor(() => expect(reads(fetch)).toHaveLength(2))
      await waitFor(() => expect(screen.queryByText(D1_SUMMARY)).toBeNull())
      expect(screen.getByRole('dialog', { name: 'Uphold this fine?' })).toBe(dialog)
      expect(noteOf(dialog)).toHaveValue('The receipt is for a different book')
      await waitFor(() => expect(confirm).toBeEnabled())
      expect(confirm).toHaveFocus()
      expect(writes(fetch)).toHaveLength(1)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      view.unmount()
    }

    // Waive / adjust: the queue always names the dispute it read, so the server can only say that dispute was resolved
    // meanwhile (409), or that the fine is gone (404). Either way the refetch drops the card, and the dialog keeps the typed
    // amount and reason, and the student's words, until the librarian cancels: a closed dispute cannot be adjusted again.
    const adjusts: [number, string][] = [
      [409, 'This dispute was already resolved.'],
      [404, 'Fine not found'],
    ]
    for (const [status, message] of adjusts) {
      let current = queue([D1, D2])
      const fetch = mockFetch({
        'GET /admin/attention': () => json(200, current),
        'POST /admin/fines/f1/adjust': () => {
          current = queue([D2])
          return json(status, { error: message })
        },
      })
      const view = renderPage()
      await screen.findByText(D1_SUMMARY)
      const dialog = await openAdjust()
      await fillAdjust(dialog, '100', 'Receipt shown')
      const save = within(dialog).getByRole('button', { name: 'Save' })
      await userEvent.click(save)

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.queryByText('Fine adjusted.')).toBeNull()
      await waitFor(() => expect(reads(fetch)).toHaveLength(2))
      await waitFor(() => expect(screen.queryByText(D1_SUMMARY)).toBeNull())
      expect(screen.getByRole('dialog', { name: 'Waive or adjust this fine' })).toBe(dialog)
      expect(within(dialog).getByLabelText('New amount (₹)')).toHaveValue(100)
      expect(within(dialog).getByLabelText('Reason (required)')).toHaveValue('Receipt shown')
      expect(within(dialog).getByText(WORDS)).toBeInTheDocument()
      await waitFor(() => expect(save).toBeEnabled())
      expect(save).toHaveFocus()
      expect(writes(fetch)).toHaveLength(1)
      expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({ amount: 100, reason: 'Receipt shown', disputeId: 'd1' })
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      view.unmount()
    }
  })

  it('a write that never reaches the server toasts the network message and keeps the dialog and its note', async () => {
    let reachable = false
    let current = queue([D1, D2])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/disputes/d1/uphold': () => {
        if (!reachable) throw new TypeError('Failed to fetch')
        current = queue([D2])
        return json(200, { id: 'd1' })
      },
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)
    const dialog = await openUphold()
    await userEvent.type(noteOf(dialog), 'The receipt is for a different book')
    const confirm = confirmOf(dialog, 'Uphold fine')
    await userEvent.click(confirm)

    expect(await screen.findByText("Can't reach the SmartLib server. Try again in a minute.")).toBeInTheDocument()
    expect(screen.queryByText('Fine upheld.')).toBeNull()
    await waitFor(() => expect(reads(fetch)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Uphold this fine?' })).toBe(dialog)
    expect(noteOf(dialog)).toHaveValue('The receipt is for a different book')
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(confirm).toHaveFocus()
    expect(screen.getByText(D1_SUMMARY)).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)

    // The request never arrived, so nothing was decided: once the network is back the same dialog sends it.
    reachable = true
    await userEvent.click(confirm)
    expect(await screen.findByText('Fine upheld.')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(2)
    expect(JSON.parse(writes(fetch)[1][1]!.body as string)).toEqual({ note: 'The receipt is for a different book' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('buttons on every card stay disabled until the list has refetched', async () => {
    const refetching = gate()
    let served = 0
    let current = queue([CLEAN_CODE, D1, D2])
    mockFetch({
      'GET /admin/attention': async () => {
        if (++served > 1) await refetching.promise
        return json(200, current)
      },
      'POST /admin/disputes/d1/uphold': () => {
        current = queue([CLEAN_CODE, D2])
        return json(200, { id: 'd1' })
      },
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)
    const dialog = await openUphold()
    await userEvent.click(confirmOf(dialog, 'Uphold fine'))

    // The write landed and the list is not back yet: the dialog cannot be confirmed again, and every action on every
    // card behind it, overdue or dispute, is off.
    await screen.findByText('Fine upheld.')
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(confirmOf(dialog, 'Uphold fine')).toBeDisabled()
    const cards: [string, string[]][] = [
      [CLEAN_CODE_SUMMARY, ['Send reminder', 'Escalate']],
      [D1_SUMMARY, ['Waive / adjust', 'Uphold fine']],
      [D2_SUMMARY, ['Waive / adjust', 'Uphold fine']],
    ]
    for (const [summary, names] of cards) {
      for (const name of names) expect(buttonOf(summary, name)).toBeDisabled()
    }

    refetching.open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(D1_SUMMARY)).toBeNull()
    for (const [summary, names] of cards.filter(([summary]) => summary !== D1_SUMMARY)) {
      for (const name of names) expect(buttonOf(summary, name)).toBeEnabled()
    }
  })

  it('a second click in flight sends nothing: Uphold fine is one write, and the other cards stay off', async () => {
    const saving = gate()
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([CLEAN_CODE, D1, D2])),
      'POST /admin/disputes/d1/uphold': async () => {
        await saving.promise
        return json(200, { id: 'd1' })
      },
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)

    const dialog = await openUphold()
    await userEvent.dblClick(confirmOf(dialog, 'Uphold fine'))
    expect(writes(fetch)).toHaveLength(1)
    expect(confirmOf(dialog, 'Uphold fine')).toBeDisabled()

    // Another card's buttons are off while it is in flight, so no second dialog opens and no second write is sent.
    await userEvent.click(buttonOf(D2_SUMMARY, 'Waive / adjust'))
    await userEvent.click(buttonOf(D2_SUMMARY, 'Uphold fine'))
    await userEvent.click(buttonOf(CLEAN_CODE_SUMMARY, 'Send reminder'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    saving.open()
    expect(await screen.findByText('Fine upheld.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
  })

  it('a second click in flight sends nothing: Save is one write, and stays off until the write has landed', async () => {
    const saving = gate()
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([D1])),
      'POST /admin/fines/f1/adjust': async () => {
        await saving.promise
        return json(200, { id: 'f1' })
      },
    })
    renderPage()
    await screen.findByText(D1_SUMMARY)

    const dialog = await openAdjust()
    await fillAdjust(dialog, '100', 'Receipt shown')
    const save = within(dialog).getByRole('button', { name: 'Save' })
    await userEvent.dblClick(save)
    expect(writes(fetch)).toHaveLength(1)
    expect(save).toBeDisabled()
    // The dialog is still up while the write is in flight.
    expect(screen.getByRole('dialog')).toBe(dialog)

    saving.open()
    expect(await screen.findByText('Fine adjusted.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
  })
})

describe('Needs attention problem reports', () => {
  const NOTE = 'The cover is torn off and pages 40 to 52 are loose.'
  const PROJECTOR = 'The projector shows no picture.'
  // Oldest waiting first: R1 (3 days), R2 (2 days), R3 (1 day).
  const R1 = copyReport('r1', ROHAN, 3, 'damaged', NOTE)
  const R2 = copyReport('r2', MEERA, 2, 'missing_pages', 'Pages 10 to 20 are missing.', { id: 'c2', barcode: 'SL-000456', title: 'Sapiens' })
  const R3 = resourceReport('r3', ADITI, 1, 'not_working', PROJECTOR)
  const R1_SUMMARY = 'Copy SL-000123 of Clean Code, reported at return: Damaged'
  const R2_SUMMARY = 'Copy SL-000456 of Sapiens, reported at return: Missing pages'
  const R3_SUMMARY = 'Group Room 201 — Not working'
  const CLEAN_CODE_SUMMARY = 'Clean Code — 3 days overdue'
  const FLAG_BODY = `${R1_SUMMARY}. It will be removed from what students see as available. Confirming never charges the student.`
  const OFFLINE_BODY = 'Group Room 201 will be hidden from the student booking calendar until brought back online.'

  const openFlag = async (summary = R1_SUMMARY) => {
    await userEvent.click(buttonOf(summary, 'Confirm & flag copy'))
    return dialogOf('Flag this copy for maintenance?')
  }
  const openOffline = async (summary = R3_SUMMARY) => {
    await userEvent.click(buttonOf(summary, 'Take offline'))
    return dialogOf('Take this resource offline?')
  }
  const openDismiss = async (summary: string) => {
    await userEvent.click(buttonOf(summary, 'Dismiss'))
    return dialogOf('Dismiss this report?')
  }
  const reasonOf = (dialog: HTMLElement) => within(dialog).getByRole('combobox', { name: 'Reason' })
  const noteOf = (dialog: HTMLElement) => within(dialog).getByLabelText('Note (optional)')
  const bodyOf = (fetch: Fetch, index = 0) => JSON.parse(writes(fetch)[index][1]!.body as string)

  it("a copy report card shows the tag, barcode, title, category and the student's note", async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([R1, R2, R3])) })
    renderPage()
    await screen.findByText(R1_SUMMARY)

    const card = inCard(R1_SUMMARY)
    // The canvas's neutral tag, not the accent one the overdue and fine dispute cards carry.
    expect(card.getByText('Maintenance flag')).toHaveClass('tag', 'tag-neutral')
    expect(card.getByText('Maintenance flag')).not.toHaveClass('tag-accent')
    expect(card.queryByText('Fine dispute')).toBeNull()
    expect(card.queryByText('Overdue follow-up')).toBeNull()
    expect(card.getByRole('link', { name: 'Rohan Verma' })).toHaveAttribute('href', '/students/s2?from=attention')
    expect(card.getByText('waiting 3 days')).toBeInTheDocument()
    expect(card.getByText(NOTE)).toHaveAttribute('title', NOTE)
    expect(card.getByRole('button', { name: 'Confirm & flag copy' })).toBeEnabled()
    expect(card.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
    // A copy has no Take offline, and none of the other cards' actions.
    expect(card.queryByRole('button', { name: 'Take offline' })).toBeNull()
    expect(card.queryByRole('button', { name: 'Send reminder' })).toBeNull()
    expect(card.queryByRole('button', { name: 'Waive / adjust' })).toBeNull()

    // Missing pages is worded as two words, and the cards keep the order the server sent.
    expect(screen.getByText(R2_SUMMARY)).toBeInTheDocument()
    expect(screen.getAllByText('Maintenance flag')).toHaveLength(3)
    const summaries = screen.getAllByText(/reported at return|Not working$/).map((el) => el.textContent)
    expect(summaries).toEqual([R1_SUMMARY, R2_SUMMARY, R3_SUMMARY])
  })

  it('a resource report card reads "<resource> — <category>" with the note, and offers Take offline and Dismiss', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([R3])) })
    renderPage()
    await screen.findByText(R3_SUMMARY)

    const card = inCard(R3_SUMMARY)
    expect(card.getByText('Maintenance flag')).toHaveClass('tag', 'tag-neutral')
    expect(card.getByRole('link', { name: 'Aditi Sharma' })).toHaveAttribute('href', '/students/s1?from=attention')
    expect(card.getByText('waiting 1 day')).toBeInTheDocument()
    expect(card.getByText(PROJECTOR)).toHaveAttribute('title', PROJECTOR)
    expect(card.getByRole('button', { name: 'Take offline' })).toBeEnabled()
    expect(card.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
    expect(card.queryByRole('button', { name: 'Confirm & flag copy' })).toBeNull()
  })

  it('words every category as the card does, and shows one this console does not know as the server named it, capitalized', async () => {
    const seat = (id: string, category: string, name: string) => resourceReport(id, ADITI, 5, category, null, { id: `res-${id}`, name })
    mockFetch({
      'GET /admin/attention': () =>
        json(200, queue([
          seat('a', 'not_working', 'Seat 1'), seat('b', 'dirty', 'Seat 2'), seat('c', 'other', 'Seat 3'),
          seat('d', 'wrong_spot', 'Seat 4'), seat('e', 'constructor', 'Seat 5'),
          copyReport('f', ROHAN, 5, 'other', null, { id: 'c9', barcode: 'SL-000999', title: 'Algorithms' }),
        ])),
    })
    renderPage()
    await screen.findByText('Seat 1 — Not working')
    for (const summary of [
      'Seat 2 — Dirty', 'Seat 3 — Other', 'Seat 4 — Wrong_spot', 'Seat 5 — Constructor',
      'Copy SL-000999 of Algorithms, reported at return: Other',
    ]) {
      expect(screen.getByText(summary)).toBeInTheDocument()
    }
    // A report without a note has no detail line, and still has its actions.
    expect(inCard('Seat 1 — Not working').getByRole('button', { name: 'Dismiss' })).toBeEnabled()
  })

  it("shows the student's note as text, never markup, and clamps a long note with the whole text in the tooltip", async () => {
    const markup = '<img src=x onerror="alert(1)"> <b>please</b> take it out'
    const long = `${'The pages are loose. '.repeat(15)}End.`.slice(0, 300)
    const tricky = copyReport('r4', ROHAN, 2, 'damaged', markup, { id: 'c4', barcode: 'SL-000004', title: 'Networks' })
    const wordy = resourceReport('r5', MEERA, 1, 'dirty', long, { id: 'res5', name: 'Study Pod 5' })
    mockFetch({ 'GET /admin/attention': () => json(200, queue([tricky, wordy])) })
    const { container } = renderPage()
    await screen.findByText('Copy SL-000004 of Networks, reported at return: Damaged')

    expect(within(cardOf('Copy SL-000004 of Networks, reported at return: Damaged')).getByText(markup)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()

    const clamped = within(cardOf('Study Pod 5 — Dirty')).getByText(long)
    expect(clamped).toHaveAttribute('title', long)
    expect(clamped.style.getPropertyValue('-webkit-line-clamp')).toBe('2')
  })

  it("the Flag and Dismiss dialogs show the student's note in full, as text, and say nothing when there is none", async () => {
    // The card cuts a long note at two lines, so the dialogs a librarian decides in repeat it.
    const markup = '<img src=x onerror="alert(1)"> <b>please</b> take it out'
    const long = `${'The pages are loose. '.repeat(15)}End.`.slice(0, 300)
    const wordy = copyReport('r4', ROHAN, 2, 'damaged', long, { id: 'c4', barcode: 'SL-000004', title: 'Networks' })
    const tricky = resourceReport('r5', MEERA, 1, 'dirty', markup, { id: 'res5', name: 'Study Pod 5' })
    const quiet = resourceReport('r8', ADITI, 1, 'other', null, { id: 'res8', name: 'Study Pod 8' })
    mockFetch({ 'GET /admin/attention': () => json(200, queue([wordy, tricky, quiet])) })
    renderPage()
    const wordySummary = 'Copy SL-000004 of Networks, reported at return: Damaged'
    await screen.findByText(wordySummary)

    const flag = await openFlag(wordySummary)
    expect(within(flag).getByText(long)).toBeInTheDocument()
    expect(within(flag).getByText("The student's note")).toBeInTheDocument()
    await userEvent.click(within(flag).getByRole('button', { name: 'Cancel' }))

    const dismissCopy = await openDismiss(wordySummary)
    expect(within(dismissCopy).getByText(long)).toBeInTheDocument()
    await userEvent.click(within(dismissCopy).getByRole('button', { name: 'Cancel' }))

    const dismissResource = await openDismiss('Study Pod 5 — Dirty')
    expect(within(dismissResource).getByText(markup)).toBeInTheDocument()
    expect(dismissResource.querySelector('img')).toBeNull()
    expect(dismissResource.querySelector('b')).toBeNull()
    expect(within(dismissResource).queryByText(long)).toBeNull()
    await userEvent.click(within(dismissResource).getByRole('button', { name: 'Cancel' }))

    // A report without a note has no empty block.
    const dismissQuiet = await openDismiss('Study Pod 8 — Other')
    expect(within(dismissQuiet).queryByText("The student's note")).toBeNull()
  })

  it('the Maintenance flags chip counts them and shows only them, and ?type=report selects it', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([R1, CLEAN_CODE, R2, SAPIENS, R3])) })
    const { unmount } = renderPage()
    await screen.findByText(R1_SUMMARY)
    expect(chip('All (5)')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Overdue follow-ups (2)')).toBeInTheDocument()
    expect(chip('Fine disputes (0)')).toBeInTheDocument()
    expect(chip('Maintenance flags (3)')).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(chip('Maintenance flags (3)'))
    expect(chip('Maintenance flags (3)')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Maintenance flag')).toHaveLength(3)
    expect(screen.queryByText(CLEAN_CODE_SUMMARY)).toBeNull()
    expect(screen.queryByText('Sapiens — 1 day overdue')).toBeNull()

    // The other chip hides them again.
    await userEvent.click(chip('Overdue follow-ups (2)'))
    expect(screen.queryByText(R1_SUMMARY)).toBeNull()
    expect(screen.queryByText(R3_SUMMARY)).toBeNull()
    expect(screen.getByText(CLEAN_CODE_SUMMARY)).toBeInTheDocument()

    unmount()
    nav.search = 'type=report'
    renderPage()
    expect(await screen.findByRole('button', { name: 'Maintenance flags (3)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(R2_SUMMARY)).toBeInTheDocument()
    expect(screen.queryByText(CLEAN_CODE_SUMMARY)).toBeNull()
  })

  it('another chip with no cards says so while the Maintenance flags chip keeps its count', async () => {
    mockFetch({ 'GET /admin/attention': () => json(200, queue([R1])) })
    renderPage()
    await screen.findByText(R1_SUMMARY)
    await userEvent.click(chip('Overdue follow-ups (0)'))
    expect(screen.getByText('No overdue follow-ups waiting')).toBeInTheDocument()
    expect(chip('Maintenance flags (1)')).toBeInTheDocument()
    expect(chip('All (1)')).toBeInTheDocument()
  })

  it('Confirm & flag copy opens the dialog: the Reason select, an optional note, and the words that it never charges', async () => {
    const fetch = mockFetch({ 'GET /admin/attention': () => json(200, queue([R1, R3])) })
    renderPage()
    await screen.findByText(R1_SUMMARY)

    const dialog = await openFlag()
    expect(within(dialog).getByText(FLAG_BODY)).toBeInTheDocument()
    const reason = reasonOf(dialog)
    expect(reason).toHaveFocus()
    expect(within(reason).getAllByRole('option').map((o) => o.textContent)).toEqual(['Damaged', 'Missing pages', 'Lost'])
    expect(noteOf(dialog)).toHaveAttribute('maxlength', '300')
    expect(confirmOf(dialog, 'Confirm & flag copy')).toBeEnabled() // the note is optional
    expect(writes(fetch)).toHaveLength(0)

    // Cancel sends nothing and gives focus back to the button that opened it.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(buttonOf(R1_SUMMARY, 'Confirm & flag copy')).toHaveFocus()
    expect(writes(fetch)).toHaveLength(0)
  })

  it("starts the reason at the student's category (damaged and other mean Damaged, missing pages means Missing pages) and never at Lost", async () => {
    const other = copyReport('r6', ROHAN, 2, 'other', 'See the note.', { id: 'c6', barcode: 'SL-000006', title: 'Compilers' })
    const odd = copyReport('r7', MEERA, 1, 'torn_spine', null, { id: 'c7', barcode: 'SL-000007', title: 'Databases' })
    mockFetch({ 'GET /admin/attention': () => json(200, queue([R1, R2, other, odd])) })
    renderPage()
    await screen.findByText(R1_SUMMARY)

    const cases: [string, string][] = [
      [R1_SUMMARY, 'Damaged'],
      [R2_SUMMARY, 'Missing pages'],
      ['Copy SL-000006 of Compilers, reported at return: Other', 'Damaged'],
      ['Copy SL-000007 of Databases, reported at return: Torn_spine', 'Damaged'],
    ]
    for (const [summary, shown] of cases) {
      const dialog = await openFlag(summary)
      expect(reasonOf(dialog)).toHaveDisplayValue(shown)
      expect(reasonOf(dialog)).not.toHaveDisplayValue('Lost')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    }
  })

  it('Confirm & flag copy sends the chosen outcome (Damaged and Missing pages map to maintenance, Lost to lost) and the note', async () => {
    const cases: [string, 'maintenance' | 'lost'][] = [
      ['Damaged', 'maintenance'],
      ['Missing pages', 'maintenance'],
      ['Lost', 'lost'],
    ]
    for (const [reason, outcome] of cases) {
      let current = queue([R1, R3])
      const fetch = mockFetch({
        'GET /admin/attention': () => json(200, current),
        'POST /admin/reports/r1/confirm': () => {
          current = queue([R3])
          return json(200, { id: 'r1' })
        },
      })
      const view = renderPage()
      await screen.findByText(R1_SUMMARY)
      expect(chip('Maintenance flags (2)')).toBeInTheDocument()

      const dialog = await openFlag()
      await userEvent.selectOptions(reasonOf(dialog), reason)
      await userEvent.type(noteOf(dialog), '  Cover torn off  ')
      await userEvent.click(confirmOf(dialog, 'Confirm & flag copy'))

      expect(await screen.findByText('Copy flagged.')).toBeInTheDocument()
      expect(writes(fetch)).toHaveLength(1)
      // The report's id in the path, the outcome and the trimmed note in the body.
      expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/reports\/r1\/confirm$/)
      expect(bodyOf(fetch)).toEqual({ outcome, note: 'Cover torn off' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(screen.queryByText(R1_SUMMARY)).toBeNull())
      expect(screen.getByText(R3_SUMMARY)).toBeInTheDocument()
      expect(chip('Maintenance flags (1)')).toBeInTheDocument()
      view.unmount()
    }
  })

  it('Confirm & flag copy with the reason as it starts sends maintenance, and a blank note sends no note at all', async () => {
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([R1])),
      'POST /admin/reports/r1/confirm': () => json(200, { id: 'r1' }),
    })
    renderPage()
    await screen.findByText(R1_SUMMARY)
    const dialog = await openFlag()
    await userEvent.type(noteOf(dialog), '   ')
    await userEvent.click(confirmOf(dialog, 'Confirm & flag copy'))
    expect(await screen.findByText('Copy flagged.')).toBeInTheDocument()
    expect(writes(fetch)[0][1]!.body).toBe('{"outcome":"maintenance"}')
  })

  it('a resource report offers Take offline with the note prefilled from the report, in the slice 4 dialog', async () => {
    const fetch = mockFetch({ 'GET /admin/attention': () => json(200, queue([R3])) })
    renderPage()
    await screen.findByText(R3_SUMMARY)

    const dialog = await openOffline()
    // The slice 4 dialog's title, text and button; the queue does not know the upcoming bookings, so it does not say.
    expect(within(dialog).getByText(OFFLINE_BODY)).toBeInTheDocument()
    expect(within(dialog).queryByText(/upcoming booking/)).toBeNull()
    const note = noteOf(dialog)
    expect(note).toHaveValue(PROJECTOR)
    expect(note).toHaveAttribute('maxlength', '300')
    expect(note).toHaveFocus()
    expect(confirmOf(dialog, 'Take offline')).toBeEnabled()
    expect(writes(fetch)).toHaveLength(0)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(buttonOf(R3_SUMMARY, 'Take offline')).toHaveFocus()
    expect(writes(fetch)).toHaveLength(0)
  })

  it("Take offline confirms the report with the note as it stands and no outcome (never the resource's own offline route)", async () => {
    let current = queue([R1, R3])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/reports/r3/confirm': () => {
        current = queue([R1])
        return json(200, { id: 'r3' })
      },
    })
    renderPage()
    await screen.findByText(R3_SUMMARY)

    const dialog = await openOffline()
    await userEvent.type(noteOf(dialog), '  Bulb ordered.  ')
    await userEvent.click(confirmOf(dialog, 'Take offline'))

    expect(await screen.findByText('Resource taken offline.')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)
    expect(String(writes(fetch)[0][0])).toMatch(/\/admin\/reports\/r3\/confirm$/)
    // No outcome: the server reads a report on a resource as "take it offline". The prefilled text and the typed text are one note.
    expect(bodyOf(fetch)).toEqual({ note: `${PROJECTOR}  Bulb ordered.` })
    expect('outcome' in bodyOf(fetch)).toBe(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.queryByText(R3_SUMMARY)).toBeNull())
    expect(screen.getByText(R1_SUMMARY)).toBeInTheDocument()
    expect(chip('Maintenance flags (1)')).toBeInTheDocument()
  })

  it('Take offline sends the prefilled note untouched, and an absent or blank note sends an empty body', async () => {
    const quiet = resourceReport('r8', MEERA, 1, 'dirty', null, { id: 'res8', name: 'Study Pod 8' })
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([R3, quiet])),
      'POST /admin/reports/r3/confirm': () => json(200, { id: 'r3' }),
      'POST /admin/reports/r8/confirm': () => json(200, { id: 'r8' }),
    })
    renderPage()
    await screen.findByText(R3_SUMMARY)

    // The student's own words go as they are.
    const first = await openOffline()
    await userEvent.click(confirmOf(first, 'Take offline'))
    expect(await screen.findByText('Resource taken offline.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bodyOf(fetch, 0)).toEqual({ note: PROJECTOR })

    // A report with no note starts with an empty box, and a blank one sends nothing.
    const second = await openOffline('Study Pod 8 — Dirty')
    expect(noteOf(second)).toHaveValue('')
    await userEvent.type(noteOf(second), '   ')
    await userEvent.click(confirmOf(second, 'Take offline'))
    await waitFor(() => expect(writes(fetch)).toHaveLength(2))
    expect(writes(fetch)[1][1]!.body).toBe('{}')
  })

  it('Dismiss sends the note, for a copy report and for a resource report', async () => {
    const reports: [string, string, string][] = [
      [R1_SUMMARY, 'r1', 'The cover was already like that'],
      [R3_SUMMARY, 'r3', 'The projector works now'],
    ]
    for (const [summary, id, text] of reports) {
      let current = queue([R1, R3])
      const fetch = mockFetch({
        'GET /admin/attention': () => json(200, current),
        [`POST /admin/reports/${id}/dismiss`]: () => {
          current = queue([R1, R3].filter((r) => r.id !== id))
          return json(200, { id })
        },
      })
      const view = renderPage()
      await screen.findByText(summary)

      const dialog = await openDismiss(summary)
      // The canvas's sentence, then what the student is told.
      expect(
        within(dialog).getByText(`${summary} will be cleared from the queue with no further action. The student is told no action was needed, with your note if you add one.`),
      ).toBeInTheDocument()
      const note = noteOf(dialog)
      expect(note).toHaveAttribute('maxlength', '300')
      expect(note).toHaveFocus()
      expect(confirmOf(dialog, 'Dismiss')).toBeEnabled() // the note is optional
      expect(writes(fetch)).toHaveLength(0)

      await userEvent.type(note, `  ${text}  `)
      await userEvent.click(confirmOf(dialog, 'Dismiss'))

      expect(await screen.findByText('Report dismissed.')).toBeInTheDocument()
      expect(writes(fetch)).toHaveLength(1)
      expect(String(writes(fetch)[0][0])).toMatch(new RegExp(`/admin/reports/${id}/dismiss$`))
      expect(bodyOf(fetch)).toEqual({ note: text })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(screen.queryByText(summary)).toBeNull())
      expect(chip('Maintenance flags (1)')).toBeInTheDocument()
      view.unmount()
    }
  })

  it('a blank dismiss note sends an empty body, and Cancel sends nothing', async () => {
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([R1])),
      'POST /admin/reports/r1/dismiss': () => json(200, { id: 'r1' }),
    })
    renderPage()
    await screen.findByText(R1_SUMMARY)

    const cancelled = await openDismiss(R1_SUMMARY)
    await userEvent.click(within(cancelled).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes(fetch)).toHaveLength(0)

    const dialog = await openDismiss(R1_SUMMARY)
    await userEvent.type(noteOf(dialog), '   ')
    await userEvent.click(confirmOf(dialog, 'Dismiss'))
    expect(await screen.findByText('Report dismissed.')).toBeInTheDocument()
    expect(writes(fetch)[0][1]!.body).toBe('{}')
  })

  it('a refusal ("This copy is now on loan.") keeps the dialog and what was chosen, toasts the message, and the card stays', async () => {
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([R1, R3])),
      'POST /admin/reports/r1/confirm': () => json(409, { error: 'This copy is now on loan.' }),
    })
    renderPage()
    await screen.findByText(R1_SUMMARY)

    const dialog = await openFlag()
    await userEvent.selectOptions(reasonOf(dialog), 'Lost')
    await userEvent.type(noteOf(dialog), 'Not on the shelf')
    const confirm = confirmOf(dialog, 'Confirm & flag copy')
    await userEvent.click(confirm)

    expect(await screen.findByText('This copy is now on loan.')).toBeInTheDocument()
    expect(screen.queryByText('Copy flagged.')).toBeNull()
    await waitFor(() => expect(reads(fetch)).toHaveLength(2))
    expect(screen.getByRole('dialog', { name: 'Flag this copy for maintenance?' })).toBe(dialog)
    expect(reasonOf(dialog)).toHaveDisplayValue('Lost')
    expect(noteOf(dialog)).toHaveValue('Not on the shelf')
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(confirm).toHaveFocus()
    // The report stays: the librarian can dismiss it, or handle the copy in the Catalogue.
    expect(screen.getByText(R1_SUMMARY)).toBeInTheDocument()
    expect(chip('Maintenance flags (2)')).toBeInTheDocument()
    expect(writes(fetch)).toHaveLength(1)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(R1_SUMMARY)).toBeInTheDocument()
  })

  it('keeps the Take offline and Dismiss dialogs, with their notes, when the report was resolved or removed meanwhile', async () => {
    // A report's write is refused only with 409 "This report was already resolved." or 404 (a resource that is already offline
    // just closes the report). Either way the report is gone from the refetched queue, so there is nothing to send again: the
    // dialog keeps the note until the librarian cancels.
    let current = queue([R1, R3])
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, current),
      'POST /admin/reports/r3/confirm': () => {
        current = queue([R1])
        return json(409, { error: 'This report was already resolved.' })
      },
      'POST /admin/reports/r1/dismiss': () => {
        current = queue([])
        return json(404, { error: 'Report not found' })
      },
    })
    renderPage()
    await screen.findByText(R3_SUMMARY)

    // Take offline: someone else resolved it. The refetch drops the card, the dialog keeps the note and Cancel is the way out.
    const offline = await openOffline()
    await userEvent.type(noteOf(offline), ' Bulb ordered.')
    const take = confirmOf(offline, 'Take offline')
    await userEvent.click(take)
    expect(await screen.findByText('This report was already resolved.')).toBeInTheDocument()
    expect(screen.queryByText('Resource taken offline.')).toBeNull()
    await waitFor(() => expect(reads(fetch)).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText(R3_SUMMARY)).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Take this resource offline?' })).toBe(offline)
    expect(noteOf(offline)).toHaveValue(`${PROJECTOR} Bulb ordered.`)
    await waitFor(() => expect(take).toBeEnabled())
    expect(take).toHaveFocus()
    expect(writes(fetch)).toHaveLength(1)
    expect(bodyOf(fetch)).toEqual({ note: `${PROJECTOR} Bulb ordered.` })
    await userEvent.click(within(offline).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Dismiss: the report is gone. The refetch drops the card, and the dialog stays with the note until it is cancelled.
    const dismiss = await openDismiss(R1_SUMMARY)
    await userEvent.type(noteOf(dismiss), 'Looked fine')
    const confirm = confirmOf(dismiss, 'Dismiss')
    await userEvent.click(confirm)
    expect(await screen.findByText('Report not found')).toBeInTheDocument()
    expect(screen.queryByText('Report dismissed.')).toBeNull()
    await waitFor(() => expect(reads(fetch)).toHaveLength(3))
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Dismiss this report?' })).toBe(dismiss)
    expect(noteOf(dismiss)).toHaveValue('Looked fine')
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(confirm).toHaveFocus()
    await userEvent.click(within(dismiss).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('buttons on every card stay disabled until the list has refetched', async () => {
    const refetching = gate()
    let served = 0
    let current = queue([CLEAN_CODE, R1, R3])
    mockFetch({
      'GET /admin/attention': async () => {
        if (++served > 1) await refetching.promise
        return json(200, current)
      },
      'POST /admin/reports/r1/dismiss': () => {
        current = queue([CLEAN_CODE, R3])
        return json(200, { id: 'r1' })
      },
    })
    renderPage()
    await screen.findByText(R1_SUMMARY)
    const dialog = await openDismiss(R1_SUMMARY)
    await userEvent.click(confirmOf(dialog, 'Dismiss'))

    // The write landed and the list is not back yet: the dialog cannot be confirmed again, and every action on every card
    // behind it, overdue or report, is off.
    await screen.findByText('Report dismissed.')
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(confirmOf(dialog, 'Dismiss')).toBeDisabled()
    const cards: [string, string[]][] = [
      [CLEAN_CODE_SUMMARY, ['Send reminder', 'Escalate']],
      [R1_SUMMARY, ['Confirm & flag copy', 'Dismiss']],
      [R3_SUMMARY, ['Take offline', 'Dismiss']],
    ]
    for (const [summary, names] of cards) {
      for (const name of names) expect(buttonOf(summary, name)).toBeDisabled()
    }

    refetching.open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(R1_SUMMARY)).toBeNull()
    for (const [summary, names] of cards.filter(([summary]) => summary !== R1_SUMMARY)) {
      for (const name of names) expect(buttonOf(summary, name)).toBeEnabled()
    }
  })

  it('a second click in flight sends nothing: Confirm & flag copy is one write, and the other cards stay off', async () => {
    const saving = gate()
    const fetch = mockFetch({
      'GET /admin/attention': () => json(200, queue([R1, R3])),
      'POST /admin/reports/r1/confirm': async () => {
        await saving.promise
        return json(200, { id: 'r1' })
      },
    })
    renderPage()
    await screen.findByText(R1_SUMMARY)

    const dialog = await openFlag()
    await userEvent.dblClick(confirmOf(dialog, 'Confirm & flag copy'))
    expect(writes(fetch)).toHaveLength(1)
    expect(confirmOf(dialog, 'Confirm & flag copy')).toBeDisabled()

    // Another card's buttons are off while it is in flight, so no second dialog opens and no second write is sent.
    await userEvent.click(buttonOf(R3_SUMMARY, 'Take offline'))
    await userEvent.click(buttonOf(R3_SUMMARY, 'Dismiss'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    saving.open()
    expect(await screen.findByText('Copy flagged.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(fetch)).toHaveLength(1)
  })
})
