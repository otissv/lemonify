import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getDocument,
  listDocuments,
  undoDocument,
} from '@/features/documents/document-functions'
import { getKeybindings } from '@/features/keybindings/keybinding-functions'
import { keybindingsView } from '@/features/keybindings/keybindings-view'
import { createSharpStep } from '@/features/pipeline/pipeline'
import {
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { listSources } from '@/features/sources/source-functions'
import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { followJob } from '@/features/jobs/follow-job'
import { Tool, useUiStore } from '@/store/ui-store'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'
import { DOCUMENT_ID, documentView } from '@/test/document-fixtures'
import { renderApp } from '@/test/render-app'
import { resetStores } from '@/store/reset-stores'

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
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))

function press(
  code: string,
  init: KeyboardEventInit = {},
  target: Element = document.body,
): boolean {
  return fireEvent.keyDown(target, { code, ...init })
}

async function openDocument(): Promise<void> {
  await renderApp(`/documents/${DOCUMENT_ID}`)
  await screen.findByRole('dialog', { name: 'Tools' })
}

describe('key bindings', () => {
  beforeEach(() => {
    resetStores()
    useLibraryStore.setState(INITIAL_LIBRARY_STATE)
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(listSources).mockResolvedValue([])
    vi.mocked(requestPreview).mockResolvedValue({ id: 'p' } as never)
    vi.mocked(requestThumbnails).mockResolvedValue({ id: 't' } as never)
    vi.mocked(followJob).mockReturnValue(new Promise(() => undefined))
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('undo with the default key, taking the key from the browser', async () => {
    vi.mocked(getDocument).mockResolvedValue({
      ...documentView([createSharpStep('blur')]),
      revision: 3,
      canUndo: true,
    })
    vi.mocked(undoDocument).mockResolvedValue({
      ...documentView(),
      revision: 4,
    })
    await openDocument()

    const notPrevented = press('KeyZ', { ctrlKey: true })

    expect(notPrevented).toBe(false)
    expect(undoDocument).toHaveBeenCalledWith({
      data: { id: DOCUMENT_ID, revision: 3 },
    })
  })

  it('leaves the key to the browser when the action cannot be done', async () => {
    vi.mocked(getDocument).mockResolvedValue(documentView())
    await openDocument()

    const notPrevented = press('KeyZ', { ctrlKey: true })

    expect(notPrevented).toBe(true)
    expect(undoDocument).not.toHaveBeenCalled()
  })

  it('does nothing while typing in a field', async () => {
    vi.mocked(getDocument).mockResolvedValue({
      ...documentView(),
      canUndo: true,
    })
    await openDocument()
    const search = await screen.findByRole('searchbox', {
      name: 'Search tools',
    })

    const notPrevented = press('KeyZ', { ctrlKey: true }, search)

    expect(notPrevented).toBe(true)
    expect(undoDocument).not.toHaveBeenCalled()
  })

  it('shows a panel with its key', async () => {
    vi.mocked(getDocument).mockResolvedValue(documentView())
    await openDocument()

    press('Digit5', { altKey: true })

    await waitFor(() => {
      expect(useUiStore.getState().activeTool).toBe(Tool.Document)
    })
  })

  it('adds the tool whose key is pressed after the selected step', async () => {
    vi.mocked(getDocument).mockResolvedValue(documentView())
    await openDocument()

    press('KeyB')

    await waitFor(() => {
      const steps =
        documentSession(usePipelineStore.getState(), DOCUMENT_ID)?.pending ?? []
      expect(steps.length).toBeGreaterThan(0)
    })
  })

  it('uses the keys the User chose, and not the default one they gave up', async () => {
    vi.mocked(getKeybindings).mockResolvedValue(
      keybindingsView(
        { version: 1, bindings: { 'edit.undo': ['alt+u'] } },
        '2026-01-01T00:00:00.000Z',
      ),
    )
    vi.mocked(getDocument).mockResolvedValue({
      ...documentView(),
      revision: 1,
      canUndo: true,
    })
    vi.mocked(undoDocument).mockResolvedValue({
      ...documentView(),
      revision: 2,
    })
    await openDocument()

    expect(press('KeyZ', { ctrlKey: true })).toBe(true)
    expect(undoDocument).not.toHaveBeenCalled()
    expect(press('KeyU', { altKey: true })).toBe(false)
    expect(undoDocument).toHaveBeenCalled()
  })

  it('opens the shortcuts on a page with no document', async () => {
    await renderApp()
    await screen.findByRole('menubar', { name: 'Application' })

    press('Slash', { shiftKey: true })

    expect(
      await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeVisible()
  })
})
