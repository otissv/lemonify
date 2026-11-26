import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addUsedLayer } from '@/features/create-from/add-used-layer'
import { createDocumentLayerStep } from '@/features/pipeline/layer-kinds'
import { applyEdit } from '@/features/pipeline/pipeline-sync'
import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
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

const blur = createSharpStep('blur')
const flip = createSharpStep('flip')

beforeEach(() => {
  resetStores()
  vi.mocked(applyEdit).mockClear()
})

describe('adding a document or workflow layer', () => {
  it('puts it in a document after the given step and selects it', () => {
    loadDocumentIntoEditor(documentView([blur, flip]))
    const layer = createDocumentLayerStep('d2')

    addUsedLayer(DOCUMENT_ID, layer, blur.id)

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: layer,
      index: 2,
    })
    expect(useUiStore.getState().selectedSteps[DOCUMENT_ID]).toBe(layer.id)
  })

  it('puts it in a workflow as the workflow adds steps, into a selected group, and selects it there', () => {
    const view = workflowView('w1')
    const group = createGroupStep([])
    usePipelineStore.getState().confirmWorkflow(
      {
        ...view,
        pipeline: { ...view.pipeline, steps: [...view.pipeline.steps, group] },
      },
      true,
    )
    const layer = createDocumentLayerStep('d2')

    addUsedLayer('w1', layer, group.id)

    expect(applyEdit).toHaveBeenCalledWith('w1', {
      type: 'add-step',
      step: layer,
      index: 0,
      parentId: group.id,
    })
    expect(useUiStore.getState().selectedSteps.w1).toBe(layer.id)
  })

  it('does nothing for what is not open', () => {
    addUsedLayer('nothing', createDocumentLayerStep('d2'))

    expect(applyEdit).not.toHaveBeenCalled()
  })
})
