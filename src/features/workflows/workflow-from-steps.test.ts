import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import { canvasOfSize } from '@/features/pipeline/canvas'
import { IMAGE_LAYER_KIND } from '@/features/pipeline/layer-kinds'

import { workflowProblem } from './segments'
import { WorkflowDefinitionSchema } from './workflow'
import { workflowDefinitionFromSteps } from './workflow-from-steps'

describe('workflowDefinitionFromSteps', () => {
  it('is an empty image layer, the slot for the input, when there are no steps', () => {
    const definition = workflowDefinitionFromSteps({
      inputs: ['a'],
      steps: [],
    })

    expect(definition.pipeline.steps).toEqual([
      expect.objectContaining({ kind: IMAGE_LAYER_KIND }),
    ])
    expect(workflowProblem(definition)).toBeUndefined()
  })

  it('puts the steps after the slot, in order, and fills inputs, canvas and output', () => {
    const canvas = { ...canvasOfSize(800, 600), background: '#ffffff' }
    const definition = workflowDefinitionFromSteps({
      inputs: ['a', 'b', 'a'],
      canvas,
      steps: [
        { op: 'blur', options: { sigma: 2 } },
        {
          tool: AiToolId.Upscale,
          settings: { model: 'x', scale: 2, iterations: 1, tta: false },
        },
        { op: 'rotate', options: { angle: 90 } },
      ],
      output: {
        format: ExportFormat.Png,
        options: {},
        keepMetadata: false,
        widths: [100],
        suffix: '',
      },
    })

    expect(WorkflowDefinitionSchema.safeParse(definition).success).toBe(true)
    expect(workflowProblem(definition)).toBeUndefined()
    expect(definition.pipeline.canvas).toEqual(canvas)
    expect(definition.inputs).toEqual(['a', 'b'])
    expect(definition.output.widths).toEqual([100])
    expect(
      definition.pipeline.steps.map((step) =>
        step.kind === 'sharp' ? step.op : step.kind,
      ),
    ).toEqual([IMAGE_LAYER_KIND, 'blur', 'ai', 'rotate'])
  })
})
