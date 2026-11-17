import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CanvasForm } from '@/features/documents/canvas-form'
import { canvasOfSize } from '@/features/pipeline/canvas'

function show(onSubmit = vi.fn()) {
  render(
    <CanvasForm
      initial={canvasOfSize(100, 50)}
      submitLabel="Apply"
      onSubmit={onSubmit}
    />,
  )
  return onSubmit
}

describe('CanvasForm', () => {
  it('starts with the canvas it is given', () => {
    show()
    expect(screen.getByLabelText('Width (px)')).toHaveValue('100')
    expect(screen.getByLabelText('Height (px)')).toHaveValue('50')
    expect(
      screen.getByRole('switch', { name: 'Transparent background' }),
    ).toBeChecked()
    expect(screen.queryByLabelText('Background colour')).not.toBeInTheDocument()
  })

  it('submits a checked canvas', async () => {
    const user = userEvent.setup()
    const onSubmit = show()
    await user.clear(screen.getByLabelText('Width (px)'))
    await user.type(screen.getByLabelText('Width (px)'), '640')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSubmit).toHaveBeenCalledWith({
      width: 640,
      height: 50,
      background: 'transparent',
    })
  })

  it('offers a colour when the background is not transparent', async () => {
    const user = userEvent.setup()
    const onSubmit = show()
    await user.click(
      screen.getByRole('switch', { name: 'Transparent background' }),
    )
    expect(screen.getByLabelText('Background colour')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSubmit).toHaveBeenCalledWith({
      width: 100,
      height: 50,
      background: '#ffffff',
    })
  })

  it('says why a canvas is refused and submits nothing', async () => {
    const user = userEvent.setup()
    const onSubmit = show()
    await user.clear(screen.getByLabelText('Height (px)'))
    await user.type(screen.getByLabelText('Height (px)'), '0')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses text that is not a number', async () => {
    const user = userEvent.setup()
    const onSubmit = show()
    await user.clear(screen.getByLabelText('Width (px)'))
    await user.type(screen.getByLabelText('Width (px)'), 'wide')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
