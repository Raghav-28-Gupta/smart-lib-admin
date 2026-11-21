import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ResourcesPage from '@/app/(console)/resources/page'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { AdminResource } from '@/lib/resources'
import { json, mockFetch } from '../helpers'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

const SEAT: AdminResource = {
  id: 'r1', type: 'seat', name: 'Reading Hall A - Seat 12', location: 'Reading Hall A', capacity: 1,
  status: 'available', statusNote: null, upcomingBookings: 0,
}
const SEAT_2: AdminResource = {
  id: 'r4', type: 'seat', name: 'Silent Zone - Seat 03', location: 'Silent Zone', capacity: 1,
  status: 'available', statusNote: null, upcomingBookings: 0,
}
const ROOM: AdminResource = {
  id: 'r2', type: 'room', name: 'Group Room 201', location: '2nd Floor, East Wing', capacity: 6,
  status: 'available', statusNote: null, upcomingBookings: 3,
}
const OFFLINE_ROOM: AdminResource = {
  id: 'r3', type: 'room', name: 'Group Room 105', location: '1st Floor, West Wing', capacity: 8,
  status: 'offline', statusNote: 'Projector bulb replacement', upcomingBookings: 1,
}

function renderPage() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <ResourcesPage />
      </ToastProvider>
    </LiveProvider>,
  )
}

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) })
const posts = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([, init]) => init?.method !== undefined && init.method !== 'GET')

describe('Resources page', () => {
  it('shows the loading skeleton then the table', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch({
      'GET /admin/resources': async () => {
        await gate
        return json(200, [SEAT, ROOM])
      },
    })
    renderPage()
    expect(screen.getByLabelText('Loading resources')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('table')).toBeNull()

    release()
    const table = await screen.findByRole('table')
    expect(screen.queryByLabelText('Loading resources')).toBeNull()
    for (const heading of ['Name', 'Type', 'Location', 'Capacity', 'Status']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }
    const room = within(rowOf('Group Room 201'))
    expect(room.getByText('Room')).toBeInTheDocument()
    expect(room.getByText('2nd Floor, East Wing')).toBeInTheDocument()
    expect(room.getByText('6')).toBeInTheDocument()
    expect(room.getByText('Available')).toBeInTheDocument()
    expect(room.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(room.getByRole('button', { name: 'Take offline' })).toBeEnabled()
    expect(screen.getByText('2 of 2 resources')).toBeInTheDocument()
  })

  it('shows the error state and Retry refetches', async () => {
    let calls = 0
    mockFetch({ 'GET /admin/resources': () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, [ROOM])) })
    renderPage()
    expect(await screen.findByText("Couldn't load resources")).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Group Room 201')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load resources")).toBeNull()
  })

  it('filters by type and Clear filter restores the list', async () => {
    mockFetch({ 'GET /admin/resources': () => json(200, [SEAT, SEAT_2]) })
    renderPage()
    await screen.findByText('Reading Hall A - Seat 12')
    const filter = screen.getByRole('combobox', { name: 'Filter by type' })
    expect(filter).toHaveValue('all')

    await userEvent.selectOptions(filter, 'room')
    expect(screen.getByText('No resources match this filter')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('0 of 2 resources')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByText('Reading Hall A - Seat 12')).toBeInTheDocument()
    expect(screen.getByText('Silent Zone - Seat 03')).toBeInTheDocument()
    expect(screen.getByText('2 of 2 resources')).toBeInTheDocument()
    expect(filter).toHaveValue('all')
  })

  it('narrows the table to the chosen type without another request', async () => {
    const fetch = mockFetch({ 'GET /admin/resources': () => json(200, [SEAT, ROOM, OFFLINE_ROOM]) })
    renderPage()
    await screen.findByText('Group Room 201')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by type' }), 'room')
    expect(screen.queryByText('Reading Hall A - Seat 12')).toBeNull()
    expect(screen.getByText('Group Room 201')).toBeInTheDocument()
    expect(screen.getByText('Group Room 105')).toBeInTheDocument()
    expect(screen.getByText('2 of 3 resources')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('says so when there are no resources at all, with no filter to clear', async () => {
    mockFetch({ 'GET /admin/resources': () => json(200, []) })
    renderPage()
    expect(await screen.findByText('No resources yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add resource' })).toBeEnabled()
  })

  it('an offline resource shows the Offline tag and its note', async () => {
    mockFetch({ 'GET /admin/resources': () => json(200, [ROOM, OFFLINE_ROOM]) })
    renderPage()
    await screen.findByText('Group Room 105')
    const offline = within(rowOf('Group Room 105'))
    expect(offline.getByText('Offline')).toBeInTheDocument()
    expect(offline.getByText('Projector bulb replacement')).toBeInTheDocument()
    expect(offline.getByRole('button', { name: 'Bring online' })).toBeInTheDocument()
    expect(offline.queryByRole('button', { name: 'Take offline' })).toBeNull()
    // An available resource has no note line and offers Take offline.
    const available = within(rowOf('Group Room 201'))
    expect(available.queryByText('Offline')).toBeNull()
    expect(available.getByRole('button', { name: 'Take offline' })).toBeInTheDocument()
  })

  it('Add resource posts the form and the new row appears', async () => {
    const created: AdminResource = {
      id: 'r9', type: 'room', name: 'Discussion Pod 4', location: 'Pod area', capacity: 4,
      status: 'available', statusNote: null, upcomingBookings: 0,
    }
    let lists = 0
    const fetch = mockFetch({
      'GET /admin/resources': () => json(200, ++lists === 1 ? [SEAT] : [SEAT, created]),
      'POST /admin/resources': () => json(201, created),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Add resource' }))

    const dialog = screen.getByRole('dialog', { name: 'Add a resource' })
    expect(within(dialog).getByText('New seat or room added to the booking inventory.')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Add resource' })
    expect(confirm).toBeDisabled() // a name is required
    expect(within(dialog).getByLabelText('Type')).toBeEnabled()

    await userEvent.type(within(dialog).getByLabelText('Name'), '  Discussion Pod 4 ')
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'room')
    await userEvent.type(within(dialog).getByLabelText('Location'), 'Pod area')
    await userEvent.clear(within(dialog).getByLabelText('Capacity'))
    await userEvent.type(within(dialog).getByLabelText('Capacity'), '4')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)

    expect(await screen.findByText('Added Discussion Pod 4.')).toBeInTheDocument()
    const post = posts(fetch)[0]
    expect(post[1]!.method).toBe('POST')
    expect(JSON.parse(String(post[1]!.body))).toEqual({ type: 'room', name: 'Discussion Pod 4', location: 'Pod area', capacity: 4 })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByRole('row', { name: /Discussion Pod 4/ })).toBeInTheDocument()
    expect(screen.getByText('2 of 2 resources')).toBeInTheDocument()
  })

  it('Add resource refuses a name that is blank and a capacity outside 1 to 100', async () => {
    mockFetch({ 'GET /admin/resources': () => json(200, [SEAT]) })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Add resource' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Add resource' })
    const name = within(dialog).getByLabelText('Name')
    const capacity = within(dialog).getByLabelText('Capacity')

    await userEvent.type(name, '   ')
    expect(confirm).toBeDisabled()
    await userEvent.clear(name)
    await userEvent.type(name, 'Pod')
    expect(confirm).toBeEnabled()

    for (const bad of ['0', '101', '2.5', '']) {
      await userEvent.clear(capacity)
      if (bad) await userEvent.type(capacity, bad)
      expect(confirm).toBeDisabled()
    }
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '100')
    expect(confirm).toBeEnabled()
  })

  it('Edit disables the type field and sends PATCH', async () => {
    const edited: AdminResource = { ...ROOM, name: 'Group Room 201 (large)', capacity: 8 }
    let lists = 0
    const fetch = mockFetch({
      'GET /admin/resources': () => json(200, ++lists === 1 ? [ROOM] : [edited]),
      'PATCH /admin/resources/r2': () => json(200, edited),
    })
    renderPage()
    await userEvent.click(within(await screen.findByRole('row', { name: /Group Room 201/ })).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog', { name: 'Edit resource' })
    const type = within(dialog).getByLabelText('Type')
    expect(type).toBeDisabled()
    expect(type).toHaveValue('room')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Group Room 201')
    expect(within(dialog).getByLabelText('Location')).toHaveValue('2nd Floor, East Wing')
    expect(within(dialog).getByLabelText('Capacity')).toHaveValue(6)

    await userEvent.type(within(dialog).getByLabelText('Name'), ' (large)')
    await userEvent.clear(within(dialog).getByLabelText('Capacity'))
    await userEvent.type(within(dialog).getByLabelText('Capacity'), '8')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Saved changes to Group Room 201 (large).')).toBeInTheDocument()
    const patch = posts(fetch)[0]
    expect(patch[1]!.method).toBe('PATCH')
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ name: 'Group Room 201 (large)', location: '2nd Floor, East Wing', capacity: 8 })
    expect(await screen.findByText('Group Room 201 (large)')).toBeInTheDocument()
  })

  it('Take offline shows how many upcoming bookings stay, sends the note, and the row updates', async () => {
    const offline: AdminResource = { ...ROOM, status: 'offline', statusNote: 'Projector bulb replacement' }
    let lists = 0
    const fetch = mockFetch({
      'GET /admin/resources': () => json(200, ++lists === 1 ? [ROOM] : [offline]),
      'POST /admin/resources/r2/offline': () => json(200, offline),
    })
    renderPage()
    await userEvent.click(within(await screen.findByRole('row', { name: /Group Room 201/ })).getByRole('button', { name: 'Take offline' }))

    const dialog = screen.getByRole('dialog', { name: 'Take this resource offline?' })
    expect(
      within(dialog).getByText(
        'Group Room 201 will be hidden from the student booking calendar until brought back online. 3 upcoming bookings stay as they are.',
      ),
    ).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), '  Projector bulb replacement ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take offline' }))

    expect(await screen.findByText('Group Room 201 is now offline.')).toBeInTheDocument()
    expect(posts(fetch)).toHaveLength(1)
    expect(posts(fetch)[0][1]!.body).toBe('{"note":"Projector bulb replacement"}')
    expect(screen.queryByRole('dialog')).toBeNull()

    const row = within(await screen.findByRole('row', { name: /Offline/ }))
    expect(row.getByText('Projector bulb replacement')).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Bring online' })).toBeInTheDocument()
  })

  it('Take offline without a note sends none', async () => {
    const fetch = mockFetch({
      'GET /admin/resources': () => json(200, [ROOM]),
      'POST /admin/resources/r2/offline': () => json(200, { ...ROOM, status: 'offline' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Take offline' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take offline' }))
    await screen.findByText('Group Room 201 is now offline.')
    expect(posts(fetch)[0][1]!.body).toBe('{}')
  })

  it('words the upcoming bookings line for none, one and many', async () => {
    const one: AdminResource = { ...ROOM, id: 'r5', name: 'Group Room 202', upcomingBookings: 1 }
    mockFetch({ 'GET /admin/resources': () => json(200, [SEAT, one, ROOM]) })
    renderPage()
    await screen.findByText('Reading Hall A - Seat 12')
    const expected: [string, string][] = [
      ['Reading Hall A - Seat 12', 'It has no upcoming bookings.'],
      ['Group Room 202', '1 upcoming booking stays as it is.'],
      ['Group Room 201', '3 upcoming bookings stay as they are.'],
    ]
    for (const [name, line] of expected) {
      await userEvent.click(within(rowOf(name)).getByRole('button', { name: 'Take offline' }))
      const dialog = screen.getByRole('dialog', { name: 'Take this resource offline?' })
      expect(dialog).toHaveTextContent(`${name} will be hidden from the student booking calendar until brought back online. ${line}`)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    }
  })

  it('Bring online sends the request', async () => {
    const online: AdminResource = { ...OFFLINE_ROOM, status: 'available', statusNote: null }
    let lists = 0
    const fetch = mockFetch({
      'GET /admin/resources': () => json(200, ++lists === 1 ? [OFFLINE_ROOM] : [online]),
      'POST /admin/resources/r3/online': () => json(200, online),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Bring online' }))

    const dialog = screen.getByRole('dialog', { name: 'Bring this resource back online?' })
    expect(within(dialog).getByText('Group Room 105 will reappear on the student booking calendar.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bring online' }))

    expect(await screen.findByText('Group Room 105 is back online.')).toBeInTheDocument()
    expect(posts(fetch)).toHaveLength(1)
    expect(posts(fetch)[0][1]!.body).toBeUndefined()
    expect(await screen.findByRole('button', { name: 'Take offline' })).toBeInTheDocument()
    expect(within(rowOf('Group Room 105')).getByText('Available')).toBeInTheDocument()
  })

  it('a 409 from the server is shown as a toast and the list refetches', async () => {
    const offline: AdminResource = { ...ROOM, status: 'offline', statusNote: 'Taken offline by Librarian Two' }
    let lists = 0
    mockFetch({
      'GET /admin/resources': () => json(200, ++lists === 1 ? [ROOM] : [offline]),
      'POST /admin/resources/r2/offline': () => json(409, { error: 'This resource is already offline.' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Take offline' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take offline' }))

    expect(await screen.findByText('This resource is already offline.')).toBeInTheDocument()
    await waitFor(() => expect(lists).toBe(2))
    expect(await screen.findByText('Taken offline by Librarian Two')).toBeInTheDocument()
  })

  it('buttons are disabled until the list has refetched', async () => {
    let lists = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const offline: AdminResource = { ...ROOM, status: 'offline', statusNote: null }
    const fetch = mockFetch({
      'GET /admin/resources': async () => {
        if (++lists === 1) return json(200, [ROOM])
        await gate
        return json(200, [offline])
      },
      'POST /admin/resources/r2/offline': () => json(200, offline),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Take offline' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take offline' }))
    expect(await screen.findByText('Group Room 201 is now offline.')).toBeInTheDocument()

    // The refetch is still pending, so the old row is still on screen -- but it cannot be acted on again.
    const row = within(rowOf('Group Room 201'))
    expect(row.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(row.getByRole('button', { name: 'Take offline' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add resource' })).toBeDisabled()
    await userEvent.click(row.getByRole('button', { name: 'Take offline' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(fetch)).toHaveLength(1)

    release()
    expect(await screen.findByRole('button', { name: 'Bring online' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add resource' })).toBeEnabled()
  })

  // The double-submit guard itself is tested on the hook (test/components/resources/useResourceActions.test.tsx):
  // here the dialog unmounts on the first click, so a second click could never reach it.
  it('closes the dialog on confirm and sends the request once', async () => {
    const fetch = mockFetch({
      'GET /admin/resources': () => json(200, [OFFLINE_ROOM]),
      'POST /admin/resources/r3/online': () => json(200, { ...OFFLINE_ROOM, status: 'available' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Bring online' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Bring online' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await screen.findByText('Group Room 105 is back online.')
    expect(posts(fetch)).toHaveLength(1)
  })

  it('a live resources event refetches without the skeleton', async () => {
    let lists = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch({
      'GET /admin/resources': async () => {
        if (++lists === 1) return json(200, [ROOM])
        await gate
        return json(200, [ROOM, OFFLINE_ROOM])
      },
    })
    renderPage()
    await screen.findByText('Group Room 201')

    act(() => live.handlers!.onEvent({ type: 'resource.changed', topics: ['resources', 'metrics'] }))
    // The refetch starts after the 1 s debounce and is still pending: the rows stay and there is no skeleton.
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })
    expect(screen.queryByLabelText('Loading resources')).toBeNull()
    expect(screen.getByText('Group Room 201')).toBeInTheDocument()

    release()
    expect(await screen.findByText('Group Room 105')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading resources')).toBeNull()
  })

  it('keeps the rows on screen when a live refresh fails', async () => {
    let lists = 0
    mockFetch({ 'GET /admin/resources': () => (++lists === 1 ? json(200, [ROOM]) : json(500, { error: 'x' })) })
    renderPage()
    await screen.findByText('Group Room 201')

    act(() => live.handlers!.onEvent({ type: 'resource.changed', topics: ['resources', 'metrics'] }))
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })

    expect(screen.getByText('Group Room 201')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load resources")).toBeNull()
  })

  it('ignores a live event about something else', async () => {
    const fetch = mockFetch({ 'GET /admin/resources': () => json(200, [ROOM]) })
    renderPage()
    await screen.findByText('Group Room 201')
    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    await new Promise((resolve) => setTimeout(resolve, 1_300)) // longer than the 1 s debounce
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('opens each dialog with focus on its first field', async () => {
    mockFetch({ 'GET /admin/resources': () => json(200, [ROOM, OFFLINE_ROOM]) })
    renderPage()
    await screen.findByText('Group Room 201')

    await userEvent.click(screen.getByRole('button', { name: 'Add resource' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('Name')).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(rowOf('Group Room 201')).getByRole('button', { name: 'Edit' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('Name')).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(rowOf('Group Room 201')).getByRole('button', { name: 'Take offline' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('Note (optional)')).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(rowOf('Group Room 105')).getByRole('button', { name: 'Bring online' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Bring online' })).toHaveFocus()
  })

  it('Escape closes a dialog, sends nothing, and puts focus back on the button that opened it', async () => {
    const fetch = mockFetch({ 'GET /admin/resources': () => json(200, [ROOM]) })
    renderPage()
    const take = await screen.findByRole('button', { name: 'Take offline' })
    await userEvent.click(take)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(take).toHaveFocus()
    expect(posts(fetch)).toHaveLength(0)
  })
})
