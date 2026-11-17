import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ZoomControl } from '@/features/viewport/zoom-control'
import type { ViewFrame } from '@/features/viewport/viewport'
import { useUiStore } from '@/store/ui-store'
import { resetStores } from '@/store/reset-stores'

const ID = 'doc'
const FRAME: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  ratio: 2,
  naturalWidth: 2000,
}

function zoom(): number {
  return useUiStore.getState().viewports[ID]?.zoom ?? 1
}

beforeEach(() => {
  resetStores()
})

describe('ZoomControl', () => {
  it('is switched off until the canvas has been measured', () => {
    render(<ZoomControl documentId={ID} />)

    expect(screen.getByRole('textbox', { name: 'Zoom' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Zoom level' })).toHaveAttribute(
      'data-disabled',
    )
  })

  it('shows the zoom as a percentage of the picture’s own pixels', () => {
    useUiStore.getState().setViewFrame(ID, FRAME)
    render(<ZoomControl documentId={ID} />)

    expect(screen.getByRole('textbox', { name: 'Zoom' })).toHaveValue('50%')
  })

  it('zooms in and out with the small and large picture buttons', async () => {
    const user = userEvent.setup()
    useUiStore.getState().setViewFrame(ID, FRAME)
    render(<ZoomControl documentId={ID} />)

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(zoom()).toBe(1.25)
    expect(screen.getByRole('textbox', { name: 'Zoom' })).toHaveValue('63%')

    await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(zoom()).toBe(1)
  })

  it('zooms to a percentage typed in, with or without the percent sign', async () => {
    const user = userEvent.setup()
    useUiStore.getState().setViewFrame(ID, FRAME)
    render(<ZoomControl documentId={ID} />)
    const field = screen.getByRole('textbox', { name: 'Zoom' })

    await user.clear(field)
    await user.type(field, '200{Enter}')
    expect(zoom()).toBe(4)
    expect(field).toHaveValue('200%')

    await user.clear(field)
    await user.type(field, '100%')
    await user.tab()
    expect(zoom()).toBe(2)
  })

  it('puts back what was there when what was typed is not a percentage', async () => {
    const user = userEvent.setup()
    useUiStore.getState().setViewFrame(ID, FRAME)
    render(<ZoomControl documentId={ID} />)
    const field = screen.getByRole('textbox', { name: 'Zoom' })

    await user.clear(field)
    await user.type(field, 'lots{Enter}')

    expect(zoom()).toBe(1)
    expect(field).toHaveValue('50%')
  })

  it('drops what was typed on Escape', async () => {
    const user = userEvent.setup()
    useUiStore.getState().setViewFrame(ID, FRAME)
    render(<ZoomControl documentId={ID} />)
    const field = screen.getByRole('textbox', { name: 'Zoom' })

    await user.clear(field)
    await user.type(field, '300{Escape}')

    expect(zoom()).toBe(1)
    expect(field).toHaveValue('50%')
  })

  it('zooms with the slider, from the least at the left to the most at the right', async () => {
    const user = userEvent.setup()
    useUiStore.getState().setViewFrame(ID, FRAME)
    render(<ZoomControl documentId={ID} />)
    const slider = screen.getByRole('slider', { name: 'Zoom level' })

    slider.focus()
    await user.keyboard('{End}')
    expect(zoom()).toBeCloseTo(64, 6)

    await user.keyboard('{Home}')
    expect(zoom()).toBeCloseTo(0.02, 6)
  })

  it('follows a change made elsewhere', () => {
    useUiStore.getState().setViewFrame(ID, FRAME)
    render(<ZoomControl documentId={ID} />)

    act(() => {
      useUiStore.getState().setViewport(ID, { zoom: 8, x: 0.5, y: 0.5 })
    })

    expect(screen.getByRole('textbox', { name: 'Zoom' })).toHaveValue('400%')
  })
})
