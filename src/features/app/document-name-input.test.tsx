import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DocumentNameInput } from '@/features/app/document-name-input'

function show(name = 'Holiday') {
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  render(
    <DocumentNameInput name={name} onCommit={onCommit} onCancel={onCancel} />,
  )
  return { onCommit, onCancel }
}

describe('DocumentNameInput', () => {
  it('starts focused, with the whole name selected', () => {
    show()

    const field = screen.getByRole('textbox', { name: 'Document name' })
    expect(field).toHaveFocus()
    expect(field).toHaveValue('Holiday')
    expect((field as HTMLInputElement).selectionStart).toBe(0)
    expect((field as HTMLInputElement).selectionEnd).toBe('Holiday'.length)
  })

  it('commits the new name, trimmed, on Enter', async () => {
    const user = userEvent.setup()
    const { onCommit, onCancel } = show()

    await user.keyboard('  Summer  {Enter}')

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('Summer')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('commits when the field is left, and only once', async () => {
    const user = userEvent.setup()
    const { onCommit } = show()

    await user.keyboard('Summer')
    await user.tab()

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('Summer')
  })

  it('goes back without a change on Escape', async () => {
    const user = userEvent.setup()
    const { onCommit, onCancel } = show()

    await user.keyboard('Summer{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('goes back without a change when the name is the same or empty', async () => {
    const user = userEvent.setup()
    const same = show()
    await user.keyboard('{Enter}')
    expect(same.onCancel).toHaveBeenCalledTimes(1)
    expect(same.onCommit).not.toHaveBeenCalled()
  })

  it('does not accept an empty name', async () => {
    const user = userEvent.setup()
    const { onCommit, onCancel } = show()

    await user.keyboard('{Backspace}{Enter}')

    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
