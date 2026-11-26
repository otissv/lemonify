import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { convertLayer } from '@/features/create-from/convert-layer'
import { changeDocument } from '@/features/documents/document-functions'
import { ItemNamesContext } from '@/features/documents/item-names'
import {
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { listSources } from '@/features/sources/source-functions'
import { StepOptions } from '@/features/tools/step-options'
import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'
import { resetStores } from '@/store/reset-stores'
import { useUiStore } from '@/store/ui-store'
import {
  AI_CATALOGUES,
  DOCUMENT_ID,
  documentView,
  echoChanges,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))
vi.mock('@/features/documents/document-functions', () => ({
  getDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))
vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
}))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))
vi.mock('@/features/create-from/convert-layer', () => ({
  convertLayer: vi.fn(),
}))

const ITEMS = {
  documents: [{ id: 'd2', name: 'Badge' }],
  workflows: [{ id: 'w1', name: 'Brand' }],
}

function showOptionsOf(step: PipelineStep): void {
  const view = documentView()
  echoChanges(vi.mocked(changeDocument), view)
  loadDocumentIntoEditor(view)
  addStepAfter(DOCUMENT_ID, step)
  useUiStore.getState().selectStep(DOCUMENT_ID, step.id)
  render(
    <ItemNamesContext value={ITEMS}>
      <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />
    </ItemNamesContext>,
  )
}

beforeEach(() => {
  resetStores()
  useLibraryStore.setState(INITIAL_LIBRARY_STATE)
  vi.mocked(listSources).mockResolvedValue([])
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('the options of a document layer', () => {
  it('name the document it draws and open it', async () => {
    const user = userEvent.setup()
    showOptionsOf(createDocumentLayerStep('d2'))

    expect(
      screen.getByRole('heading', { name: 'Document layer' }),
    ).toBeVisible()
    expect(screen.getByText('Badge')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open Badge' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/documents/$id',
      params: { id: 'd2' },
    })
  })

  it('say when the document is gone, with nothing to open', () => {
    showOptionsOf(createDocumentLayerStep('gone'))

    expect(screen.getByText('Document not available')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull()
  })

  it('offer the settings every layer has', () => {
    showOptionsOf(createDocumentLayerStep('d2'))

    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeVisible()
  })
})

describe('the options of a workflow layer', () => {
  it('name the workflow it draws, open it, and say it has no input image yet', async () => {
    const user = userEvent.setup()
    showOptionsOf(createWorkflowLayerStep('w1'))

    expect(
      screen.getByRole('heading', { name: 'Workflow layer' }),
    ).toBeVisible()
    expect(screen.getByText('Brand')).toBeVisible()
    expect(screen.getByText(/no image in its input slot/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open Brand' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/workflows/$id',
      params: { id: 'w1' },
    })
  })

  it('take the image out of the input slot', async () => {
    const user = userEvent.setup()
    const step = createWorkflowLayerStep('w1', documentView().source.id)
    showOptionsOf(step)

    await user.click(screen.getByRole('button', { name: 'Remove image' }))

    await waitFor(() => {
      expect(changeDocument).toHaveBeenCalledWith({
        data: expect.objectContaining({
          change: { type: 'set-image', stepId: step.id, sourceId: null },
        }),
      })
    })
  })
})

describe('converting a layer in a document', () => {
  it('converts a document layer or a workflow layer, and offers it for no other layer', async () => {
    const user = userEvent.setup()
    const step = createWorkflowLayerStep('w1')
    showOptionsOf(step)

    await user.click(
      screen.getByRole('button', {
        name: 'Convert to embedded document layer',
      }),
    )

    expect(convertLayer).toHaveBeenCalledWith(DOCUMENT_ID, step.id)
  })
})
