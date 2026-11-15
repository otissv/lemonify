import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import { describe, expect, it } from 'vitest'

import { planSegments, workflowProblem } from './segments'
import { workflowGraphFromSteps } from './workflow-from-steps'
import { WorkflowGraphSchema } from './workflow'

describe('workflowGraphFromSteps', () => {
  it('joins Input to Output when there are no steps', () => {
    const graph = workflowGraphFromSteps('Plain', {
      sourceIds: ['a'],
      steps: [],
    })
    expect(workflowProblem(graph)).toBeUndefined()
  })

  it('keeps the order of the steps and fills Input and Output', () => {
    const graph = workflowGraphFromSteps('Mixed', {
      sourceIds: ['a', 'b', 'a'],
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
    expect(WorkflowGraphSchema.safeParse(graph).success).toBe(true)
    expect(workflowProblem(graph)).toBeUndefined()
    const kinds = planSegments(graph).map(({ kind }) => kind)
    expect(kinds).toEqual(['sharp', 'ai', 'sharp'])
    const input = graph.nodes.find(({ kind }) => kind === 'input')
    expect(input).toMatchObject({ sourceIds: ['a', 'b'] })
  })
})
