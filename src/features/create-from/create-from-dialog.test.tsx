import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateFromDialog } from '@/features/create-from/create-from-dialog'
import {
  getDocument,
  listDocuments,
} from '@/features/documents/document-functions'
import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import {
  createDocumentFromWorkflowFn,
  createWorkflowFromDocumentFn,
} from '@/features/workflows/create-from-functions'
import { CanvasSize } from '@/features/workflows/workflow'
import {
  getWorkflow,
  listWorkflows,
} from '@/features/workflows/workflow-functions'
import { resetStores } from '@/store/reset-stores'
import { useUiStore } from '@/store/ui-store'
import { DOCUMENT_ID, documentView } from '@/test/document-fixtures'
import { workflowView } from '@/test/workflow-fixtures'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => navigate,
}))

vi.mock('@/features/documents/document-functions', () => ({
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
}))

vi.mock('@/features/workflows/workflow-functions', () => ({
  getWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
}))

vi.mock('@/features/workflows/create-from-functions', () => ({
  createWorkflowFromDocumentFn: vi.fn(),
  createDocumentFromWorkflowFn: vi.fn(),
}))

const group = { ...createGroupStep([createSharpStep('blur')]), name: 'Soft' }

beforeEach(() => {
  resetStores()
  vi.mocked(getDocument).mockResolvedValue({
    ...documentView([group]),
    name: 'Poster',
  })
  vi.mocked(listWorkflows).mockResolvedValue([workflowView('w0', 'Poster')])
  vi.mocked(listDocuments).mockResolvedValue([])
})

afterEach(() => {
  vi.resetAllMocks()
})

function request(
  value: Parameters<ReturnType<typeof useUiStore.getState>['setCreateFrom']>[0],
): void {
  act(() => {
    useUiStore.getState().setCreateFrom(value)
  })
}

describe('the new workflow from a document dialog', () => {
  it('suggests the document’s name made unique, asks about the images, and opens the new workflow', async () => {
    vi.mocked(createWorkflowFromDocumentFn).mockResolvedValue(
      workflowView('w9', 'Poster 2'),
    )
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    request({ kind: 'workflow-from-document', documentId: DOCUMENT_ID })

    const dialog = await screen.findByRole('dialog', {
      name: 'New workflow from document',
    })
    expect(await screen.findByDisplayValue('Poster 2')).toBeVisible()
    expect(
      screen.getByRole('radio', { name: /Remove only the input image/ }),
    ).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Keep all images/ }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createWorkflowFromDocumentFn).toHaveBeenCalledWith({
        data: { documentId: DOCUMENT_ID, images: 'keep', name: 'Poster 2' },
      })
    })
    expect(navigate).toHaveBeenCalledWith({
      to: '/workflows/$id',
      params: { id: 'w9' },
    })
    expect(dialog).not.toBeInTheDocument()
    expect(useUiStore.getState().createFrom).toBeUndefined()
  })

  it('starts from a group, named after it', async () => {
    vi.mocked(createWorkflowFromDocumentFn).mockResolvedValue(
      workflowView('w9', 'Soft'),
    )
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    request({
      kind: 'workflow-from-document',
      documentId: DOCUMENT_ID,
      stepId: group.id,
    })

    expect(
      await screen.findByRole('dialog', { name: 'New workflow from group' }),
    ).toBeVisible()
    expect(await screen.findByDisplayValue('Soft')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createWorkflowFromDocumentFn).toHaveBeenCalledWith({
        data: {
          documentId: DOCUMENT_ID,
          stepId: group.id,
          images: 'remove-input',
          name: 'Soft',
        },
      })
    })
  })

  it('says why the server refused, and stays open', async () => {
    vi.mocked(createWorkflowFromDocumentFn).mockRejectedValue(
      new Error('A workflow with this name already exists.'),
    )
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    request({ kind: 'workflow-from-document', documentId: DOCUMENT_ID })

    await screen.findByDisplayValue('Poster 2')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByText('A workflow with this name already exists.'),
    ).toBeVisible()
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})

describe('the new document from a workflow dialog', () => {
  it('asks for a size when the workflow takes each input image’s size and has none', async () => {
    vi.mocked(getWorkflow).mockResolvedValue({
      ...workflowView('w1', 'Resize'),
      canvasSize: CanvasSize.MatchInput,
      inputs: [],
    })
    vi.mocked(createDocumentFromWorkflowFn).mockResolvedValue({
      ...documentView(),
      id: 'd9',
    })
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    request({ kind: 'document-from-workflow', workflowId: 'w1' })

    expect(
      await screen.findByRole('dialog', { name: 'New document from workflow' }),
    ).toBeVisible()
    expect(await screen.findByDisplayValue('Resize')).toBeVisible()
    const width = screen.getByRole('spinbutton', { name: 'Width' })
    await user.clear(width)
    await user.type(width, '640')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createDocumentFromWorkflowFn).toHaveBeenCalledWith({
        data: {
          workflowId: 'w1',
          name: 'Resize',
          size: { width: 640, height: 1080 },
        },
      })
    })
    expect(navigate).toHaveBeenCalledWith({
      to: '/documents/$id',
      params: { id: 'd9' },
    })
  })

  it('does not ask for a size when the workflow decides it', async () => {
    vi.mocked(getWorkflow).mockResolvedValue({
      ...workflowView('w1', 'Resize'),
      canvasSize: CanvasSize.Fixed,
    })
    render(<CreateFromDialog />)
    request({ kind: 'document-from-workflow', workflowId: 'w1' })

    await screen.findByDisplayValue('Resize')
    expect(screen.queryByRole('spinbutton', { name: 'Width' })).toBeNull()
  })
})
