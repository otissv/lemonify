import { beforeEach, describe, expect, it, vi } from 'vitest'

import { convertLayer } from '@/features/create-from/convert-layer'
import { createDocumentLayerStep } from '@/features/pipeline/layer-kinds'
import { applyEdit } from '@/features/pipeline/pipeline-sync'
import { createEmbeddedDocumentStep } from '@/features/pipeline/pipeline'
import { layerAsEmbeddedFn } from '@/features/workflows/create-from-functions'
import { resetStores } from '@/store/reset-stores'
import { usePipelineStore } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'
import { workflowView } from '@/test/workflow-fixtures'

vi.mock('@/features/pipeline/pipeline-sync', () => ({
  applyEdit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/features/workflows/create-from-functions', () => ({
  layerAsEmbeddedFn: vi.fn(),
}))

const layer = createDocumentLayerStep('d2')
const embedded = { ...createEmbeddedDocumentStep([], 'Badge'), id: layer.id }

beforeEach(() => {
  resetStores()
  vi.mocked(applyEdit).mockClear()
  vi.mocked(layerAsEmbeddedFn).mockResolvedValue(embedded)
})

describe('converting a layer to an embedded document layer', () => {
  it('asks the server for the copy and puts it in the layer’s place as one edit, in a document', async () => {
    loadDocumentIntoEditor(documentView([layer]))

    await convertLayer(DOCUMENT_ID, layer.id)

    expect(layerAsEmbeddedFn).toHaveBeenCalledWith({
      data: { holder: { kind: 'document', id: DOCUMENT_ID }, stepId: layer.id },
    })
    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'convert-step',
      step: embedded,
    })
  })

  it('does the same in a workflow', async () => {
    usePipelineStore.getState().confirmWorkflow(workflowView('w1'), true)

    await convertLayer('w1', layer.id)

    expect(layerAsEmbeddedFn).toHaveBeenCalledWith({
      data: { holder: { kind: 'workflow', id: 'w1' }, stepId: layer.id },
    })
  })

  it('says why when the server refuses', async () => {
    loadDocumentIntoEditor(documentView([layer]))
    vi.mocked(layerAsEmbeddedFn).mockRejectedValue(new Error('Gone.'))

    await convertLayer(DOCUMENT_ID, layer.id)

    expect(applyEdit).not.toHaveBeenCalled()
    expect(useUiStore.getState().liveNotice).toBe('Gone.')
  })
})
