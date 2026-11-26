import { describe, expect, it } from 'vitest'

import {
  InvalidChangeError,
  applyChange,
  planChange,
} from '@/features/pipeline/document-change'
import {
  createDocumentLayerStep,
  createImageLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { pipelineOf } from '@/test/pipelines'

describe('converting a document or workflow layer to an embedded document layer', () => {
  const layer = { ...createDocumentLayerStep('d1'), opacity: 40 }
  const embedded = {
    ...createEmbeddedDocumentStep([createSharpStep('flip')], 'Badge'),
    id: layer.id,
    opacity: 40,
  }

  it('puts the embedded document layer in its place, as a change undo takes back', () => {
    const start = pipelineOf(createImageLayerStep('a'), layer)

    const planned = planChange(start, { type: 'convert-step', step: embedded })
    if (planned === null) throw new Error('expected a change')

    expect(planned.pipeline.steps[1]).toEqual(embedded)
    expect(planned.patch.inverse).toEqual({
      type: 'restore-layer',
      step: layer,
    })
    expect(applyChange(planned.pipeline, planned.patch.inverse)).toEqual(start)
    expect(
      planChange(planned.pipeline, planned.patch.inverse)?.patch.inverse,
    ).toEqual({ type: 'convert-step', step: embedded })
  })

  it('converts a workflow layer too', () => {
    const flow = createWorkflowLayerStep('w1', 's1')
    const changed = applyChange(pipelineOf(flow), {
      type: 'convert-step',
      step: { ...embedded, id: flow.id },
    })

    expect(changed.steps[0]).toMatchObject({ kind: 'embedded-document' })
  })

  it('refuses any other step, and a layer to restore over anything but an embedded document layer', () => {
    const image = createImageLayerStep('a')
    expect(() =>
      applyChange(pipelineOf(image), {
        type: 'convert-step',
        step: { ...embedded, id: image.id },
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(pipelineOf(layer), { type: 'restore-layer', step: layer }),
    ).toThrow(InvalidChangeError)
  })
})
