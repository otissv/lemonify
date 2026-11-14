import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HomePage } from '@/components/home-page'

describe('HomePage', () => {
  it('renders the Lemonify heading', () => {
    render(<HomePage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Lemonify' }),
    ).toBeInTheDocument()
  })

  it('renders a shadcn button with a Remix icon', () => {
    render(<HomePage />)

    const button = screen.getByRole('button', { name: 'Get started' })

    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
