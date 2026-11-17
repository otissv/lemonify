import { z } from 'zod'

import { aiToolSchema } from '@/features/ai/ai-tools'
import type { Canvas } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { defaultOutputSettings } from '@/features/workflows/output-settings'
import type { OutputSettings } from '@/features/workflows/output-settings'
import {
  DEFAULT_WORKFLOW_CANVAS,
  WorkflowDefinitionSchema,
} from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

/** One step of a workflow written as a plain list: a Sharp operation or an AI tool. */
export const WorkflowStepSpecSchema = z.union([
  z.strictObject({
    op: z.string().min(1),
    options: z.record(z.string(), z.json()).default({}),
  }),
  aiToolSchema({}),
])

export const WorkflowStepSpecsSchema = z.array(WorkflowStepSpecSchema)

export type WorkflowStepSpec = z.output<typeof WorkflowStepSpecSchema>

export type WorkflowDefinitionSpec = {
  inputs: ReadonlyArray<string>
  steps: ReadonlyArray<WorkflowStepSpec>
  canvas?: Canvas
  output?: OutputSettings
}

/**
 * A workflow that runs `steps` in order on each of `inputs`. This is how a
 * command line or a script writes a workflow without a pipeline: the steps go
 * after one empty image layer, which is where each input image is drawn.
 */
export function workflowDefinitionFromSteps(
  spec: WorkflowDefinitionSpec,
): WorkflowDefinition {
  const steps: PipelineStep[] = [createImageLayerStep()]
  for (const step of spec.steps) {
    steps.push(
      'op' in step
        ? createSharpStep(step.op, step.options)
        : createAiStep(step),
    )
  }
  return WorkflowDefinitionSchema.parse({
    pipeline: createPipeline(spec.canvas ?? DEFAULT_WORKFLOW_CANVAS, steps),
    inputs: [...new Set(spec.inputs)],
    output: spec.output ?? defaultOutputSettings(),
  })
}
