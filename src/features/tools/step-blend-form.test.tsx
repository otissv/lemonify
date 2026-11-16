import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_STEP_BLEND } from '@/features/pipeline/step-blend'
import type { StepBlend } from '@/features/pipeline/step-blend'
import { StepBlendForm } from '@/features/tools/step-blend-form'

function show(blend: StepBlend = DEFAULT_STEP_BLEND) {
  const onChange = vi.fn()
  render(<StepBlendForm blend={blend} onChange={onChange} />)
  return onChange
}

describe('StepBlendForm', () => {
  it('is headed Blend and shows the blend mode and opacity', () => {
    show({ mode: 'multiply', opacity: 40 })

    expect(screen.getByRole('heading', { name: 'Blend' })).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Blend mode' }),
    ).toHaveTextContent('Multiply')
    expect(screen.getByText('40%')).toBeVisible()
    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeVisible()
  })

  it('changes the blend mode, keeping the opacity', async () => {
    const user = userEvent.setup()
    const onChange = show({ mode: 'normal', opacity: 70 })

    await user.click(screen.getByRole('combobox', { name: 'Blend mode' }))
    await user.click(screen.getByRole('option', { name: 'Screen' }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'screen', opacity: 70 })
  })

  it('changes the opacity, keeping the blend mode', async () => {
    const user = userEvent.setup()
    const onChange = show({ mode: 'overlay', opacity: 100 })

    await user.click(screen.getByRole('slider', { name: 'Opacity' }))
    await user.keyboard('{ArrowLeft}')

    expect(onChange).toHaveBeenCalledWith({ mode: 'overlay', opacity: 99 })
  })
})
