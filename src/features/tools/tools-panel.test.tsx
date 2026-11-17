import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolsPanel } from '@/features/tools/tools-panel'
import { KEYBOARD_STEP } from '@/features/tools/panel-position'
import {
  AI_CATALOGUES,
  AI_TOOLS_OFFERED,
  DOCUMENT_ID,
} from '@/test/document-fixtures'
import { Tool, useUiStore } from '@/store/ui-store'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/app/app-menu-bar', () => ({
  AppMenuBar: () => <div role="menubar" aria-label="Application" />,
}))

const SIZES: Readonly<
  Record<string, { width: number; height: number } | undefined>
> = {
  'tools-panel-bounds': { width: 1000, height: 800 },
  'floating-panel': { width: 300, height: 400 },
}

function rect(width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: 0, y: 0, width, height })
}

function renderPanel(): void {
  render(
    <div data-slot="tools-panel-bounds">
      <ToolsPanel
        documentId={DOCUMENT_ID}
        tools={AI_TOOLS_OFFERED}
        catalogues={AI_CATALOGUES}
      />
    </div>,
  )
}

function panel(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Tools' })
}

describe('ToolsPanel', () => {
  beforeEach(() => {
    resetStores()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function measure(this: HTMLElement) {
        const size = SIZES[this.dataset.slot ?? '']
        return size ? rect(size.width, size.height) : rect(0, 0)
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('floats as a non-modal dialog', () => {
    renderPanel()

    expect(panel()).toHaveAttribute('aria-modal', 'false')
    expect(panel()).toHaveClass('absolute')
  })

  describe('tabs', () => {
    it('runs down the right-hand side as a vertical toolbar', () => {
      renderPanel()
      const tablist = within(panel()).getByRole('tablist')

      expect(tablist).toHaveAttribute('aria-orientation', 'vertical')
      expect(tablist.parentElement?.lastElementChild).toBe(tablist)
    })

    it('has Tools, Options, Export, Results, Document and Navigator tabs, in that order', () => {
      renderPanel()

      expect(
        within(panel())
          .getAllByRole('tab')
          .map((tab) => tab.getAttribute('aria-label')),
      ).toEqual([
        'Tools',
        'Options',
        'Export',
        'Results',
        'Document',
        'Navigator',
      ])
    })

    it('shows the Tools tab first as an icon with no visible label', () => {
      renderPanel()
      const first = within(panel()).getAllByRole('tab').at(0)

      expect(first).toHaveAccessibleName('Tools')
      expect(first).toHaveAttribute('aria-selected', 'true')
      expect(first).not.toHaveTextContent(/\S/)
      expect(first?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })

    it('shows each tool as a square 40px button with a 20px icon', () => {
      renderPanel()
      const first = within(panel()).getAllByRole('tab').at(0)

      expect(first).toHaveClass(
        'size-10',
        'group-data-[orientation=vertical]/tabs:w-10',
      )
      expect(first).not.toHaveClass(
        'group-data-[orientation=vertical]/tabs:w-full',
      )
      expect(first?.querySelector('svg')).toHaveClass('size-5')
    })
  })

  describe('glass', () => {
    it('blurs and tints what is behind it instead of fading the whole panel', () => {
      renderPanel()

      expect(panel()).toHaveClass(
        'backdrop-blur-xl',
        'backdrop-saturate-150',
        'bg-background/60',
      )
      expect(panel()).not.toHaveClass('opacity-90', 'bg-card')
    })

    it('gives fields a darker ground of their own so they stay readable on the glass', () => {
      renderPanel()

      expect(panel()).toHaveClass(
        '[&_[data-slot=input]]:bg-background/70',
        '[&_[data-slot=select-trigger]]:bg-background/70',
      )
    })

    it('keeps text and icons solid and bright, so only the fill is see-through', () => {
      renderPanel()

      expect(panel().className).not.toMatch(/(^|\s)opacity-/)
      expect(panel()).toHaveClass(
        '[--muted-foreground:color-mix(in_oklab,var(--foreground)_95%,var(--card))]',
      )
    })
  })

  describe('tool rail', () => {
    it('keeps the content on the plain panel and marks the active tool with a light highlight', () => {
      renderPanel()
      const rail = within(panel()).getByRole('tablist')
      const active = within(rail).getByRole('tab', { selected: true })
      const content = within(panel()).getByRole('tabpanel')

      expect(rail).toHaveClass('self-stretch', 'bg-transparent')
      expect(rail.className).not.toMatch(/after:bg-/)
      for (const tab of within(rail).getAllByRole('tab')) {
        expect(tab.className).not.toMatch(
          /group-data-\[variant=line\]\/tabs-list:bg-background/,
        )
      }
      expect(content.className).not.toMatch(/bg-/)
      expect(active).toHaveClass(
        'after:hidden',
        'group-data-[variant=line]/tabs-list:data-[state=active]:bg-foreground/15',
      )
    })
  })

  describe('top row', () => {
    it('has no title, only the menu and the handle to move the panel', () => {
      renderPanel()

      expect(
        within(panel()).queryByRole('heading', { level: 2 }),
      ).not.toBeInTheDocument()
      const menu = within(panel()).getByRole('menubar', { name: 'Application' })
      const handle = within(panel()).getByRole('button', {
        name: 'Move panel',
      })
      expect(menu.parentElement).toBe(handle.parentElement)
      expect(handle.parentElement).toHaveClass('border-b')
    })
  })

  describe('navigator tab', () => {
    it('shows the Navigator, which has the same view as the canvas', async () => {
      const user = userEvent.setup()
      renderPanel()

      await user.click(screen.getByRole('tab', { name: 'Navigator' }))

      expect(useUiStore.getState().activeTool).toBe(Tool.Navigator)
      expect(
        within(screen.getByRole('tabpanel')).getByRole('status'),
      ).toHaveTextContent('There is no picture to navigate.')
    })
  })

  describe('options tab', () => {
    it('is disabled until a step is selected', () => {
      renderPanel()

      expect(screen.getByRole('tab', { name: 'Options' })).toBeDisabled()

      cleanup()
      useUiStore.getState().selectStep(DOCUMENT_ID, 'step-1')
      renderPanel()

      expect(screen.getByRole('tab', { name: 'Options' })).toBeEnabled()
    })

    it('shows the Tools tab instead when its step goes away', () => {
      useUiStore.setState({ activeTool: Tool.Options })
      renderPanel()

      expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute(
        'data-state',
        'active',
      )
    })
  })

  describe('collapsing', () => {
    it('has no drag icon on the handle', () => {
      renderPanel()

      const handle = screen.getByRole('button', { name: 'Move panel' })

      expect(handle.querySelector('svg')).toBeNull()
    })

    it('shows only the menu when collapsed, and everything again when expanded', async () => {
      const user = userEvent.setup()
      renderPanel()
      expect(screen.getByRole('tablist')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Collapse panel' }))

      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(
        within(panel()).getByRole('menubar', { name: 'Application' }),
      ).toBeInTheDocument()
      expect(useUiStore.getState().panelCollapsed).toBe(true)

      await user.click(screen.getByRole('button', { name: 'Expand panel' }))

      expect(screen.getByRole('tablist')).toBeInTheDocument()
      expect(useUiStore.getState().panelCollapsed).toBe(false)
    })

    it('can still be dragged while collapsed', () => {
      useUiStore.setState({ panelCollapsed: true })
      renderPanel()
      const handle = screen.getByRole('button', { name: 'Move panel' })

      fireEvent.pointerDown(handle, {
        clientX: 500,
        clientY: 100,
        pointerId: 1,
      })
      fireEvent.pointerMove(handle, {
        clientX: 400,
        clientY: 250,
        pointerId: 1,
      })

      expect(useUiStore.getState().panelPosition).not.toBeNull()
    })
  })

  describe('moving', () => {
    it('drags with the pointer and remembers the position', () => {
      renderPanel()
      const handle = screen.getByRole('button', { name: 'Move panel' })

      fireEvent.pointerDown(handle, {
        clientX: 500,
        clientY: 100,
        pointerId: 1,
      })
      fireEvent.pointerMove(handle, {
        clientX: 400,
        clientY: 250,
        pointerId: 1,
      })
      fireEvent.pointerUp(handle, { clientX: 400, clientY: 250, pointerId: 1 })

      expect(useUiStore.getState().panelPosition).toEqual({ x: 584, y: 166 })
      expect(panel()).toHaveStyle({ left: '584px', top: '166px' })
    })

    it('cannot be dragged outside the content area', () => {
      renderPanel()
      const handle = screen.getByRole('button', { name: 'Move panel' })

      fireEvent.pointerDown(handle, {
        clientX: 500,
        clientY: 100,
        pointerId: 1,
      })
      fireEvent.pointerMove(handle, {
        clientX: 2500,
        clientY: -900,
        pointerId: 1,
      })

      expect(useUiStore.getState().panelPosition).toEqual({ x: 700, y: 0 })
    })

    it('moves with the arrow keys on the handle', async () => {
      useUiStore.setState({ panelPosition: { x: 100, y: 100 } })
      const user = userEvent.setup()
      renderPanel()

      screen.getByRole('button', { name: 'Move panel' }).focus()
      await user.keyboard('{ArrowDown}')

      expect(useUiStore.getState().panelPosition).toEqual({
        x: 100,
        y: 100 + KEYBOARD_STEP,
      })
    })
  })
})
