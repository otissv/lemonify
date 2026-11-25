import { describe, expect, it } from 'vitest'

import { canvasOfSize } from '@/features/pipeline/canvas'
import {
  InvalidChangeError,
  isDocumentChange,
} from '@/features/pipeline/document-change'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { defaultOutputSettings } from '@/features/workflows/output-settings'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import {
  WorkflowChangeSchema,
  type WorkflowChange,
  WorkflowHistoryPatchSchema,
  applyWorkflowChange,
  planWorkflowChange,
} from '@/features/workflows/workflow-change'

function base(): WorkflowDefinition {
  const { pipeline, inputs, output, canvasSize } = createWorkflow('Test')
  return { pipeline, inputs, output, canvasSize }
}

describe('WorkflowChangeSchema', () => {
  it('takes every change a document takes, and the four a workflow adds', () => {
    const definition = base()
    for (const change of [
      { type: 'set-canvas', canvas: canvasOfSize(10, 10) },
      { type: 'remove-step', stepId: 'a' },
      { type: 'set-inputs', sourceIds: ['a', 'b'] },
      { type: 'set-output', output: defaultOutputSettings() },
      { type: 'set-canvas-size', canvasSize: CanvasSize.Fixed },
      { type: 'replace', definition },
    ]) {
      expect(WorkflowChangeSchema.safeParse(change).success, change.type).toBe(
        true,
      )
    }
  })

  it('refuses a change it does not know, and a patch that holds one', () => {
    expect(WorkflowChangeSchema.safeParse({ type: 'explode' }).success).toBe(
      false,
    )
    expect(
      WorkflowHistoryPatchSchema.safeParse({
        forward: { type: 'set-inputs', sourceIds: [] },
        inverse: { type: 'explode' },
      }).success,
    ).toBe(false)
  })
})

describe('isDocumentChange', () => {
  it('is true for what a document takes and false for the four only a workflow has', () => {
    expect(isDocumentChange({ type: 'set-canvas' })).toBe(true)
    expect(isDocumentChange({ type: 'set-settings' })).toBe(true)
    expect(isDocumentChange({ type: 'set-inputs' })).toBe(false)
    expect(isDocumentChange({ type: 'set-output' })).toBe(false)
    expect(isDocumentChange({ type: 'set-canvas-size' })).toBe(false)
    expect(isDocumentChange({ type: 'replace' })).toBe(false)
  })
})

describe('applyWorkflowChange', () => {
  it('applies a pipeline change to the pipeline and leaves the rest', () => {
    const definition = base()

    const next = applyWorkflowChange(definition, {
      type: 'set-canvas',
      canvas: canvasOfSize(10, 20),
    })

    expect(next.pipeline.canvas).toMatchObject({ width: 10, height: 20 })
    expect(next.inputs).toEqual(definition.inputs)
    expect(next.output).toEqual(definition.output)
  })

  it('sets the inputs and the output', () => {
    const output = { ...defaultOutputSettings(), widths: [100] }

    const next = applyWorkflowChange(
      applyWorkflowChange(base(), { type: 'set-inputs', sourceIds: ['a'] }),
      { type: 'set-output', output },
    )

    expect(next.inputs).toEqual(['a'])
    expect(next.output).toEqual(output)
  })

  it('refuses inputs that repeat an image, and output settings that are not valid', () => {
    expect(() =>
      applyWorkflowChange(base(), {
        type: 'set-inputs',
        sourceIds: ['a', 'a'],
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyWorkflowChange(base(), {
        type: 'set-output',
        output: { ...defaultOutputSettings(), widths: [5, 5] },
      }),
    ).toThrow(InvalidChangeError)
  })

  it('refuses a pipeline change that cannot be made', () => {
    expect(() =>
      applyWorkflowChange(base(), { type: 'remove-step', stepId: 'gone' }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyWorkflowChange(base(), {
        type: 'set-layer',
        stepId: 'gone',
        settings: {
          opacity: 100,
          blend: 'normal',
          fit: 'inside',
          scale: 100,
          rotation: 0,
          anchor: 'centre',
          x: 0,
          y: 0,
        },
      }),
    ).toThrow(InvalidChangeError)
  })

  it('replaces the whole definition', () => {
    const other = { ...base(), inputs: ['z'] }

    expect(
      applyWorkflowChange(base(), { type: 'replace', definition: other }),
    ).toEqual(other)
  })
})

describe('planWorkflowChange', () => {
  it('gives a pipeline change the patch the pipeline gives it', () => {
    const blur = createSharpStep('blur')
    const definition = base()

    const planned = planWorkflowChange(definition, {
      type: 'add-step',
      step: blur,
      index: 1,
    })

    expect(planned?.definition.pipeline.steps).toHaveLength(2)
    expect(planned?.patch).toEqual({
      forward: { type: 'add-step', step: blur, index: 1 },
      inverse: { type: 'remove-step', stepId: blur.id },
    })
  })

  it('undoes the inputs, the output, the canvas size and a replacement exactly', () => {
    const definition = base()
    const output = { ...defaultOutputSettings(), widths: [100] }

    for (const change of [
      { type: 'set-inputs', sourceIds: ['a'] },
      { type: 'set-output', output },
      { type: 'set-canvas-size', canvasSize: CanvasSize.Fixed },
      { type: 'replace', definition: { ...definition, inputs: ['q'] } },
    ] satisfies WorkflowChange[]) {
      const planned = planWorkflowChange(definition, change)
      if (planned === null) throw new Error('expected a change')
      expect(
        applyWorkflowChange(planned.definition, planned.patch.inverse),
      ).toEqual(definition)
      expect(planned.patch.forward).toEqual(change)
    }
  })

  it('records nothing when the change leaves the workflow as it was', () => {
    const definition = base()

    expect(
      planWorkflowChange(definition, { type: 'set-inputs', sourceIds: [] }),
    ).toBeNull()
    expect(
      planWorkflowChange(definition, {
        type: 'set-output',
        output: definition.output,
      }),
    ).toBeNull()
    expect(
      planWorkflowChange(definition, { type: 'replace', definition }),
    ).toBeNull()
  })
})
