import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SplitButton } from '@/components/ui/split-button'

function renderSplit(onPick = vi.fn()): void {
  render(
    <SplitButton
      label="Image"
      menuLabel="Your images"
      items={[
        <DropdownMenuItem key="cat" onSelect={() => onPick('cat.png')}>
          cat.png
        </DropdownMenuItem>,
      ]}
    >
      <Button variant="secondary" size="sm" className="flex-1 rounded-r-none">
        Upload
      </Button>
    </SplitButton>,
  )
}

describe('SplitButton', () => {
  it('gives the main button and the menu button the same style', () => {
    renderSplit()

    const main = screen.getByRole('button', { name: 'Upload' })
    const menu = screen.getByRole('button', { name: 'Your images' })

    expect(main).toHaveAttribute('data-variant', 'secondary')
    expect(menu).toHaveAttribute('data-variant', 'secondary')
    expect(menu).toHaveClass('rounded-l-none')
  })

  it('makes both buttons as tall as the taller one, without a fixed height', () => {
    renderSplit()

    const group = screen.getByRole('group', { name: 'Image' })
    const menu = screen.getByRole('button', { name: 'Your images' })

    expect(group).toHaveClass('items-stretch')
    expect(menu).toHaveClass('self-stretch')
    for (const element of [group, group.parentElement, menu]) {
      expect(element?.className).not.toMatch(
        /(^|\s)(h-\d|h-\[|h-inherit|size-)/,
      )
    }
  })

  it('has no gap between the main button and the menu button', () => {
    renderSplit()

    const group = screen.getByRole('group', { name: 'Image' })
    const menu = screen.getByRole('button', { name: 'Your images' })

    expect(group.className).not.toMatch(/(^|\s)gap-/)
    expect(menu).toHaveClass('border-l-0')
  })

  it('opens its items from the menu button and picks one', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderSplit(onPick)

    await user.click(screen.getByRole('button', { name: 'Your images' }))
    await user.click(await screen.findByRole('menuitem', { name: 'cat.png' }))

    expect(onPick).toHaveBeenCalledWith('cat.png')
  })

  it('leaves out the menu button when there are no items', () => {
    render(
      <SplitButton label="Image" menuLabel="Your images" items={[]}>
        <Button variant="secondary">Upload</Button>
      </SplitButton>,
    )

    expect(
      screen.queryByRole('button', { name: 'Your images' }),
    ).not.toBeInTheDocument()
  })
})
