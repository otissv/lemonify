import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteDocument,
  getDocument,
  changeDocument,
  listDocuments,
  moveDocument,
  renameDocument,
} from '@/features/documents/document-functions'
import type { DocumentSummary } from '@/features/documents/document'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { followJob } from '@/features/jobs/follow-job'
import {
  requestPreview,
  requestThumbnails,
  requestWorkflowThumbnails,
} from '@/features/render/render-functions'
import {
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  renameWorkflow,
} from '@/features/workflows/workflow-functions'
import {
  PREFERENCES_STORAGE_KEY,
  SidebarTab,
  useUiStore,
} from '@/store/ui-store'
import { documentView, previewJob } from '@/test/document-fixtures'
import { workflowView } from '@/test/workflow-fixtures'
import { renderApp } from '@/test/render-app'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  moveDocument: vi.fn(),
  renameDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  renameWorkflow: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestWorkflowThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))

const FIRST_ID = '6f1c6c4e-0f43-4a8f-9a57-2d2f0f8f2b11'
const SECOND_ID = '7a2d7d5f-1f54-4b9a-8b68-3e3a1a9a3c22'

function summary(id: string, name: string): DocumentSummary {
  const { source } = documentView([], id, name)
  return {
    id,
    name,
    source,
    revision: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const FIRST = summary(FIRST_ID, 'one.png')
const SECOND = summary(SECOND_ID, 'two.png')

function sidebar(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    '[data-slot="sidebar"][data-state]',
  )
  if (!element) throw new Error('Sidebar is not rendered')
  return element
}

/** jsdom has no drag data, so this holds what is set on the drag. */
function dragData(): DataTransfer {
  const data = new Map<string, string>()
  return {
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => {
      data.set(type, value)
    },
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
  } as unknown as DataTransfer
}

/** The part of a document's item that is dragged to reorder it. */
function handleOf(name: string): HTMLElement {
  const handle = documentLink(name).parentElement
  if (!handle) throw new Error(`No row for ${name}.`)
  return handle
}

function documentLink(name: string): HTMLElement {
  return screen.getByRole('link', { name })
}

describe('AppLayout', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(getWorkflow).mockImplementation(async ({ data }) =>
      Promise.resolve(workflowView(data.id, 'Web sizes')),
    )
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(requestPreview).mockResolvedValue({ id: 'p' } as never)
    vi.mocked(requestThumbnails).mockResolvedValue({ id: 't' } as never)
    vi.mocked(requestWorkflowThumbnails).mockResolvedValue({ id: 'wt' } as never)
    vi.mocked(followJob).mockResolvedValue(previewJob())
    vi.mocked(getDocument).mockImplementation(({ data }) =>
      Promise.resolve(
        documentView([], data.id, data.id === FIRST_ID ? 'one.png' : 'two.png'),
      ),
    )
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('restores the preferences kept in this browser', async () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ state: { recentUpscaleModels: ['waifu'] }, version: 0 }),
    )

    await renderApp()

    await waitFor(() => {
      expect(useUiStore.getState().recentUpscaleModels).toEqual(['waifu'])
    })
  })

  describe('sidebar edge button', () => {
    it('collapses and brings back the sidebar from a tab on its edge', async () => {
      const user = userEvent.setup()
      await renderApp()
      expect(useUiStore.getState().sidebarOpen).toBe(true)

      const hide = screen.getByRole('button', { name: 'Hide sidebar' })
      expect(hide).toHaveAttribute('aria-expanded', 'true')
      expect(hide.closest('header')).toBeNull()
      expect(hide).toHaveClass('size-8')
      await user.click(hide)

      expect(useUiStore.getState().sidebarOpen).toBe(false)
      const show = screen.getByRole('button', { name: 'Show sidebar' })
      expect(show).toHaveAttribute('aria-expanded', 'false')
      await user.click(show)

      expect(useUiStore.getState().sidebarOpen).toBe(true)
    })
  })

  describe('sidebar', () => {
    it('is expanded on the right', async () => {
      await renderApp()

      expect(sidebar()).toHaveAttribute('data-state', 'expanded')
      expect(sidebar()).toHaveAttribute('data-side', 'right')
    })

    it('shows no branding', async () => {
      await renderApp()

      expect(sidebar()).not.toHaveTextContent('Lemonify')
      expect(
        sidebar().querySelector('[data-slot="sidebar-header"]'),
      ).not.toBeInTheDocument()
    })

    it('has Editor and Workflow tabs, starting on Editor', async () => {
      await renderApp()
      const tabs = within(sidebar()).getAllByRole('tab')

      expect(tabs.map((tab) => tab.textContent)).toEqual(['Editor', 'Workflow'])
      expect(
        within(sidebar()).getByRole('tab', { name: 'Editor' }),
      ).toHaveAttribute('aria-selected', 'true')
    })

    it('lists the documents on the Editor tab, with no open buttons', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST])
      await renderApp()
      const editor = within(sidebar()).getByRole('tabpanel', { name: 'Editor' })

      expect(
        within(editor).queryByRole('button', { name: 'Open image' }),
      ).not.toBeInTheDocument()
      expect(
        within(editor).queryByRole('button', { name: 'Open library image' }),
      ).not.toBeInTheDocument()
      expect(
        within(editor).getByRole('link', { name: 'one.png' }),
      ).toBeInTheDocument()
    })

    it('switches to the Workflow tab and remembers it in the store', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(within(sidebar()).getByRole('tab', { name: 'Workflow' }))

      const workflow = within(sidebar()).getByRole('tabpanel', {
        name: 'Workflow',
      })
      expect(within(workflow).getByRole('status')).toHaveTextContent(
        'No workflows yet.',
      )
      expect(
        screen.queryByRole('button', { name: 'Open image' }),
      ).not.toBeInTheDocument()
      expect(useUiStore.getState().sidebarTab).toBe(SidebarTab.Workflow)
    })

    it('lists one link per document, at the address of its page', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      await renderApp()

      expect(documentLink('one.png')).toHaveAttribute(
        'href',
        `/documents/${FIRST_ID}`,
      )
      expect(documentLink('two.png')).toHaveAttribute(
        'href',
        `/documents/${SECOND_ID}`,
      )
    })

    it('shows document names in the normal text colour, not link blue', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      await renderApp()

      for (const name of ['one.png', 'two.png']) {
        expect(documentLink(name)).toHaveClass(
          'text-foreground',
          'hover:text-foreground',
        )
      }
    })

    it('marks the document being viewed as active', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      await renderApp(`/documents/${SECOND_ID}`)

      expect(documentLink('two.png')).toHaveAttribute('data-active', 'true')
      expect(documentLink('one.png')).toHaveAttribute('data-active', 'false')
    })

    it('lists the workflows the server holds', async () => {
      vi.mocked(listWorkflows).mockResolvedValue([
        workflowView('w1', 'Saved earlier'),
      ])
      const user = userEvent.setup()
      await renderApp()

      await user.click(within(sidebar()).getByRole('tab', { name: 'Workflow' }))

      expect(
        within(sidebar()).getByRole('link', { name: 'Saved earlier' }),
      ).toHaveAttribute('href', '/workflows/w1')
    })

    it('searches the documents by name or file name', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      const user = userEvent.setup()
      await renderApp()
      const search = within(sidebar()).getByRole('searchbox', {
        name: 'Search images',
      })

      await user.type(search, 'two')

      expect(documentLink('two.png')).toBeVisible()
      expect(screen.queryByRole('link', { name: 'one.png' })).toBeNull()

      await user.clear(search)
      await user.type(search, 'zzz')

      expect(within(sidebar()).getByRole('status')).toHaveTextContent(
        'No images match “zzz”.',
      )

      await user.clear(search)

      expect(documentLink('one.png')).toBeVisible()
      expect(documentLink('two.png')).toBeVisible()
    })

    it('searches the workflows by name', async () => {
      vi.mocked(listWorkflows).mockResolvedValue([
        workflowView('w1', 'Web sizes'),
        workflowView('w2', 'Print'),
      ])
      const user = userEvent.setup()
      await renderApp()
      await user.click(within(sidebar()).getByRole('tab', { name: 'Workflow' }))

      await user.type(
        within(sidebar()).getByRole('searchbox', { name: 'Search workflows' }),
        'prin',
      )

      expect(
        within(sidebar()).getByRole('link', { name: 'Print' }),
      ).toBeVisible()
      expect(
        within(sidebar()).queryByRole('link', { name: 'Web sizes' }),
      ).toBeNull()
    })

    it('deletes a document and leaves its page', async () => {
      vi.mocked(listDocuments)
        .mockResolvedValueOnce([FIRST])
        .mockResolvedValue([])
      vi.mocked(deleteDocument).mockResolvedValue(undefined)
      const user = userEvent.setup()
      const { router } = await renderApp(`/documents/${FIRST_ID}`)

      await user.click(screen.getByRole('button', { name: 'Delete one.png' }))

      expect(deleteDocument).toHaveBeenCalledWith({ data: { id: FIRST_ID } })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
      expect(
        screen.queryByRole('link', { name: 'one.png' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('workflows in the sidebar', () => {
    async function showWorkflows(path = '/') {
      vi.mocked(listWorkflows).mockResolvedValue([
        workflowView('w1', 'Web sizes'),
      ])
      const user = userEvent.setup()
      const rendered = await renderApp(path)
      await user.click(within(sidebar()).getByRole('tab', { name: 'Workflow' }))
      return { user, ...rendered }
    }

    it('renames a workflow in place on a double-click, and saves it on Enter', async () => {
      vi.mocked(renameWorkflow).mockResolvedValue({
        ...workflowView('w1', 'Resize'),
      })
      const { user } = await showWorkflows()

      await user.dblClick(
        within(sidebar()).getByText('Web sizes', { selector: 'span' }),
      )
      await user.keyboard('Resize{Enter}')

      expect(renameWorkflow).toHaveBeenCalledWith({
        data: { id: 'w1', name: 'Resize' },
      })
    })

    it('shows why a rename failed', async () => {
      vi.mocked(renameWorkflow).mockRejectedValue(new Error('Name taken.'))
      const { user } = await showWorkflows()

      await user.dblClick(
        within(sidebar()).getByText('Web sizes', { selector: 'span' }),
      )
      await user.keyboard('Other{Enter}')

      expect(await within(sidebar()).findByRole('alert')).toHaveTextContent(
        'Name taken.',
      )
    })

    it('deletes a workflow, forgets it and leaves its page', async () => {
      vi.mocked(deleteWorkflow).mockResolvedValue(undefined)
      const { user, router } = await showWorkflows('/workflows/w1')

      await user.click(screen.getByRole('button', { name: 'Delete Web sizes' }))

      expect(deleteWorkflow).toHaveBeenCalledWith({ data: { id: 'w1' } })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    })

    it('expands to show a preview of the output when nothing is selected', async () => {
      const { user } = await showWorkflows()
      const bar = sidebar()
      const panel = within(bar)
      const preview = () =>
        bar.querySelector('[data-slot="workflow-sidebar-preview"]')

      expect(preview()).not.toBeInTheDocument()
      await user.click(
        panel.getByRole('button', { name: 'Show preview of Web sizes' }),
      )
      await waitFor(() => {
        expect(preview()).toBeInTheDocument()
      })
      expect(getWorkflow).toHaveBeenCalled()
    })
  })

  describe('renaming a document', () => {
    it('edits the name in place on a double-click, and saves it on Enter', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST])
      vi.mocked(renameDocument).mockResolvedValue({
        ...documentView(),
        id: FIRST_ID,
        name: 'Summer',
      })
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)

      await user.dblClick(screen.getByText('one.png', { selector: 'span' }))
      await user.keyboard('Summer{Enter}')

      expect(renameDocument).toHaveBeenCalledWith({
        data: { id: FIRST_ID, name: 'Summer' },
      })
      await waitFor(() => {
        expect(
          screen.queryByRole('textbox', { name: 'Document name' }),
        ).not.toBeInTheDocument()
      })
    })

    it('starts editing on F2, so the keyboard can rename too', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST])
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)

      screen.getByRole('link', { name: 'one.png' }).focus()
      await user.keyboard('{F2}')

      expect(
        await screen.findByRole('textbox', { name: 'Document name' }),
      ).toHaveFocus()
    })

    it('leaves the name alone on Escape', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST])
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)

      await user.dblClick(screen.getByText('one.png', { selector: 'span' }))
      await user.keyboard('Summer{Escape}')

      expect(renameDocument).not.toHaveBeenCalled()
      expect(screen.getByRole('link', { name: 'one.png' })).toBeVisible()
    })

    it('says why a name could not be saved, and keeps the old one', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST])
      vi.mocked(renameDocument).mockRejectedValue(new Error('Enter a name.'))
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)

      await user.dblClick(screen.getByText('one.png', { selector: 'span' }))
      await user.keyboard('Summer{Enter}')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Enter a name.',
      )
      expect(screen.getByRole('link', { name: 'one.png' })).toBeVisible()
    })
  })

  it('has no header: the page fills the area and the menu is in the panel', async () => {
    await renderApp()

    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.getByRole('main').className).not.toMatch(/\bp-\d/)
    expect(
      within(await screen.findByRole('dialog', { name: 'Menu' })).getByRole(
        'menubar',
        { name: 'Application' },
      ),
    ).toBeVisible()
  })

  describe('reordering documents', () => {
    const THIRD_ID = '8b3e8e6a-2a65-4c0b-9c79-4f4b2b0b4d33'
    const THIRD = summary(THIRD_ID, 'three.png')

    function names(): string[] {
      return within(screen.getByRole('list', { name: 'Open images' }))
        .getAllByRole('link')
        .map((link) => link.textContent ?? '')
    }

    function rowOf(name: string): HTMLElement {
      const row = documentLink(name).closest('li')
      if (!row) throw new Error(`No row for ${name}.`)
      return row
    }

    beforeEach(() => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND, THIRD])
      vi.mocked(moveDocument).mockResolvedValue(undefined)
    })

    it('moves a document up and down with Alt and the arrow keys, and saves it', async () => {
      await renderApp(`/documents/${FIRST_ID}`)

      fireEvent.keyDown(documentLink('two.png'), {
        key: 'ArrowUp',
        altKey: true,
      })

      expect(moveDocument).toHaveBeenCalledWith({
        data: { id: SECOND_ID, index: 0 },
      })
      expect(names()).toEqual(['two.png', 'one.png', 'three.png'])

      fireEvent.keyDown(documentLink('two.png'), {
        key: 'ArrowDown',
        altKey: true,
      })

      expect(moveDocument).toHaveBeenLastCalledWith({
        data: { id: SECOND_ID, index: 1 },
      })
      expect(names()).toEqual(['one.png', 'two.png', 'three.png'])
    })

    it('does not move the first document up or the last one down', async () => {
      await renderApp(`/documents/${FIRST_ID}`)

      fireEvent.keyDown(documentLink('one.png'), {
        key: 'ArrowUp',
        altKey: true,
      })
      fireEvent.keyDown(documentLink('three.png'), {
        key: 'ArrowDown',
        altKey: true,
      })

      expect(moveDocument).not.toHaveBeenCalled()
    })

    it('leaves the arrow keys alone without Alt', async () => {
      await renderApp(`/documents/${FIRST_ID}`)

      const handled = fireEvent.keyDown(documentLink('two.png'), {
        key: 'ArrowUp',
      })

      expect(handled).toBe(true)
      expect(moveDocument).not.toHaveBeenCalled()
    })

    it('moves a document to where another is dropped on it', async () => {
      await renderApp(`/documents/${FIRST_ID}`)

      const dataTransfer = dragData()
      fireEvent.dragStart(handleOf('three.png'), { dataTransfer })
      fireEvent.dragOver(rowOf('one.png'), { dataTransfer })
      fireEvent.drop(rowOf('one.png'), { dataTransfer })

      expect(moveDocument).toHaveBeenCalledWith({
        data: { id: THIRD_ID, index: 0 },
      })
      expect(names()).toEqual(['three.png', 'one.png', 'two.png'])
    })

    it('shows the document being dragged as faded, until it is dropped or let go', async () => {
      await renderApp(`/documents/${FIRST_ID}`)

      fireEvent.dragStart(handleOf('two.png'), { dataTransfer: dragData() })
      expect(handleOf('two.png')).toHaveClass('opacity-50')

      fireEvent.dragEnd(handleOf('two.png'))
      expect(handleOf('two.png')).not.toHaveClass('opacity-50')
      expect(moveDocument).not.toHaveBeenCalled()
    })

    it('ignores something dragged in that is not a document', async () => {
      await renderApp(`/documents/${FIRST_ID}`)

      const dataTransfer = dragData()
      const accepted = fireEvent.dragOver(rowOf('one.png'), { dataTransfer })
      fireEvent.drop(rowOf('one.png'), { dataTransfer })

      expect(accepted).toBe(true)
      expect(moveDocument).not.toHaveBeenCalled()
    })

    it('puts the order back and says so when it could not be saved', async () => {
      vi.mocked(moveDocument).mockRejectedValue(new Error('Offline.'))
      await renderApp(`/documents/${FIRST_ID}`)

      fireEvent.keyDown(documentLink('two.png'), {
        key: 'ArrowUp',
        altKey: true,
      })

      expect(await screen.findByRole('alert')).toHaveTextContent('Offline.')
      expect(names()).toEqual(['one.png', 'two.png', 'three.png'])
    })

    it('follows the order the server lists when the list is read again', async () => {
      vi.mocked(listDocuments)
        .mockResolvedValueOnce([FIRST, SECOND, THIRD])
        .mockResolvedValue([SECOND, THIRD, FIRST])
      await renderApp(`/documents/${FIRST_ID}`)

      fireEvent.keyDown(documentLink('one.png'), {
        key: 'ArrowDown',
        altKey: true,
      })

      await waitFor(() => {
        expect(names()).toEqual(['two.png', 'three.png', 'one.png'])
      })
    })

    it('cannot be done while the list is filtered, since the list shown is not the whole list', async () => {
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)
      await user.type(
        screen.getByRole('searchbox', { name: 'Search images' }),
        'o',
      )

      fireEvent.keyDown(documentLink('two.png'), {
        key: 'ArrowUp',
        altKey: true,
      })

      expect(moveDocument).not.toHaveBeenCalled()
      expect(handleOf('two.png')).not.toHaveAttribute('draggable', 'true')
    })
  })

  describe('dragging a step onto another document', () => {
    const BLUR = createSharpStep('blur', { sigma: 4 })

    function stepRow(name: string): HTMLElement {
      const row = within(screen.getByRole('list', { name: `Steps of ${name}` }))
        .getByRole('button', { name: 'Blur' })
        .closest('li')
      if (!row) throw new Error('No step row.')
      return row
    }

    function rowOf(name: string): HTMLElement {
      const row = documentLink(name).closest('li')
      if (!row) throw new Error(`No row for ${name}.`)
      return row
    }

    async function show(): Promise<void> {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      vi.mocked(getDocument).mockImplementation(({ data }) =>
        Promise.resolve(
          data.id === FIRST_ID
            ? documentView([BLUR], FIRST_ID, 'one.png')
            : documentView([], SECOND_ID, 'two.png'),
        ),
      )
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)
      await user.click(
        await screen.findByRole('button', { name: 'Show steps of one.png' }),
      )
      await screen.findByRole('list', { name: 'Steps of one.png' })
    }

    it('adds a copy of the step to the other document', async () => {
      await show()
      vi.mocked(changeDocument).mockResolvedValue(
        documentView([], SECOND_ID, 'two.png'),
      )
      const dataTransfer = dragData()

      fireEvent.dragStart(stepRow('one.png'), { dataTransfer })
      fireEvent.dragOver(rowOf('two.png'), { dataTransfer })
      fireEvent.drop(rowOf('two.png'), { dataTransfer })

      await waitFor(() => {
        expect(changeDocument).toHaveBeenCalledWith({
          data: {
            id: SECOND_ID,
            revision: 0,
            change: {
              type: 'add-step',
              step: { ...BLUR, id: expect.not.stringMatching(BLUR.id) },
              index: 1,
            },
          },
        })
      })
      expect(
        screen.getByRole('list', { name: 'Steps of one.png' }),
      ).toBeInTheDocument()
    })

    it('shows the document it would be copied to while the step is over it', async () => {
      await show()
      const dataTransfer = dragData()
      fireEvent.dragStart(stepRow('one.png'), { dataTransfer })

      fireEvent.dragOver(rowOf('two.png'), { dataTransfer })
      expect(rowOf('two.png')).toHaveAttribute('data-drop-target', 'true')

      fireEvent.dragLeave(rowOf('two.png'))
      expect(rowOf('two.png')).toHaveAttribute('data-drop-target', 'false')
    })

    it('does not take a step dragged over the document it is from', async () => {
      await show()
      const dataTransfer = dragData()
      fireEvent.dragStart(stepRow('one.png'), { dataTransfer })

      const accepted = fireEvent.dragOver(rowOf('one.png'), { dataTransfer })
      fireEvent.drop(rowOf('one.png'), { dataTransfer })

      expect(accepted).toBe(true)
      expect(rowOf('one.png')).toHaveAttribute('data-drop-target', 'false')
      expect(changeDocument).not.toHaveBeenCalled()
    })

    it('does not mistake a dragged step for a dragged document', async () => {
      await show()
      const dataTransfer = dragData()

      fireEvent.dragStart(stepRow('one.png'), { dataTransfer })

      expect(handleOf('one.png')).not.toHaveClass('opacity-50')
      expect(dataTransfer.getData('application/x-lemonify-document')).toBe('')
      fireEvent.drop(rowOf('two.png'), { dataTransfer })
      expect(moveDocument).not.toHaveBeenCalled()
    })

    it('says why when the other document would not take it', async () => {
      await show()
      vi.mocked(changeDocument).mockRejectedValue(new Error('Not allowed.'))
      const dataTransfer = dragData()

      fireEvent.dragStart(stepRow('one.png'), { dataTransfer })
      fireEvent.drop(rowOf('two.png'), { dataTransfer })

      expect(
        await within(rowOf('two.png')).findByRole('alert'),
      ).toHaveTextContent('Not allowed.')
    })
  })

  describe('a document row', () => {
    it('toggles its steps when the name is clicked', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)

      await user.click(documentLink('one.png'))
      expect(
        await screen.findByRole('button', { name: 'Hide steps of one.png' }),
      ).toHaveAttribute('aria-expanded', 'true')

      await user.click(documentLink('one.png'))
      expect(
        await screen.findByRole('button', { name: 'Show steps of one.png' }),
      ).toHaveAttribute('aria-expanded', 'false')
    })

    it('shows the active background behind the whole row, toggle and delete included', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      await renderApp(`/documents/${FIRST_ID}`)

      const row = documentLink('one.png').parentElement
      expect(row).toHaveAttribute('data-active', 'true')
      expect(row).toHaveClass('data-[active=true]:bg-sidebar-accent')
      expect(
        within(row as HTMLElement).getByRole('button', {
          name: 'Show steps of one.png',
        }),
      ).toBeInTheDocument()
      expect(
        within(row as HTMLElement).getByRole('button', {
          name: 'Delete one.png',
        }),
      ).toBeInTheDocument()
      expect(documentLink('two.png').parentElement).toHaveAttribute(
        'data-active',
        'false',
      )
    })
  })

  describe('navigating between documents', () => {
    it('shows a document when its sidebar link is clicked', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      const user = userEvent.setup()
      await renderApp(`/documents/${FIRST_ID}`)

      await user.click(documentLink('two.png'))

      expect(
        await screen.findByRole('img', { name: 'two.png' }),
      ).toBeInTheDocument()
    })

    it('returns to the previous document with the back button', async () => {
      vi.mocked(listDocuments).mockResolvedValue([FIRST, SECOND])
      const user = userEvent.setup()
      const { router } = await renderApp(`/documents/${FIRST_ID}`)

      await user.click(documentLink('two.png'))
      await screen.findByRole('img', { name: 'two.png' })
      router.history.back()

      expect(
        await screen.findByRole('img', { name: 'one.png' }),
      ).toBeInTheDocument()
    })

    it('says why a document cannot be opened', async () => {
      vi.mocked(getDocument).mockRejectedValue(
        new Error('That image does not exist.'),
      )
      await renderApp(`/documents/${FIRST_ID}`)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'That image does not exist.',
      )
    })
  })

  describe('tools panel', () => {
    it('floats over an open document', async () => {
      await renderApp(`/documents/${FIRST_ID}`)

      expect(
        await screen.findByRole('dialog', { name: 'Tools' }),
      ).toBeInTheDocument()
    })

    it('is not shown while the document has not loaded', async () => {
      vi.mocked(getDocument).mockRejectedValue(new Error('Gone.'))
      await renderApp(`/documents/${FIRST_ID}`)
      await screen.findByRole('alert')

      expect(
        screen.queryByRole('dialog', { name: 'Tools' }),
      ).not.toBeInTheDocument()
    })

    it('is not shown on the home page, which has only the menu panel', async () => {
      await renderApp()

      expect(
        screen.queryByRole('dialog', { name: 'Tools' }),
      ).not.toBeInTheDocument()
      expect(
        await screen.findByRole('dialog', { name: 'Menu' }),
      ).toBeInTheDocument()
    })

    it('leaves the menu available while a document has not loaded', async () => {
      vi.mocked(getDocument).mockRejectedValue(new Error('Gone.'))
      await renderApp(`/documents/${FIRST_ID}`)
      await screen.findByRole('alert')

      expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument()
    })
  })
})
