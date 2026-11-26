import { describe, expect, it } from 'vitest'

import {
  createDocumentLayerStep,
  createImageLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createGroupStep,
} from '@/features/pipeline/pipeline'
import { remapUsedItems } from '@/features/pipeline/used-item-ids'
import { pipelineOf } from '@/test/pipelines'

describe('naming what layers use by other ids', () => {
  it('renames the documents and workflows layers use at any depth, and leaves images alone', () => {
    const document = createDocumentLayerStep('d1')
    const workflow = createWorkflowLayerStep('w1', 's1')
    const image = createImageLayerStep('s1')
    const pipeline = pipelineOf(
      image,
      createGroupStep([document]),
      createEmbeddedDocumentStep([workflow]),
    )

    const renamed = remapUsedItems(
      pipeline,
      new Map([
        ['d1', 'd2'],
        ['w1', 'w2'],
      ]),
    )

    expect(renamed.steps[0]).toEqual(image)
    expect(renamed.steps[1]).toMatchObject({
      steps: [{ ...document, documentId: 'd2' }],
    })
    expect(renamed.steps[2]).toMatchObject({
      steps: [{ ...workflow, workflowId: 'w2', sourceId: 's1' }],
    })
  })

  it('refuses a layer whose item has no new id', () => {
    expect(() =>
      remapUsedItems(pipelineOf(createDocumentLayerStep('d1')), new Map()),
    ).toThrow(RangeError)
  })
})
