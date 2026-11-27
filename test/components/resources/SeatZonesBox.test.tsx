import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SeatZonesBox } from '@/components/resources/SeatZonesBox'
import { ToastProvider } from '@/components/Toasts'
import { writeToken } from '@/lib/api'
import type { LiveHandlers } from '@/lib/live'
import { LiveProvider } from '@/lib/liveContext'
import type { SeatZone } from '@/lib/resources'
import { json, mockFetch } from '../../helpers'

const live = vi.hoisted(() => ({ handlers: null as LiveHandlers | null }))
vi.mock('@/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live')>()),
  connectLive: (handlers: LiveHandlers) => {
    live.handlers = handlers
    return { close: () => {} }
  },
}))

const READING: SeatZone = { name: 'Reading Room A', frontLabel: 'Windows', seats: 48, placed: 46 }
const SILENT: SeatZone = { name: 'Silent Zone', frontLabel: null, seats: 1, placed: 0 }

function renderBox() {
  writeToken('t')
  return render(
    <LiveProvider>
      <ToastProvider>
        <SeatZonesBox />
      </ToastProvider>
    </LiveProvider>,
  )
}

const lineOf = (zone: string) => within(screen.getByLabelText(`Front of room for ${zone}`).closest('li')!)
const puts = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')

describe('SeatZonesBox', () => {
  it('lists each zone with "48 seats, 46 on the map" and its front label', async () => {
    mockFetch({ 'GET /admin/zones': () => json(200, [READING, SILENT]) })
    renderBox()

    expect(await screen.findByRole('heading', { name: 'Seat map zones' })).toBeInTheDocument()
    const reading = lineOf('Reading Room A')
    expect(reading.getByText('Reading Room A')).toBeInTheDocument()
    expect(reading.getByText('48 seats, 46 on the map')).toBeInTheDocument()
    expect(screen.getByLabelText('Front of room for Reading Room A')).toHaveValue('Windows')
    expect(reading.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    // No label yet: an empty box. One seat reads "1 seat", not "1 seats".
    const silent = lineOf('Silent Zone')
    expect(silent.getByText('1 seat, 0 on the map')).toBeInTheDocument()
    expect(screen.getByLabelText('Front of room for Silent Zone')).toHaveValue('')
    expect(screen.getByLabelText('Front of room for Silent Zone')).toHaveAttribute('maxlength', '40')
  })

  it('lists a location typed with different case as its own zone', async () => {
    mockFetch({
      'GET /admin/zones': () => json(200, [READING, { name: 'Reading room A', frontLabel: null, seats: 1, placed: 1 }]),
    })
    renderBox()
    expect(await screen.findByLabelText('Front of room for Reading Room A')).toBeInTheDocument()
    expect(screen.getByLabelText('Front of room for Reading room A')).toBeInTheDocument()
  })

  it('Save sends the label and toasts "Saved the front of Reading Room A."', async () => {
    let lists = 0
    const fetch = mockFetch({
      'GET /admin/zones': () => json(200, ++lists === 1 ? [READING, SILENT] : [{ ...READING, frontLabel: 'Entrance' }, SILENT]),
      'PUT /admin/zones/Reading%20Room%20A': () => json(200, { ...READING, frontLabel: 'Entrance' }),
    })
    renderBox()
    const input = await screen.findByLabelText('Front of room for Reading Room A')
    const save = lineOf('Reading Room A').getByRole('button', { name: 'Save' })

    await userEvent.clear(input)
    await userEvent.type(input, '  Entrance ')
    await userEvent.click(save)

    expect(await screen.findByText('Saved the front of Reading Room A.')).toBeInTheDocument()
    expect(puts(fetch)).toHaveLength(1)
    expect(JSON.parse(String(puts(fetch)[0][1]!.body))).toEqual({ frontLabel: 'Entrance' })
    // The list is refetched, and the box shows what the server now holds.
    await waitFor(() => expect(lists).toBe(2))
    await waitFor(() => expect(save).toBeDisabled())
    expect(screen.getByLabelText('Front of room for Reading Room A')).toHaveValue('Entrance')
  })

  it('Save is off until the label changes, and a blank label sends "" to clear it', async () => {
    const fetch = mockFetch({
      'GET /admin/zones': () => json(200, [READING]),
      'PUT /admin/zones/Reading%20Room%20A': () => json(200, { ...READING, frontLabel: null }),
    })
    renderBox()
    const input = await screen.findByLabelText('Front of room for Reading Room A')
    const save = lineOf('Reading Room A').getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await userEvent.type(input, '   ')
    expect(save).toBeDisabled() // only blanks added: nothing changed once trimmed
    await userEvent.clear(input)
    expect(save).toBeEnabled()
    await userEvent.click(save)

    await screen.findByText('Saved the front of Reading Room A.')
    expect(JSON.parse(String(puts(fetch)[0][1]!.body))).toEqual({ frontLabel: '' })
  })

  it('Enter in the box saves, like the button', async () => {
    const fetch = mockFetch({
      'GET /admin/zones': () => json(200, [SILENT]),
      'PUT /admin/zones/Silent%20Zone': () => json(200, { ...SILENT, frontLabel: 'Entrance' }),
    })
    renderBox()
    await userEvent.type(await screen.findByLabelText('Front of room for Silent Zone'), 'Entrance{Enter}')
    await screen.findByText('Saved the front of Silent Zone.')
    expect(JSON.parse(String(puts(fetch)[0][1]!.body))).toEqual({ frontLabel: 'Entrance' })
  })

  it("a refusal is toasted, and the list refetches (the zone's seats may all have moved)", async () => {
    let lists = 0
    mockFetch({
      'GET /admin/zones': () => json(200, ++lists === 1 ? [READING, SILENT] : [SILENT]),
      'PUT /admin/zones/Reading%20Room%20A': () => json(404, { error: 'Zone not found' }),
    })
    renderBox()
    await userEvent.type(await screen.findByLabelText('Front of room for Reading Room A'), '!')
    await userEvent.click(lineOf('Reading Room A').getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Zone not found')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Front of room for Reading Room A')).toBeNull())
    expect(screen.getByLabelText('Front of room for Silent Zone')).toBeInTheDocument()
  })

  it('with no zones it says "Add a seat with a location to make a zone."', async () => {
    mockFetch({ 'GET /admin/zones': () => json(200, []) })
    renderBox()
    expect(await screen.findByText('Add a seat with a location to make a zone.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Seat map zones' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('shows a loading line, then an error with Retry when the zones cannot be loaded', async () => {
    let lists = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch({
      'GET /admin/zones': async () => {
        if (++lists === 1) {
          await gate
          return json(500, { error: 'x' })
        }
        return json(200, [READING])
      },
    })
    renderBox()
    expect(screen.getByLabelText('Loading seat map zones')).toHaveAttribute('aria-busy', 'true')
    release()
    expect(await screen.findByText("Couldn't load the seat map zones.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Front of room for Reading Room A')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the seat map zones.")).toBeNull()
  })

  it('it refetches on a resources live event', async () => {
    let lists = 0
    mockFetch({
      'GET /admin/zones': () => json(200, ++lists === 1 ? [SILENT] : [SILENT, READING]),
    })
    renderBox()
    await screen.findByLabelText('Front of room for Silent Zone')
    expect(screen.queryByLabelText('Front of room for Reading Room A')).toBeNull()

    act(() => live.handlers!.onEvent({ type: 'resource.changed', topics: ['resources', 'metrics'] }))
    // After the 1 s debounce, with no skeleton: the zone that was there stays while it runs.
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })
    expect(await screen.findByLabelText('Front of room for Reading Room A')).toBeInTheDocument()
    expect(screen.getByLabelText('Front of room for Silent Zone')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading seat map zones')).toBeNull()
  })

  it('ignores a live event about something else', async () => {
    const fetch = mockFetch({ 'GET /admin/zones': () => json(200, [SILENT]) })
    renderBox()
    await screen.findByLabelText('Front of room for Silent Zone')
    act(() => live.handlers!.onEvent({ type: 'booking.changed', topics: ['bookings', 'metrics'] }))
    await new Promise((resolve) => setTimeout(resolve, 1_300)) // longer than the 1 s debounce
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a refetch while a label is half typed keeps what was typed', async () => {
    let lists = 0
    mockFetch({ 'GET /admin/zones': () => json(200, ++lists === 1 ? [SILENT] : [{ ...SILENT, seats: 2 }]) })
    renderBox()
    const input = await screen.findByLabelText('Front of room for Silent Zone')
    await userEvent.type(input, 'Entr')

    act(() => live.handlers!.onEvent({ type: 'resource.changed', topics: ['resources'] }))
    await waitFor(() => expect(lists).toBe(2), { timeout: 2_000 })
    expect(await screen.findByText('2 seats, 0 on the map')).toBeInTheDocument()
    expect(screen.getByLabelText('Front of room for Silent Zone')).toHaveValue('Entr')
  })
})
