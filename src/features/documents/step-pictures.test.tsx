import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  StepPicture,
  StepPictures,
  StepThumbnail,
} from '@/features/documents/step-pictures'

describe('StepPictures', () => {
  it('groups whatever pictures it is given, in the order given, under one name', () => {
    render(
      <StepPictures label="Pictures of Mask">
        <StepPicture
          label="Output of Mask"
          title="Output"
          subtitle="After this step"
          url={undefined}
          pressed={false}
          onClick={vi.fn()}
        />
        <StepPicture
          label="Mask picture"
          title="Mask"
          subtitle="Painted"
          url="/m.webp"
          pressed
          onClick={vi.fn()}
        />
        <StepPicture
          label="Another picture"
          title="Another"
          subtitle="Any number of them"
          url={undefined}
          pressed={false}
          onClick={vi.fn()}
        />
      </StepPictures>,
    )

    const group = screen.getByRole('group', { name: 'Pictures of Mask' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Output of Mask', 'Mask picture', 'Another picture'])
  })
})

describe('StepPicture', () => {
  it('shows its small picture, its title and its line, and says when it is the one shown', () => {
    render(
      <StepPicture
        label="Mask picture"
        title="Mask"
        subtitle="Painted"
        url="/m.webp"
        pressed
        onClick={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: 'Mask picture' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.querySelector('img')).toHaveAttribute('src', '/m.webp')
    expect(within(button).getByText('Mask')).toBeVisible()
    expect(within(button).getByText('Painted')).toBeVisible()
  })

  it('shows a placeholder while it has no picture, and hands the click to its owner', () => {
    const onClick = vi.fn()
    render(
      <StepPicture
        label="Mask picture"
        title="Mask"
        subtitle="Painted"
        url={undefined}
        pressed={false}
        onClick={onClick}
      />,
    )

    const button = screen.getByRole('button', { name: 'Mask picture' })
    expect(button.querySelector('img')).toBeNull()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('marks a problem in the line under it', () => {
    render(
      <StepPicture
        label="Mask picture"
        title="Mask"
        subtitle="Needs a size"
        problem
        url={undefined}
        pressed={false}
        onClick={vi.fn()}
      />,
    )
    expect(screen.getByText('Needs a size').className).toContain(
      'text-destructive',
    )
  })
})

describe('StepThumbnail', () => {
  it('is a picture when there is a url and a placeholder when there is not', () => {
    const { container, rerender } = render(<StepThumbnail url="/a.webp" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/a.webp')
    rerender(<StepThumbnail url={undefined} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
