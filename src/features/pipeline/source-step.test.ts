import { describe, expect, it } from 'vitest'

import { applyChange, planChange } from '@/features/pipeline/document-change'
import {
  PipelineSchema,
  PipelineStepKind,
  createSharpStep,
  createSourceStep,
  firstSourceStep,
} from '@/features/pipeline/pipeline'
import {
  pipelineOperandSourceIds,
  stepOperandSourceIds,
} from '@/features/pipeline/image-operands'
import {
  pipelineStepLabel,
  stepProblem,
} from '@/features/pipeline/step-problems'

describe('an Open image step', () => {
  it('holds the id of the image it opens and can be switched off', () => {
    const step = createSourceStep('src-1')

    expect(step).toMatchObject({
      kind: PipelineStepKind.Source,
      sourceId: 'src-1',
      enabled: true,
    })
    expect(PipelineSchema.parse({ steps: [step] }).steps).toEqual([step])
  })

  it('is called Open image and is always set up', () => {
    const step = createSourceStep('src-1')

    expect(pipelineStepLabel(step)).toBe('Open image')
    expect(stepProblem(step)).toBeUndefined()
  })

  it('is found in a pipeline as the first Open image step', () => {
    const first = createSourceStep('src-1')
    const second = createSourceStep('src-2')
    const blur = createSharpStep('blur')

    expect(firstSourceStep({ steps: [blur, first, second] })).toBe(first)
    expect(firstSourceStep({ steps: [blur] })).toBeUndefined()
  })

  it('counts as an image the pipeline uses', () => {
    const open = createSourceStep('src-1')
    const composite = createSharpStep('composite', {
      images: [{ input: 'src-2' }],
    })

    expect(stepOperandSourceIds(open)).toEqual(['src-1'])
    expect(
      pipelineOperandSourceIds({ steps: [open, composite, open] }),
    ).toEqual(['src-1', 'src-2'])
  })

  it('is added, moved and switched like any other step', () => {
    const open = createSourceStep('src-1')
    const blur = createSharpStep('blur')
    const added = applyChange(
      { steps: [blur] },
      { type: 'add-step', step: open, index: 0 },
    )

    expect(added.steps.map(({ id }) => id)).toEqual([open.id, blur.id])
    expect(
      applyChange(added, {
        type: 'set-enabled',
        stepId: open.id,
        enabled: false,
      }).steps[0],
    ).toMatchObject({ enabled: false })
  })

  it('opens another image by a change that can be undone', () => {
    const open = createSourceStep('src-1')
    const planned = planChange(
      { steps: [open] },
      { type: 'set-source', stepId: open.id, sourceId: 'src-2' },
    )

    expect(planned?.pipeline.steps[0]).toMatchObject({ sourceId: 'src-2' })
    expect(planned?.patch.inverse).toEqual({
      type: 'set-source',
      stepId: open.id,
      sourceId: 'src-1',
    })
  })

  it('cannot take Sharp options', () => {
    const open = createSourceStep('src-1')

    expect(() =>
      planChange(
        { steps: [open] },
        { type: 'set-options', stepId: open.id, options: {} },
      ),
    ).toThrow(/does not have those settings/)
  })
})
