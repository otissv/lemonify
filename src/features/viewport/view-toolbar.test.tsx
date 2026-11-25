import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ActualSizeButton,
  FitButton,
  PanButtons,
  ViewToolbar,
} from '@/features/viewport/view-toolbar'
import { KEY_PAN_STEP } from '@/features/viewport/pan-step'
import type { ViewFrame, Viewport } from '@/features/viewport/viewport'
import { useUiStore } from '@/store/ui-store'
import { resetStores } from '@/store/reset-stores'

const ID = 'doc'
const FRAME: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  pictureWidth: 2000,
  pictureHeight: 1000,
}

function viewport(): Viewport | undefined {
  return useUiStore.getState().viewports[ID]
}

function renderToolbar(): void {
  render(
    <ViewToolbar label="Preview view">
      <FitButton documentId={ID} />
      <ActualSizeButton documentId={ID} />
      <PanButtons documentId={ID} />
    </ViewToolbar>,
  )
}

beforeEach(() => {
  resetStores()
})

describe('ViewToolbar', () => {
  it('is a named toolbar holding what it is given', () => {
    renderToolbar()

    const toolbar = screen.getByRole('toolbar', { name: 'Preview view' })
    expect(toolbar).toContainElement(
      screen.getByRole('button', { name: 'Fit on screen' }),
    )
  })

  it('switches its buttons off until the canvas has been measured', () => {
    renderToolbar()

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('shows actual size, then fits the picture again', async () => {
    const user = userEvent.setup()
    useUiStore.getState().setViewFrame(ID, FRAME)
    renderToolbar()

    await user.click(screen.getByRole('button', { name: 'Actual size' }))
    expect(viewport()?.zoom).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Fit on screen' }))
    expect(viewport()?.zoom).toBe(0.5)
  })

  it('moves the picture as the arrow keys do', async () => {
    const user = userEvent.setup()
    useUiStore.getState().setViewFrame(ID, FRAME)
    useUiStore.getState().setViewport(ID, { zoom: 2, x: 0.5, y: 0.5 })
    renderToolbar()
    const step = KEY_PAN_STEP / (2 * FRAME.pictureWidth)
    const rise = KEY_PAN_STEP / (2 * FRAME.pictureHeight)

    await user.click(
      screen.getByRole('button', { name: 'Move the picture left' }),
    )
    expect(viewport()?.x).toBeCloseTo(0.5 - step, 6)

    await user.click(
      screen.getByRole('button', { name: 'Move the picture right' }),
    )
    expect(viewport()?.x).toBeCloseTo(0.5, 6)

    await user.click(
      screen.getByRole('button', { name: 'Move the picture up' }),
    )
    expect(viewport()?.y).toBeCloseTo(0.5 - rise, 6)

    await user.click(
      screen.getByRole('button', { name: 'Move the picture down' }),
    )
    expect(viewport()?.y).toBeCloseTo(0.5, 6)
  })
})
