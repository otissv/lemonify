import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listDocuments } from '@/features/documents/document-functions'
import {
  getKeybindings,
  saveKeybindings,
} from '@/features/keybindings/keybinding-functions'
import { keybindingsView } from '@/features/keybindings/keybindings-view'
import type { KeybindingsFile } from '@/features/keybindings/keybindings-file'
import { listSources } from '@/features/sources/source-functions'
import {
  INITIAL_SOURCES_STATE,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import { renderApp } from '@/test/render-app'

vi.mock('@/features/auth/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
}))

const NONE: KeybindingsFile = { version: 1, bindings: {} }

async function openDialog(): Promise<HTMLElement> {
  await renderApp()
  await screen.findByRole('menubar', { name: 'Application' })
  useAppStore.getState().setShortcutsOpen(true)
  return screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
}

function row(dialog: HTMLElement, label: string): HTMLElement {
  const item = [...dialog.querySelectorAll('li')].find(
    (candidate) =>
      candidate.firstElementChild?.firstElementChild?.textContent === label,
  )
  if (item === undefined) throw new Error(`no row for ${label}`)
  return item
}

function press(code: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { code, ...init })
}

describe('the shortcuts dialog', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    useSourcesStore.setState(INITIAL_SOURCES_STATE)
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(listSources).mockResolvedValue([])
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('lists every action under its group, with its keys', async () => {
    const dialog = await openDialog()

    expect(within(dialog).getByRole('region', { name: 'Edit' })).toBeVisible()
    expect(within(dialog).getByRole('region', { name: 'View' })).toBeVisible()
    const undo = row(dialog, 'Undo')
    expect(within(undo).getByText('Ctrl+Z')).toBeVisible()
    expect(within(row(dialog, 'Redo')).getByText('Ctrl+Y')).toBeVisible()
  })

  it('searches by action name, group or key', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog()
    const search = within(dialog).getByRole('searchbox', {
      name: 'Search shortcuts',
    })

    await user.type(search, 'ctrl+y')
    expect(within(dialog).getByText('Redo')).toBeVisible()
    expect(within(dialog).queryByText('Undo')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'zzzz')
    expect(
      within(dialog).getByText('No action or key matches that.'),
    ).toBeVisible()
  })

  it('changes a key by pressing the one wanted, and saves the whole file', async () => {
    const user = userEvent.setup()
    vi.mocked(saveKeybindings).mockResolvedValue(NONE as never)
    const dialog = await openDialog()

    await user.click(
      within(row(dialog, 'Undo')).getByRole('button', {
        name: /Change the key/,
      }),
    )
    expect(
      within(dialog).getByText('Press the key you want, or Esc to cancel.'),
    ).toBeVisible()
    press('KeyU', { altKey: true })

    await waitFor(() => {
      expect(saveKeybindings).toHaveBeenCalledWith({
        data: { version: 1, bindings: { 'edit.undo': ['alt+u'] } },
      })
    })
  })

  it('cancels recording with Escape without closing the dialog', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog()

    await user.click(
      within(row(dialog, 'Undo')).getByRole('button', {
        name: /Change the key/,
      }),
    )
    press('Escape')

    await waitFor(() => {
      expect(
        within(dialog).queryByText(/Press the key you want/),
      ).not.toBeInTheDocument()
    })
    expect(
      screen.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeVisible()
    expect(saveKeybindings).not.toHaveBeenCalled()
  })

  it('refuses a key the browser keeps, and says so', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog()

    await user.click(
      within(row(dialog, 'Undo')).getByRole('button', {
        name: /Change the key/,
      }),
    )
    press('KeyW', { ctrlKey: true })

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /kept by the browser/,
    )
    expect(saveKeybindings).not.toHaveBeenCalled()
  })

  it('asks before taking a key from another action, then saves both changes together', async () => {
    const user = userEvent.setup()
    vi.mocked(saveKeybindings).mockResolvedValue(NONE as never)
    const dialog = await openDialog()

    await user.click(
      within(row(dialog, 'Fit the picture to the window')).getByRole('button', {
        name: /Change the key/,
      }),
    )
    press('KeyZ', { ctrlKey: true })

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('already belongs to Undo')
    expect(saveKeybindings).not.toHaveBeenCalled()

    await user.click(
      within(alert).getByRole('button', { name: 'Move it here' }),
    )
    await waitFor(() => {
      expect(saveKeybindings).toHaveBeenCalledWith({
        data: {
          version: 1,
          bindings: { 'view.fit': ['mod+z'], 'edit.undo': [] },
        },
      })
    })
  })

  it('leaves the key where it was when asked to', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog()

    await user.click(
      within(row(dialog, 'Fit the picture to the window')).getByRole('button', {
        name: /Change the key/,
      }),
    )
    press('KeyZ', { ctrlKey: true })
    const alert = await within(dialog).findByRole('alert')
    await user.click(
      within(alert).getByRole('button', { name: 'Keep it there' }),
    )

    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(saveKeybindings).not.toHaveBeenCalled()
  })

  it('adds a key, takes keys off, and puts the defaults back for one action or all', async () => {
    const user = userEvent.setup()
    vi.mocked(getKeybindings).mockResolvedValue(
      keybindingsView(
        { version: 1, bindings: { 'edit.undo': ['alt+u'] } },
        '2026-01-01T00:00:00.000Z',
      ),
    )
    vi.mocked(saveKeybindings).mockResolvedValue(NONE as never)
    const dialog = await openDialog()
    const undo = row(dialog, 'Undo')

    await user.click(within(undo).getByRole('button', { name: /Add a key/ }))
    press('KeyJ', { altKey: true })
    await waitFor(() => {
      expect(saveKeybindings).toHaveBeenLastCalledWith({
        data: { version: 1, bindings: { 'edit.undo': ['alt+u', 'alt+j'] } },
      })
    })

    await user.click(
      within(undo).getByRole('button', { name: /Remove the keys/ }),
    )
    await waitFor(() => {
      expect(saveKeybindings).toHaveBeenLastCalledWith({
        data: { version: 1, bindings: { 'edit.undo': [] } },
      })
    })

    await user.click(
      within(undo).getByRole('button', { name: /default keys back/ }),
    )
    await waitFor(() => {
      expect(saveKeybindings).toHaveBeenLastCalledWith({ data: NONE })
    })

    await user.click(within(dialog).getByRole('button', { name: 'Reset all' }))
    await user.click(within(dialog).getByRole('button', { name: 'Reset all' }))
    await waitFor(() => {
      expect(saveKeybindings).toHaveBeenLastCalledWith({ data: NONE })
    })
  })

  it('only offers to reset what was changed', async () => {
    const dialog = await openDialog()

    expect(
      within(dialog).getByRole('button', { name: 'Reset all' }),
    ).toBeDisabled()
    expect(
      within(row(dialog, 'Undo')).getByRole('button', {
        name: /default keys back/,
      }),
    ).toBeDisabled()
  })

  it('shows why a save was refused', async () => {
    const user = userEvent.setup()
    vi.mocked(saveKeybindings).mockRejectedValue(new Error('Nope, not that.'))
    const dialog = await openDialog()

    await user.click(
      within(row(dialog, 'Undo')).getByRole('button', {
        name: /Remove the keys/,
      }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Nope, not that.',
    )
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    await openDialog()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Keyboard shortcuts' }),
      ).not.toBeInTheDocument()
    })
    expect(useAppStore.getState().shortcutsOpen).toBe(false)
  })
})
