import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateFromDialog } from '@/features/create-from/create-from-dialog'
import { applyEdit } from '@/features/pipeline/pipeline-sync'
import {
  createEmbeddedDocumentStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { workflowAsEmbeddedFn } from '@/features/workflows/create-from-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { resetStores } from '@/store/reset-stores'
import { SourcesStatus, useLibraryStore } from '@/store/library-store'
import { useUiStore } from '@/store/ui-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'
import { workflowView } from '@/test/workflow-fixtures'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => vi.fn(),
}))

vi.mock('@/features/pipeline/pipeline-sync', () => ({
  applyEdit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
}))

vi.mock('@/features/workflows/create-from-functions', () => ({
  workflowAsEmbeddedFn: vi.fn(),
}))

const blur = createSharpStep('blur')
const flip = createSharpStep('flip')

beforeEach(() => {
  resetStores()
  loadDocumentIntoEditor(documentView([blur, flip]))
  vi.mocked(listWorkflows).mockResolvedValue([
    workflowView('w1', 'Brand'),
    workflowView('w2', 'Shrink'),
  ])
  useLibraryStore.setState({
    status: SourcesStatus.Ready,
    sources: [
      {
        id: 'src-logo',
        fileName: 'logo.png',
        mediaType: 'image/png',
        bytes: 1,
        width: 8,
        height: 8,
      },
    ],
  })
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('the insert workflow dialog', () => {
  it('adds the chosen workflow, with the chosen image, after the selected step and selects it', async () => {
    const step = createEmbeddedDocumentStep([], 'Shrink')
    vi.mocked(workflowAsEmbeddedFn).mockResolvedValue(step)
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    act(() => {
      useUiStore.getState().setCreateFrom({
        kind: 'insert-workflow',
        documentId: DOCUMENT_ID,
        afterStepId: blur.id,
      })
    })

    await screen.findByRole('dialog', { name: 'Insert workflow' })
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Workflow' }),
      'w2',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Image for its input slot' }),
      'src-logo',
    )
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    await waitFor(() => {
      expect(workflowAsEmbeddedFn).toHaveBeenCalledWith({
        data: { workflowId: 'w2', sourceId: 'src-logo' },
      })
    })
    await waitFor(() => {
      expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
        type: 'add-step',
        step,
        index: 2,
      })
    })
    expect(useUiStore.getState().selectedSteps[DOCUMENT_ID]).toBe(step.id)
    expect(useUiStore.getState().createFrom).toBeUndefined()
  })

  it('leaves the input slot empty when no image is chosen', async () => {
    vi.mocked(workflowAsEmbeddedFn).mockResolvedValue(
      createEmbeddedDocumentStep([], 'Brand'),
    )
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    act(() => {
      useUiStore
        .getState()
        .setCreateFrom({ kind: 'insert-workflow', documentId: DOCUMENT_ID })
    })

    await screen.findByRole('option', { name: 'Brand' })
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    await waitFor(() => {
      expect(workflowAsEmbeddedFn).toHaveBeenCalledWith({
        data: { workflowId: 'w1' },
      })
    })
  })
})
