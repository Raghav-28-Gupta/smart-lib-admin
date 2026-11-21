import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/components/Dialog'

function Body({ onCancel }: { onCancel: () => void }) {
  return (
    <>
      <div className="dialog-body">Pick a seat.</div>
      <div className="field">
        <label htmlFor="note">Note</label>
        <input id="note" className="input" />
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button">Confirm</button>
      </div>
    </>
  )
}

describe('Dialog', () => {
  it('labels the dialog by its title', () => {
    render(<Dialog title="Cancel this booking?" onCancel={() => {}}><Body onCancel={() => {}} /></Dialog>)
    const dialog = screen.getByRole('dialog', { name: 'Cancel this booking?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('Pick a seat.')
  })

  it('Escape calls onCancel', async () => {
    const onCancel = vi.fn()
    render(<Dialog title="Cancel this booking?" onCancel={onCancel}><Body onCancel={onCancel} /></Dialog>)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Tab from the last button wraps to the first control', async () => {
    render(<Dialog title="Cancel this booking?" onCancel={() => {}}><Body onCancel={() => {}} /></Dialog>)
    screen.getByRole('button', { name: 'Confirm' }).focus()
    await userEvent.tab()
    expect(screen.getByLabelText('Note')).toHaveFocus()
  })

  it('Shift+Tab from the first wraps to the last', async () => {
    render(<Dialog title="Cancel this booking?" onCancel={() => {}}><Body onCancel={() => {}} /></Dialog>)
    screen.getByLabelText('Note').focus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
  })

  it('focus returns to the opening button after unmount', async () => {
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          {open && <Dialog title="Cancel this booking?" onCancel={() => setOpen(false)}><Body onCancel={() => setOpen(false)} /></Dialog>}
        </>
      )
    }
    render(<Opener />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
})
