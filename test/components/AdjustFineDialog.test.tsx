import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdjustFineDialog } from '@/components/fines/AdjustFineDialog'
import type { AdminFine } from '@/lib/fines'

const FINE: AdminFine = {
  id: 'f1', kind: 'fine', student: { id: 's1', name: 'Rohan Verma', email: 'rohan@example.edu' }, reason: 'overdue', item: 'Clean Code',
  amount: 150, originalAmount: 150, status: 'outstanding', date: new Date().toISOString(), note: null, recordedBy: null, canSettle: true, dispute: null,
}

async function fill(amount: string, reason: string) {
  const box = screen.getByLabelText('New amount (₹)')
  await userEvent.clear(box)
  await userEvent.type(box, amount)
  await userEvent.type(screen.getByLabelText('Reason (required)'), reason)
}
const save = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' })

describe('AdjustFineDialog onConfirm', () => {
  it('a void onConfirm is called once, straight away, with the amount and the reason as typed (the Fines page closes the dialog itself)', async () => {
    const onConfirm = vi.fn()
    render(<AdjustFineDialog fine={FINE} onCancel={() => {}} onConfirm={onConfirm} />)
    await fill('100', 'Receipt shown')
    await userEvent.click(save())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(100, 'Receipt shown')
    // Nothing is held back: a caller that keeps the dialog up can save again.
    await waitFor(() => expect(save()).toBeEnabled())
  })

  it('a promise onConfirm keeps Save off while it is pending, and a second click sends nothing', async () => {
    let settle!: (sent: boolean) => void
    const onConfirm = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve
    }))
    render(<AdjustFineDialog fine={FINE} onCancel={() => {}} onConfirm={onConfirm} />)
    await fill('100', 'Receipt shown')
    await userEvent.dblClick(save())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(save()).toBeDisabled()
    settle(true)
    await waitFor(() => expect(save()).toBeEnabled())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('a promise that resolves false keeps the typed amount and reason and puts focus back on Save', async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<AdjustFineDialog fine={FINE} onCancel={() => {}} onConfirm={onConfirm} />)
    await fill('100', 'Receipt shown')
    await userEvent.click(save())

    await waitFor(() => expect(save()).toBeEnabled())
    expect(save()).toHaveFocus()
    expect(screen.getByLabelText('New amount (₹)')).toHaveValue(100)
    expect(screen.getByLabelText('Reason (required)')).toHaveValue('Receipt shown')

    await userEvent.click(save())
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onConfirm).toHaveBeenLastCalledWith(100, 'Receipt shown')
  })

  it('Save is still off until the amount is a whole number below the fine and a reason is given', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true)
    render(<AdjustFineDialog fine={FINE} onCancel={() => {}} onConfirm={onConfirm} />)
    expect(save()).toBeDisabled()
    await fill('150', 'Receipt shown')
    expect(save()).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('New amount (₹)'))
    await userEvent.type(screen.getByLabelText('New amount (₹)'), '149')
    expect(save()).toBeEnabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("an optional context block shows under the body; without it the dialog holds only its own parts (the Fines page's use)", () => {
    const disputed: AdminFine = { ...FINE, dispute: { id: 'd1', reason: 'I returned it on Monday.', createdAt: new Date().toISOString() } }
    const { unmount } = render(<AdjustFineDialog fine={disputed} onCancel={() => {}} onConfirm={() => {}} />)
    const dialog = screen.getByRole('dialog')
    // Nothing extra: the title, the body, two fields and the buttons. The dispute's words are not repeated.
    expect(dialog).not.toHaveTextContent('I returned it on Monday.')
    expect(Array.from(dialog.children).map((el) => el.className)).toEqual(['dialog-title', 'dialog-body', 'field', 'field', 'dialog-actions'])
    unmount()

    render(<AdjustFineDialog fine={disputed} onCancel={() => {}} onConfirm={() => {}} context={<p>Their words</p>} />)
    const withContext = screen.getByRole('dialog')
    // Straight under the body, before the fields.
    expect(within(withContext).getByText(/currently ₹150/).nextElementSibling).toBe(within(withContext).getByText('Their words'))
  })
})
