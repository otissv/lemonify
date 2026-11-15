import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { signOut } from '@/features/auth/auth-client'
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  redoDocument,
  undoDocument,
} from '@/features/documents/document-functions'
import { uploadSource } from '@/features/documents/upload-source'
import { followJob } from '@/features/jobs/follow-job'
import { createSharpStep } from '@/features/pipeline/pipeline'
import {
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { listSources } from '@/features/sources/source-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { INITIAL_APP_STATE, Tool, useAppStore } from '@/store/app-store'
import { DOCUMENT_ID, documentView } from '@/test/document-fixtures'
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
vi.mock('@/features/documents/upload-source', () => ({
  uploadSource: vi.fn(),
}))
vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))

const BLUR = createSharpStep('blur')

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<HTMLElement> {
  await user.click(await screen.findByRole('menuitem', { name }))
  return screen.findByRole('menu')
}

describe('AppMenuBar', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(requestPreview).mockResolvedValue({ id: 'p' } as never)
    vi.mocked(requestThumbnails).mockResolvedValue({ id: 't' } as never)
    vi.mocked(followJob).mockReturnValue(new Promise(() => undefined))
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('with no document open', () => {
    it('floats in a Menu panel, with no header on the page', async () => {
      await renderApp()

      const panel = await screen.findByRole('dialog', { name: 'Menu' })
      expect(
        within(panel).getByRole('menubar', { name: 'Application' }),
      ).toBeVisible()
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
      expect(
        within(panel)
          .getAllByRole('menuitem')
          .map((item) => item.textContent),
      ).toEqual(['File', 'Edit', 'View', 'Account'])
    })

    it('draws no line under the menu, since nothing is below it, and adds no padding', async () => {
      await renderApp()

      const panel = await screen.findByRole('dialog', { name: 'Menu' })
      const menu = within(panel).getByRole('menubar', { name: 'Application' })
      const lined: Array<Element> = []
      for (
        let element: Element | null = menu;
        element !== null && element !== panel;
        element = element.parentElement
      ) {
        if (element.classList.contains('border-b')) lined.push(element)
      }

      expect(lined).toHaveLength(0)
      expect(menu.parentElement).not.toHaveClass('px-2', 'py-1')
    })

    it('opens an image from this computer', async () => {
      const opened = documentView([], DOCUMENT_ID, 'one.png')
      vi.mocked(uploadSource).mockResolvedValue(opened.source)
      vi.mocked(createDocument).mockResolvedValue(opened)
      vi.mocked(getDocument).mockResolvedValue(opened)
      const user = userEvent.setup()
      const { router } = await renderApp()
      const input = await screen.findByLabelText('Choose an image')
      const click = vi.spyOn(input as HTMLInputElement, 'click')

      await openMenu(user, 'File')
      await user.click(screen.getByRole('menuitem', { name: 'Open image' }))
      expect(click).toHaveBeenCalledTimes(1)
      await user.upload(
        input,
        new File(['x'], 'one.png', { type: 'image/png' }),
      )

      expect(createDocument).toHaveBeenCalledWith({
        data: { sourceId: opened.source.id },
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/documents/${DOCUMENT_ID}`)
      })
    })

    it('says why the server refused an image', async () => {
      vi.mocked(uploadSource).mockRejectedValue(
        new Error('Use one of: image/png.'),
      )
      const user = userEvent.setup({ applyAccept: false })
      await renderApp()

      await user.upload(
        await screen.findByLabelText('Choose an image'),
        new File(['x'], 'a.txt', { type: 'text/plain' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Use one of: image/png.',
      )
      expect(createDocument).not.toHaveBeenCalled()
    })

    it('opens a document on an image uploaded before', async () => {
      const opened = documentView([], DOCUMENT_ID, 'one.png')
      vi.mocked(listSources).mockResolvedValue([opened.source])
      vi.mocked(createDocument).mockResolvedValue(opened)
      vi.mocked(getDocument).mockResolvedValue(opened)
      const user = userEvent.setup()
      const { router } = await renderApp()

      await openMenu(user, 'File')
      await user.click(
        screen.getByRole('menuitem', { name: 'Uploaded images' }),
      )
      await user.click(
        await screen.findByRole('button', { name: 'Open one.png' }),
      )

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/documents/${DOCUMENT_ID}`)
      })
    })

    it('has nothing to export, undo, redo or compare', async () => {
      const user = userEvent.setup()
      await renderApp()

      const file = await openMenu(user, 'File')
      expect(
        within(file).queryByRole('menuitem', { name: 'Export' }),
      ).not.toBeInTheDocument()
      expect(
        within(file).getByRole('menuitem', { name: 'Close document' }),
      ).toHaveAttribute('aria-disabled', 'true')
      await user.keyboard('{Escape}')

      const edit = await openMenu(user, 'Edit')
      for (const name of ['Undo', 'Redo']) {
        expect(within(edit).getByRole('menuitem', { name })).toHaveAttribute(
          'aria-disabled',
          'true',
        )
      }
      expect(
        within(edit).getByRole('menuitemcheckbox', { name: 'Show original' }),
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows and hides the sidebar from the View menu', async () => {
      const user = userEvent.setup()
      await renderApp()

      let view = await openMenu(user, 'View')
      const toggle = within(view).getByRole('menuitemcheckbox', {
        name: 'Sidebar',
      })
      expect(toggle).toBeChecked()
      expect(
        within(view).queryByRole('menuitem', { name: 'Tools' }),
      ).not.toBeInTheDocument()
      await user.click(toggle)
      expect(useAppStore.getState().sidebarOpen).toBe(false)

      view = await openMenu(user, 'View')
      await user.click(
        within(view).getByRole('menuitemcheckbox', { name: 'Sidebar' }),
      )
      expect(useAppStore.getState().sidebarOpen).toBe(true)
    })

    it('names the signed-in user and signs out', async () => {
      vi.mocked(signOut).mockResolvedValue(undefined as never)
      const user = userEvent.setup()
      const { router } = await renderApp()
      const navigate = vi.spyOn(router, 'navigate')

      const account = await openMenu(user, 'Account')
      expect(within(account).getByText('Ann')).toBeVisible()
      await user.click(
        within(account).getByRole('menuitem', { name: 'Sign out' }),
      )

      expect(signOut).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith({ to: '/sign-in' })
      })
    })
  })

  describe('with a document open', () => {
    it('lives inside the Tools panel', async () => {
      vi.mocked(getDocument).mockResolvedValue(documentView())
      await renderApp(`/documents/${DOCUMENT_ID}`)

      const panel = await screen.findByRole('dialog', { name: 'Tools' })

      expect(
        within(panel).getByRole('menubar', { name: 'Application' }),
      ).toBeVisible()
      expect(
        screen.queryByRole('dialog', { name: 'Menu' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    })

    it('closes the document from File, going home and keeping it in Recent', async () => {
      vi.mocked(getDocument).mockResolvedValue(documentView())
      vi.mocked(listDocuments).mockResolvedValue([
        {
          ...documentView(),
          updatedAt: '2026-01-01T00:00:00.000Z',
          revision: 0,
        },
      ])
      const user = userEvent.setup()
      const { router } = await renderApp(`/documents/${DOCUMENT_ID}`)
      await screen.findByRole('dialog', { name: 'Tools' })

      const file = await openMenu(user, 'File')
      const close = within(file).getByRole('menuitem', {
        name: 'Close document',
      })
      expect(close).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(close)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
      expect(deleteDocument).not.toHaveBeenCalled()
      expect(
        await screen.findByRole('list', { name: 'Recent images' }),
      ).toBeVisible()
    })

    it('goes back to the document opened before, and home once none is left', async () => {
      const OTHER_ID = '9b3e8e6a-2a65-4cab-9c79-4f4b2b0b4d33'
      const first = documentView([], DOCUMENT_ID, 'one.png')
      const second = documentView([], OTHER_ID, 'two.png')
      vi.mocked(getDocument).mockImplementation(({ data }) =>
        Promise.resolve(data.id === OTHER_ID ? second : first),
      )
      vi.mocked(listDocuments).mockResolvedValue([
        { ...first, updatedAt: '2026-01-01T00:00:00.000Z', revision: 0 },
        { ...second, updatedAt: '2026-01-02T00:00:00.000Z', revision: 0 },
      ])
      const user = userEvent.setup()
      const { router } = await renderApp(`/documents/${DOCUMENT_ID}`)
      await screen.findByRole('dialog', { name: 'Tools' })
      await router.navigate({ to: '/documents/$id', params: { id: OTHER_ID } })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/documents/${OTHER_ID}`)
      })

      let file = await openMenu(user, 'File')
      await user.click(
        within(file).getByRole('menuitem', { name: 'Close document' }),
      )
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/documents/${DOCUMENT_ID}`)
      })

      await screen.findByRole('dialog', { name: 'Tools' })
      file = await openMenu(user, 'File')
      await user.click(
        within(file).getByRole('menuitem', { name: 'Close document' }),
      )
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    })

    it('puts Close document after Export, with a separator before it', async () => {
      vi.mocked(getDocument).mockResolvedValue(documentView())
      const user = userEvent.setup()
      await renderApp(`/documents/${DOCUMENT_ID}`)
      await screen.findByRole('dialog', { name: 'Tools' })

      const file = await openMenu(user, 'File')
      const children = [...file.children]
      const exportIndex = children.findIndex(
        (child) => child.textContent === 'Export',
      )
      const closeIndex = children.findIndex(
        (child) => child.textContent === 'Close document',
      )

      expect(closeIndex).toBeGreaterThan(exportIndex)
      expect(children[closeIndex - 1]).toHaveAttribute('role', 'separator')
    })

    it('offers neither undo nor redo for a document with no history', async () => {
      vi.mocked(getDocument).mockResolvedValue(documentView())
      const user = userEvent.setup()
      await renderApp(`/documents/${DOCUMENT_ID}`)
      await screen.findByRole('dialog', { name: 'Tools' })

      const edit = await openMenu(user, 'Edit')

      for (const name of ['Undo', 'Redo']) {
        expect(within(edit).getByRole('menuitem', { name })).toHaveAttribute(
          'aria-disabled',
          'true',
        )
      }
      expect(
        within(edit).getByRole('menuitemcheckbox', { name: 'Show original' }),
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('undoes and redoes through the server on the revision it last confirmed', async () => {
      vi.mocked(getDocument).mockResolvedValue({
        ...documentView([BLUR]),
        revision: 3,
        canUndo: true,
      })
      vi.mocked(undoDocument).mockResolvedValue({
        ...documentView(),
        revision: 4,
        canRedo: true,
      })
      vi.mocked(redoDocument).mockResolvedValue({
        ...documentView([BLUR]),
        revision: 5,
        canUndo: true,
      })
      const user = userEvent.setup()
      await renderApp(`/documents/${DOCUMENT_ID}`)
      await screen.findByRole('dialog', { name: 'Tools' })

      let edit = await openMenu(user, 'Edit')
      expect(within(edit).getByText('Ctrl+Z')).toBeVisible()
      await user.click(within(edit).getByRole('menuitem', { name: 'Undo' }))
      expect(undoDocument).toHaveBeenCalledWith({
        data: { id: DOCUMENT_ID, revision: 3 },
      })

      await waitFor(() => {
        expect(
          useAppStore.getState().documents[DOCUMENT_ID]?.confirmed.revision,
        ).toBe(4)
      })
      edit = await openMenu(user, 'Edit')
      await user.click(within(edit).getByRole('menuitem', { name: 'Redo' }))
      expect(redoDocument).toHaveBeenCalledWith({
        data: { id: DOCUMENT_ID, revision: 4 },
      })
    })

    it('compares with the original', async () => {
      vi.mocked(getDocument).mockResolvedValue(documentView([BLUR]))
      const user = userEvent.setup()
      await renderApp(`/documents/${DOCUMENT_ID}`)
      const image = await screen.findByRole('img', { name: 'one.png' })
      const originalUrl = `/api/sources/source-${DOCUMENT_ID}`
      await screen.findByRole('dialog', { name: 'Tools' })

      const edit = await openMenu(user, 'Edit')
      await user.click(
        within(edit).getByRole('menuitemcheckbox', { name: 'Show original' }),
      )
      expect(image).toHaveAttribute('src', originalUrl)
      expect(useAppStore.getState().showOriginal[DOCUMENT_ID]).toBe(true)

      const again = await openMenu(user, 'Edit')
      const toggle = within(again).getByRole('menuitemcheckbox', {
        name: 'Show original',
      })
      expect(toggle).toBeChecked()
      await user.click(toggle)
      expect(useAppStore.getState().showOriginal[DOCUMENT_ID]).toBe(false)
    })

    it('shows the Export panel from File and each panel from View', async () => {
      vi.mocked(getDocument).mockResolvedValue(documentView())
      const user = userEvent.setup()
      await renderApp(`/documents/${DOCUMENT_ID}`)
      await screen.findByRole('dialog', { name: 'Tools' })

      const file = await openMenu(user, 'File')
      await user.click(within(file).getByRole('menuitem', { name: 'Export' }))
      expect(useAppStore.getState().activeTool).toBe(Tool.Export)

      for (const [name, tool] of [
        ['Tools', Tool.Tools],
        ['Options', Tool.Options],
        ['Results', Tool.Results],
        ['Export', Tool.Export],
      ] as const) {
        const view = await openMenu(user, 'View')
        await user.click(within(view).getByRole('menuitem', { name }))
        expect(useAppStore.getState().activeTool).toBe(tool)
      }
    })
  })
})
