import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { StepNameField } from '@/features/tools/step-name-field'

function show(name: string | undefined = undefined) {
  const onRename = vi.fn()
  render(<StepNameField name={name} fallback="Blur" onRename={onRename} />)
  return onRename
}

describe('StepNameField', () => {
  it('shows the tool’s name as the placeholder when the step has no name', () => {
    show()

    const field = screen.getByRole('textbox', { name: 'Name' })
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'Blur')
  })

  it('shows the name the step was given', () => {
    show('Soften')

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Soften')
  })

  it('renames when the field is left, once', async () => {
    const user = userEvent.setup()
    const onRename = show()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Soften')
    expect(onRename).not.toHaveBeenCalled()
    await user.tab()

    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Soften')
  })

  it('renames on Enter', async () => {
    const user = userEvent.setup()
    const onRename = show()

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Soften{Enter}',
    )

    expect(onRename).toHaveBeenCalledWith('Soften')
  })

  it('does nothing when the name did not change', async () => {
    const user = userEvent.setup()
    const onRename = show('Soften')

    await user.click(screen.getByRole('textbox', { name: 'Name' }))
    await user.tab()

    expect(onRename).not.toHaveBeenCalled()
  })

  it('clears the name when the field is emptied', async () => {
    const user = userEvent.setup()
    const onRename = show('Soften')

    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.tab()

    expect(onRename).toHaveBeenCalledWith('')
  })

  it('follows a name changed elsewhere, such as by undo', () => {
    const onRename = vi.fn()
    const { rerender } = render(
      <StepNameField name="Soften" fallback="Blur" onRename={onRename} />,
    )

    rerender(
      <StepNameField name={undefined} fallback="Blur" onRename={onRename} />,
    )

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('')
  })
})
