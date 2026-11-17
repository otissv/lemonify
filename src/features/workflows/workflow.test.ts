import { describe, expect, it } from 'vitest'

import { canvasOfSize } from '@/features/pipeline/canvas'
import { IMAGE_LAYER_KIND } from '@/features/pipeline/layer-kinds'
import {
  PipelineSchema,
  createAiStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { AiToolId } from '@/features/ai/ai-tools'
import {
  DEFAULT_WORKFLOW_CANVAS,
  RunCanvasMode,
  WorkflowDefinitionSchema,
  WorkflowSchema,
  createWorkflow,
  nextWorkflowName,
  workflowNameProblem,
} from '@/features/workflows/workflow'
import type { Workflow } from '@/features/workflows/workflow'

function workflow(name: string): Workflow {
  return createWorkflow(name)
}

describe('nextWorkflowName', () => {
  it('suggests Workflow 1 when there are none', () => {
    expect(nextWorkflowName([])).toBe('Workflow 1')
  })

  it('numbers after the highest existing number', () => {
    expect(nextWorkflowName([workflow('Workflow 2')])).toBe('Workflow 3')
  })

  it('ignores custom names when numbering', () => {
    expect(nextWorkflowName([workflow('Sharpen photos')])).toBe('Workflow 2')
  })
})

describe('workflowNameProblem', () => {
  it('accepts a new name', () => {
    expect(workflowNameProblem('Sharpen photos', [])).toBeNull()
  })

  it('rejects a blank name', () => {
    expect(workflowNameProblem('   ', [])).toBe('Enter a name.')
  })

  it('rejects a name longer than the limit', () => {
    expect(workflowNameProblem('a'.repeat(81), [])).toBe(
      'Use 80 characters or fewer.',
    )
  })

  it('rejects a name already in use, ignoring case and spaces', () => {
    expect(
      workflowNameProblem('  sharpen PHOTOS ', [workflow('Sharpen photos')]),
    ).toBe('A workflow with this name already exists.')
  })
})

describe('createWorkflow', () => {
  it('creates a valid workflow with the trimmed name and a UUID', () => {
    const created = createWorkflow('  Sharpen photos  ')

    expect(WorkflowSchema.parse(created)).toEqual(created)
    expect(created.name).toBe('Sharpen photos')
  })

  it('gives every workflow a different id', () => {
    expect(createWorkflow('A').id).not.toBe(createWorkflow('B').id)
  })
})

describe('WorkflowSchema', () => {
  it('holds a pipeline with its canvas, the images it runs on and its output settings', () => {
    const created = createWorkflow('Test')

    expect(Object.keys(created).sort()).toEqual([
      'id',
      'inputs',
      'name',
      'output',
      'pipeline',
    ])
    expect(created.pipeline.canvas).toEqual(DEFAULT_WORKFLOW_CANVAS)
    expect(created.inputs).toEqual([])
    expect(created.output).toMatchObject({ widths: [], suffix: '' })
  })

  it('starts with one empty image layer, the slot the input images go in', () => {
    const [slot, ...rest] = createWorkflow('Test').pipeline.steps

    expect(rest).toEqual([])
    expect(slot).toMatchObject({ kind: IMAGE_LAYER_KIND, enabled: true })
    expect(slot).not.toHaveProperty('sourceId')
  })

  it('has no graph, no positions and no Input or Output step', () => {
    const created = createWorkflow('Test')

    expect(created).not.toHaveProperty('nodes')
    expect(created).not.toHaveProperty('edges')
    expect(JSON.stringify(created)).not.toMatch(
      /"position"|"kind":"(input|output)"/,
    )
  })

  it('refuses a graph, which is how workflows used to be stored', () => {
    const { pipeline: _pipeline, ...rest } = createWorkflow('Test')
    expect(
      WorkflowSchema.safeParse({ ...rest, nodes: [], edges: [] }).success,
    ).toBe(false)
  })

  it('refuses an unknown Sharp op, and composite, which image layers replace', () => {
    for (const op of ['explode', 'composite']) {
      const created = createWorkflow('Test')
      const broken = {
        ...created,
        pipeline: {
          ...created.pipeline,
          steps: [...created.pipeline.steps, createSharpStep(op)],
        },
      }
      expect(WorkflowSchema.safeParse(broken).success, op).toBe(false)
    }
  })

  it('refuses an AI step that names no known tool', () => {
    const created = createWorkflow('Test')
    const broken = {
      ...created,
      pipeline: {
        ...created.pipeline,
        steps: [
          ...created.pipeline.steps,
          {
            id: crypto.randomUUID(),
            kind: 'ai',
            tool: 'sky-select',
            settings: {},
            enabled: true,
          },
        ],
      },
    }

    expect(WorkflowSchema.safeParse(broken).success).toBe(false)
  })

  it('takes the steps a document takes, groups and sub-documents too', () => {
    const { id: _id, name: _name, ...created } = createWorkflow('Test')
    const definition = WorkflowDefinitionSchema.parse({
      ...created,
      pipeline: {
        ...created.pipeline,
        steps: [
          ...created.pipeline.steps,
          createSharpStep('blur', { sigma: 2 }),
          createAiStep({
            tool: AiToolId.Upscale,
            settings: { model: 'm', scale: 4, iterations: 1, tta: false },
          }),
        ],
      },
    })

    expect(PipelineSchema.safeParse(definition.pipeline).success).toBe(true)
    expect(definition.pipeline.steps).toHaveLength(3)
  })

  it('refuses a pipeline with no canvas', () => {
    const created = createWorkflow('Test')
    const { canvas: _canvas, ...pipeline } = created.pipeline
    expect(WorkflowSchema.safeParse({ ...created, pipeline }).success).toBe(
      false,
    )
  })

  it('refuses the same input image twice', () => {
    const created = createWorkflow('Test')
    expect(
      WorkflowSchema.safeParse({ ...created, inputs: ['a', 'a'] }).success,
    ).toBe(false)
    expect(
      WorkflowSchema.safeParse({ ...created, inputs: ['a', 'b'] }).success,
    ).toBe(true)
  })

  it('refuses an input that is not an id', () => {
    const created = createWorkflow('Test')
    expect(WorkflowSchema.safeParse({ ...created, inputs: [''] }).success).toBe(
      false,
    )
  })
})

describe('createWorkflow canvas', () => {
  it('takes the canvas it is given', () => {
    const canvas = canvasOfSize(640, 480)
    expect(createWorkflow('Test', canvas).pipeline.canvas).toEqual(canvas)
  })
})

describe('RunCanvasMode', () => {
  it('is the workflow’s own canvas, or the size of the first image', () => {
    expect(Object.values(RunCanvasMode)).toEqual(['workflow', 'first-image'])
  })
})
