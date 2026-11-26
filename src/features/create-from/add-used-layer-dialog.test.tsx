import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateFromDialog } from '@/features/create-from/create-from-dialog'
import { listDocuments } from '@/features/documents/document-functions'
import { applyEdit } from '@/features/pipeline/pipeline-sync'
import { createSharpStep } from '@/features/pipeline/pipeline'
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

vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
}))

const blur = createSharpStep('blur')

function summary(id: string, name: string) {
  return {
    id,
    name,
    source: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  resetStores()
  loadDocumentIntoEditor(documentView([blur]))
  vi.mocked(listDocuments).mockResolvedValue([
    summary(DOCUMENT_ID, 'This one'),
    summary('d2', 'Badge'),
  ])
  vi.mocked(listWorkflows).mockResolvedValue([workflowView('w1', 'Brand')])
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

function open(layer: 'document' | 'workflow'): void {
  act(() => {
    useUiStore.getState().setCreateFrom({
      kind: 'add-used-layer',
      itemId: DOCUMENT_ID,
      layer,
      afterStepId: blur.id,
    })
  })
}

describe('the document layer picker', () => {
  it('offers the User’s other documents and adds a layer that draws the chosen one', async () => {
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    open('document')

    await screen.findByRole('dialog', { name: 'Add document layer' })
    await screen.findByRole('option', { name: 'Badge' })
    expect(screen.queryByRole('option', { name: 'This one' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
        type: 'add-step',
        step: expect.objectContaining({
          kind: 'document-layer',
          documentId: 'd2',
        }),
        index: 2,
      })
    })
    expect(useUiStore.getState().createFrom).toBeUndefined()
  })

  it('says so when there is no other document to use', async () => {
    vi.mocked(listDocuments).mockResolvedValue([
      summary(DOCUMENT_ID, 'This one'),
    ])
    render(<CreateFromDialog />)
    open('document')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have no other documents yet.',
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
})

describe('the workflow layer picker', () => {
  it('adds a layer that draws the chosen workflow on the chosen image', async () => {
    const user = userEvent.setup()
    render(<CreateFromDialog />)
    open('workflow')

    await screen.findByRole('dialog', { name: 'Add workflow layer' })
    await screen.findByRole('option', { name: 'Brand' })
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Image for its input slot' }),
      'src-logo',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
        type: 'add-step',
        step: expect.objectContaining({
          kind: 'workflow-layer',
          workflowId: 'w1',
          sourceId: 'src-logo',
        }),
        index: 2,
      })
    })
  })
})
