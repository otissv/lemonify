import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { isLayerStep } from '@/features/pipeline/layer-kinds'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { changeDocument } from '@/features/documents/document-functions'
import { listSources } from '@/features/sources/source-functions'
import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'
import { ToolsBrowser } from '@/features/tools/tools-browser'
import {
  AI_CATALOGUES,
  AI_TOOLS_OFFERED,
  DOCUMENT_ID,
  documentView,
  echoChanges,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'
import { Tool, useUiStore } from '@/store/ui-store'
import {
  currentPipeline,
  documentSession,
  usePipelineStore,
} from '@/store/pipeline-store'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
}))
vi.mock('@/features/documents/document-functions', () => ({
  getDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))

function steps() {
  const all =
    currentPipeline(usePipelineStore.getState(), DOCUMENT_ID)?.steps ?? []
  return all.filter((step) => !isLayerStep(step))
}

function stepNames(): Array<string> {
  return steps().map((step) => {
    if (step.kind === 'sharp') return step.op
    return step.kind === 'ai' ? step.tool : 'source'
  })
}

const GROUPS = ['AI', 'Geometry', 'Filters', 'Colour']

async function expandAll(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  for (const name of GROUPS) {
    await user.click(screen.getByRole('button', { name }))
  }
}

describe('ToolsBrowser', () => {
  beforeEach(() => {
    resetStores()
    useLibraryStore.setState(INITIAL_LIBRARY_STATE)
    vi.resetAllMocks()
    vi.mocked(listSources).mockResolvedValue([
      { ...documentView().source, id: 'src-2', fileName: 'two.png' },
    ])
    const view = documentView()
    echoChanges(vi.mocked(changeDocument), view)
    loadDocumentIntoEditor(view)
    render(
      <ToolsBrowser
        documentId={DOCUMENT_ID}
        tools={AI_TOOLS_OFFERED}
        catalogues={AI_CATALOGUES}
      />,
    )
  })

  it('lists every tool in the groups Image, AI, Geometry, Filters and Colour', async () => {
    const user = userEvent.setup()
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
    ).toEqual(['Layers', ...GROUPS])
    await expandAll(user)
    expect(screen.getAllByRole('button', { name: /^Add / })).toHaveLength(42)
    expect(
      screen.queryByRole('button', { name: 'Add Jpeg' }),
    ).not.toBeInTheDocument()
  })

  it('leaves the layers out while searching, so only matching tools show', async () => {
    const user = userEvent.setup()

    await user.type(
      screen.getByRole('searchbox', { name: 'Search tools' }),
      'tint',
    )

    expect(
      screen.queryByRole('button', { name: 'Add Document layer' }),
    ).toBeNull()
  })

  it('offers layers: an empty image layer, and a document or workflow layer chosen in a picker', async () => {
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Add Document layer' }))
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'add-used-layer',
      itemId: DOCUMENT_ID,
      layer: 'document',
    })

    await user.click(screen.getByRole('button', { name: 'Add Workflow layer' }))
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'add-used-layer',
      itemId: DOCUMENT_ID,
      layer: 'workflow',
    })

    await user.click(screen.getByRole('button', { name: 'Add Image layer' }))
    await waitFor(() => {
      expect(
        currentPipeline(usePipelineStore.getState(), DOCUMENT_ID)?.steps,
      ).toHaveLength(2)
    })
  })

  it('adds a tool as a step at the end, selects it and shows its options', async () => {
    const user = userEvent.setup()
    await expandAll(user)

    await user.click(screen.getByRole('button', { name: 'Add Blur' }))
    await user.click(screen.getByRole('button', { name: 'Add Flip' }))

    expect(stepNames()).toEqual(['blur', 'flip'])
    expect(useUiStore.getState().activeTool).toBe(Tool.Options)
    expect(useUiStore.getState().selectedSteps[DOCUMENT_ID]).toBe(
      steps().at(1)?.id,
    )
  })

  it('sends each change to the server on the revision before it', async () => {
    const user = userEvent.setup()
    await expandAll(user)

    await user.click(screen.getByRole('button', { name: 'Add Blur' }))
    await user.click(screen.getByRole('button', { name: 'Add Flip' }))

    await waitFor(() => {
      expect(
        documentSession(usePipelineStore.getState(), DOCUMENT_ID)?.pending,
      ).toEqual([])
    })
    const revisions = vi
      .mocked(changeDocument)
      .mock.calls.map(([{ data }]) => data.revision)
    expect(revisions).toEqual([0, 1])
  })

  it('adds a tool after the selected step', async () => {
    const user = userEvent.setup()
    await expandAll(user)
    await user.click(screen.getByRole('button', { name: 'Add Flip' }))
    await user.click(screen.getByRole('button', { name: 'Add Flop' }))
    const [flip] = steps()
    if (!flip) throw new Error('no step')
    useUiStore.getState().selectStep(DOCUMENT_ID, flip.id)

    await user.click(screen.getByRole('button', { name: 'Add Blur' }))

    expect(stepNames()).toEqual(['flip', 'blur', 'flop'])
  })

  it('adds Upscale with the default model at its largest scale', async () => {
    const user = userEvent.setup()
    await expandAll(user)

    await user.click(screen.getByRole('button', { name: 'Add Upscale' }))

    expect(steps().at(0)).toMatchObject({
      kind: 'ai',
      tool: 'upscale',
      settings: { model: 'siax', scale: 4, iterations: 1, tta: false },
    })
  })

  it('narrows the list as you type, dropping groups with no match', async () => {
    const user = userEvent.setup()

    await user.type(
      screen.getByRole('searchbox', { name: 'Search tools' }),
      'tint',
    )

    const names = screen
      .getAllByRole('button', { name: /^Add / })
      .map((button) => button.getAttribute('aria-label'))
    expect(names).toEqual(['Add Tint'])
    expect(
      screen.queryByRole('heading', { name: 'Geometry' }),
    ).not.toBeInTheDocument()
  })

  it('says when no tool matches', async () => {
    const user = userEvent.setup()

    await user.type(
      screen.getByRole('searchbox', { name: 'Search tools' }),
      'zzz',
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'No tools match “zzz”.',
    )
    expect(
      within(document.body).queryAllByRole('button', { name: /^Add / }),
    ).toHaveLength(0)
  })

  it('keeps the search box out of the scrolling list', () => {
    const search = screen.getByRole('searchbox', { name: 'Search tools' })
    const list = screen
      .getByRole('button', { name: 'AI' })
      .closest('.overflow-y-auto')

    expect(list).not.toBeNull()
    expect(list).not.toContainElement(search)
  })

  describe('collapsing a group', () => {
    function groupToggle(name: string): HTMLElement {
      return screen.getByRole('button', { name })
    }

    it('starts with every group closed', () => {
      for (const name of GROUPS) {
        expect(groupToggle(name)).toHaveAttribute('aria-expanded', 'false')
      }
      expect(
        screen
          .queryAllByRole('button', { name: /^Add / })
          .map((b) => b.textContent),
      ).toEqual(['Image layer', 'Document layer', 'Workflow layer'])
    })

    it('shows the tools of a group and hides them again', async () => {
      const user = userEvent.setup()

      await user.click(groupToggle('Geometry'))

      expect(groupToggle('Geometry')).toHaveAttribute('aria-expanded', 'true')
      expect(
        screen.getByRole('button', { name: 'Add Resize' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Add Blur' }),
      ).not.toBeInTheDocument()

      await user.click(groupToggle('Geometry'))

      expect(groupToggle('Geometry')).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.queryByRole('button', { name: 'Add Resize' }),
      ).not.toBeInTheDocument()
    })

    it('keeps the groups as they were left when the list is shown again, without saving them', async () => {
      const user = userEvent.setup()
      await user.click(groupToggle('Colour'))
      await user.click(groupToggle('Geometry'))
      await user.click(groupToggle('Geometry'))

      cleanup()
      render(
        <ToolsBrowser
          documentId={DOCUMENT_ID}
          tools={AI_TOOLS_OFFERED}
          catalogues={AI_CATALOGUES}
        />,
      )

      expect(groupToggle('Colour')).toHaveAttribute('aria-expanded', 'true')
      expect(groupToggle('Geometry')).toHaveAttribute('aria-expanded', 'false')
      const saved = Object.keys(window.localStorage).map((key) =>
        window.localStorage.getItem(key),
      )
      expect(saved.join('')).not.toContain('Colour')
    })

    it('keeps the group heading when it is collapsed', async () => {
      const user = userEvent.setup()

      await user.click(groupToggle('Filters'))

      expect(
        screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
      ).toEqual(['Layers', ...GROUPS])
    })

    it('shows matching tools of a closed group while searching', async () => {
      const user = userEvent.setup()

      await user.type(
        screen.getByRole('searchbox', { name: 'Search tools' }),
        'resi',
      )

      expect(
        screen.getByRole('button', { name: 'Add Resize' }),
      ).toBeInTheDocument()
    })
  })
})
