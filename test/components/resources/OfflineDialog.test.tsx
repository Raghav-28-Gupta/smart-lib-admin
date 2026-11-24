import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OfflineDialog } from '@/components/resources/OfflineDialog'
import type { AdminResource } from '@/lib/resources'

const ROOM: AdminResource = {
  id: 'res1', type: 'room', name: 'Group Room 201', location: 'Floor 2', capacity: 6, status: 'available', statusNote: null, upcomingBookings: 3,
}
const note = () => screen.getByLabelText('Note (optional)')
const takeOffline = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Take offline' })

describe('OfflineDialog', () => {
  it('says how many upcoming bookings stay when the resource knows them', () => {
    render(<OfflineDialog resource={ROOM} onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Take this resource offline?' })).toHaveTextContent(
      'Group Room 201 will be hidden from the student booking calendar until brought back online. 3 upcoming bookings stay as they are.',
    )
    expect(note()).toHaveValue('')
  })

  it('leaves the bookings sentence out when only the name is known (a resource named by a problem report)', () => {
    render(<OfflineDialog resource={{ name: 'Group Room 201' }} onCancel={() => {}} onConfirm={() => {}} />)
    expect(
      within(screen.getByRole('dialog')).getByText('Group Room 201 will be hidden from the student booking calendar until brought back online.'),
    ).toBeInTheDocument()
  })

  it('starts the note at initialNote, which can be edited, and sends the note as it stands', async () => {
    const onConfirm = vi.fn()
    render(<OfflineDialog resource={ROOM} initialNote="The projector shows no picture." onCancel={() => {}} onConfirm={onConfirm} />)
    expect(note()).toHaveValue('The projector shows no picture.')
    await userEvent.type(note(), ' Bulb ordered.')
    await userEvent.click(takeOffline())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('The projector shows no picture. Bulb ordered.')
  })

  it('a void onConfirm is called once, straight away (the Resources page closes the dialog itself)', async () => {
    const onConfirm = vi.fn()
    render(<OfflineDialog resource={ROOM} onCancel={() => {}} onConfirm={onConfirm} />)
    await userEvent.type(note(), 'Bulb replacement')
    await userEvent.click(takeOffline())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('Bulb replacement')
    // Nothing is held back: a caller that keeps the dialog up can confirm again.
    await waitFor(() => expect(takeOffline()).toBeEnabled())
  })

  it('a promise onConfirm keeps the button off while it is pending, and a second click sends nothing', async () => {
    let settle!: (sent: boolean) => void
    const onConfirm = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve
    }))
    render(<OfflineDialog resource={ROOM} onCancel={() => {}} onConfirm={onConfirm} />)
    await userEvent.dblClick(takeOffline())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(takeOffline()).toBeDisabled()
    settle(true)
    await waitFor(() => expect(takeOffline()).toBeEnabled())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('a promise that resolves false keeps the typed note and puts focus back on the button', async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<OfflineDialog resource={ROOM} onCancel={() => {}} onConfirm={onConfirm} />)
    await userEvent.type(note(), 'Bulb replacement')
    await userEvent.click(takeOffline())

    await waitFor(() => expect(takeOffline()).toBeEnabled())
    expect(takeOffline()).toHaveFocus()
    expect(note()).toHaveValue('Bulb replacement')

    await userEvent.click(takeOffline())
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onConfirm).toHaveBeenLastCalledWith('Bulb replacement')
  })
})
