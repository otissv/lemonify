import { describe, expect, it } from 'vitest'

import {
  DocumentChangeSchema,
  InvalidChangeError,
  applyChange,
  planChange,
} from '@/features/pipeline/document-change'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { pipelineOf, TEST_CANVAS } from '@/test/pipelines'

const BIGGER = { width: 800, height: 600, background: '#102030' }

describe('set-canvas', () => {
  it('changes the canvas and leaves the steps', () => {
    const blur = createSharpStep('blur')
    const pipeline = pipelineOf(blur)
    const next = applyChange(pipeline, { type: 'set-canvas', canvas: BIGGER })
    expect(next.canvas).toEqual(BIGGER)
    expect(next.steps).toEqual(pipeline.steps)
  })

  it('is undone by a change that puts the old canvas back', () => {
    const pipeline = pipelineOf()
    const planned = planChange(pipeline, { type: 'set-canvas', canvas: BIGGER })
    if (planned === null) throw new Error('expected a change')
    expect(planned.patch.inverse).toEqual({
      type: 'set-canvas',
      canvas: TEST_CANVAS,
    })
    expect(applyChange(planned.pipeline, planned.patch.inverse)).toEqual(
      pipeline,
    )
  })

  it('records nothing when the canvas is already that', () => {
    expect(
      planChange(pipelineOf(), { type: 'set-canvas', canvas: TEST_CANVAS }),
    ).toBeNull()
  })

  it('refuses a canvas that is not valid', () => {
    for (const canvas of [
      { width: 0, height: 5, background: 'transparent' },
      { width: 5, height: 5, background: 'red' },
    ]) {
      expect(
        DocumentChangeSchema.safeParse({ type: 'set-canvas', canvas }).success,
      ).toBe(false)
    }
    expect(() =>
      applyChange(pipelineOf(), {
        type: 'set-canvas',
        canvas: { width: 0, height: 5, background: 'transparent' },
      }),
    ).toThrow(InvalidChangeError)
  })
})
