import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders the primary button from DESIGN.md by default', () => {
    render(<Button>Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      'bg-primary',
      'text-primary-foreground',
      'active:bg-primary-active',
      'rounded-lg',
      'text-button',
      'px-6',
      'py-4',
    )
  })

  it('renders the secondary button as a white outlined button', () => {
    render(<Button variant="secondary">Cancel</Button>)

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass(
      'bg-background',
      'text-foreground',
      'border',
      'border-border',
      'rounded-lg',
    )
  })

  it('renders icon buttons as 40px squares with small corners', () => {
    render(
      <Button variant="secondary" size="icon" aria-label="Next">
        <svg aria-hidden="true" />
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass(
      'size-10',
      'rounded-md',
    )
  })

  it('renders the link variant in the link colour', () => {
    render(<Button variant="link">Read more</Button>)

    expect(screen.getByRole('button', { name: 'Read more' })).toHaveClass(
      'text-link',
      'active:text-link-active',
      'text-body-md',
    )
  })
})
