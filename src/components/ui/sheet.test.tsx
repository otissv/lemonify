import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

function OpenableSheet(): React.JSX.Element {
  return (
    <Sheet>
      <SheetTrigger>Open settings</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Adjust the output.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  )
}

describe('Sheet', () => {
  it('opens as a labelled dialog from its trigger', async () => {
    const user = userEvent.setup()
    render(<OpenableSheet />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveAccessibleDescription('Adjust the output.')
    expect(dialog).toHaveClass('bg-background', 'text-foreground')
  })

  it('closes with its close button and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<OpenableSheet />)
    const trigger = screen.getByRole('button', { name: 'Open settings' })

    await user.click(trigger)
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(close)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes with the Escape key', async () => {
    const user = userEvent.setup()
    render(<OpenableSheet />)

    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses DESIGN.md type styles for the title and description', async () => {
    const user = userEvent.setup()
    render(<OpenableSheet />)

    await user.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveClass(
      'text-title-md',
      'font-medium',
    )
    expect(screen.getByText('Adjust the output.')).toHaveClass(
      'text-body-md',
      'text-muted-foreground',
    )
  })
})
