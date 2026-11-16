import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import type { LayerSettings } from '@/features/pipeline/layer'
import { LayerSettingsForm } from '@/features/tools/layer-settings-form'

function show(settings: LayerSettings = DEFAULT_LAYER_SETTINGS) {
  const onChange = vi.fn()
  render(<LayerSettingsForm settings={settings} onChange={onChange} />)
  return onChange
}

describe('LayerSettingsForm', () => {
  it('shows the settings the layer has', () => {
    show({
      ...DEFAULT_LAYER_SETTINGS,
      opacity: 40,
      blend: 'colour-dodge',
      fit: 'cover',
      scale: 150,
      rotation: -30,
      anchor: 'northeast',
      x: 12,
      y: -3,
    })

    expect(screen.getByText('40%')).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Blend mode' }),
    ).toHaveTextContent('Colour dodge')
    expect(screen.getByRole('combobox', { name: 'Fit' })).toHaveTextContent(
      'Fill',
    )
    expect(screen.getByRole('spinbutton', { name: 'Scale (%)' })).toHaveValue(
      150,
    )
    expect(
      screen.getByRole('spinbutton', { name: 'Rotation (°)' }),
    ).toHaveValue(-30)
    expect(screen.getByRole('radio', { name: 'Top right' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Across (px)' })).toHaveValue(
      12,
    )
    expect(screen.getByRole('spinbutton', { name: 'Down (px)' })).toHaveValue(
      -3,
    )
  })

  it('changes the blend mode and the fit', async () => {
    const user = userEvent.setup()
    const onChange = show()

    await user.click(screen.getByRole('combobox', { name: 'Blend mode' }))
    await user.click(screen.getByRole('option', { name: 'Multiply' }))
    await user.click(screen.getByRole('combobox', { name: 'Fit' }))
    await user.click(screen.getByRole('option', { name: 'Stretch' }))

    expect(onChange).toHaveBeenNthCalledWith(1, {
      ...DEFAULT_LAYER_SETTINGS,
      blend: 'multiply',
    })
    expect(onChange).toHaveBeenNthCalledWith(2, {
      ...DEFAULT_LAYER_SETTINGS,
      fit: 'stretch',
    })
  })

  it('moves the opacity with the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = show()

    await user.click(screen.getByRole('slider', { name: 'Opacity' }))
    await user.keyboard('{ArrowLeft}')

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYER_SETTINGS,
      opacity: 99,
    })
  })

  it('picks the anchor from the nine points', async () => {
    const user = userEvent.setup()
    const onChange = show()

    await user.click(screen.getByRole('radio', { name: 'Bottom left' }))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYER_SETTINGS,
      anchor: 'southwest',
    })
    expect(screen.getAllByRole('radio')).toHaveLength(9)
  })

  it('changes the scale, the rotation and the offsets', async () => {
    const user = userEvent.setup()
    const onChange = show()
    const typeInto = async (name: string, text: string) => {
      const field = screen.getByRole('spinbutton', { name })
      await user.clear(field)
      await user.type(field, text)
    }

    await typeInto('Scale (%)', '5')
    await typeInto('Rotation (°)', '9')
    await typeInto('Across (px)', '7')
    await typeInto('Down (px)', '3')

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYER_SETTINGS,
      scale: 5,
    })
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYER_SETTINGS,
      rotation: 9,
    })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LAYER_SETTINGS, x: 7 })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LAYER_SETTINGS, y: 3 })
  })

  it('keeps what is typed inside what a layer allows', async () => {
    const user = userEvent.setup()
    const onChange = show()
    const scale = screen.getByRole('spinbutton', { name: 'Scale (%)' })

    await user.clear(scale)
    await user.type(scale, '5000')

    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LAYER_SETTINGS,
      scale: 1000,
    })
  })

  it('ignores a field that is cleared or not a number', async () => {
    const user = userEvent.setup()
    const onChange = show()

    await user.clear(screen.getByRole('spinbutton', { name: 'Across (px)' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('rounds an offset to a whole pixel', async () => {
    const user = userEvent.setup()
    const onChange = show()

    const across = screen.getByRole('spinbutton', { name: 'Across (px)' })
    await user.clear(across)
    await user.type(across, '2.6')

    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LAYER_SETTINGS,
      x: 3,
    })
  })
})
