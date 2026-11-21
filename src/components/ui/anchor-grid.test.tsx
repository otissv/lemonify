import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AnchorGrid } from '@/components/ui/anchor-grid'

const POINTS = [
  { value: 'a', label: 'Top left' },
  { value: 'b', label: 'Top' },
  { value: 'c', label: 'Top right' },
  { value: 'd', label: 'Left' },
  { value: 'e', label: 'Centre' },
  { value: 'f', label: 'Right' },
  { value: 'g', label: 'Bottom left' },
  { value: 'h', label: 'Bottom' },
  { value: 'i', label: 'Bottom right' },
] as const

describe('AnchorGrid', () => {
  it('shows the points as a group of radios named by the label it is given', () => {
    render(
      <>
        <span id="label">Where</span>
        <AnchorGrid
          labelledBy="label"
          points={POINTS}
          value="c"
          onChange={vi.fn()}
        />
      </>,
    )

    expect(
      screen.getByRole('radiogroup', { name: 'Where' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(9)
    expect(screen.getByRole('radio', { name: 'Top right' })).toBeChecked()
  })

  it('has nothing chosen when the value is none of its points', () => {
    render(
      <AnchorGrid
        labelledBy="x"
        points={POINTS}
        value={undefined}
        onChange={vi.fn()}
      />,
    )

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked()
    }
  })

  it('says which point was chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnchorGrid
        labelledBy="x"
        points={POINTS}
        value="e"
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'Bottom left' }))

    expect(onChange).toHaveBeenCalledWith('g')
  })
})
