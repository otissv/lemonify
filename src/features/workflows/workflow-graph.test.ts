import { describe, expect, it } from 'vitest'

import { defaultOutputSettings } from '@/features/workflows/output-settings'
import { createWorkflow } from '@/features/workflows/workflow'
import type { Workflow } from '@/features/workflows/workflow'
import {
  WorkflowNodeKind,
  addInputSources,
  appendStep,
  canConnect,
  insertStepAfter,
  updateOutputSettings,
  pipelineSteps,
  removeInputSource,
  removeStep,
  createSharpNode,
  createAiNode,
  nodeOfKind,
} from '@/features/workflows/workflow-graph'
import { AiToolId } from '@/features/ai/ai-tools'
import type { UpscaleSettings } from '@/features/upscale/upscale-settings'

const SETTINGS: UpscaleSettings = {
  model: 'siax',
  scale: 4,
  noise: undefined,
  iterations: 1,
  tta: false,
}

function workflowWithSteps(): {
  workflow: Workflow
  input: string
  output: string
  resize: string
  upscale: string
} {
  const base = createWorkflow('Test')
  const resize = createSharpNode('resize', { x: 200, y: 0 })
  const upscale = createAiNode(
    { tool: AiToolId.Upscale, settings: SETTINGS },
    { x: 400, y: 0 },
  )
  const workflow = { ...base, nodes: [...base.nodes, resize, upscale] }
  return {
    workflow,
    input: nodeOfKind(workflow, WorkflowNodeKind.Input).id,
    output: nodeOfKind(workflow, WorkflowNodeKind.Output).id,
    resize: resize.id,
    upscale: upscale.id,
  }
}

describe('createWorkflow', () => {
  it('starts with an Input and an Output step and no connections', () => {
    const workflow = createWorkflow('Test')

    expect(workflow.nodes.map((node) => node.kind)).toEqual([
      WorkflowNodeKind.Input,
      WorkflowNodeKind.Output,
    ])
    expect(workflow.edges).toEqual([])
  })
})

describe('createSharpNode', () => {
  it('creates a Sharp step with no options set', () => {
    const node = createSharpNode('sharpen', { x: 10, y: 20 })

    expect(node).toMatchObject({
      kind: WorkflowNodeKind.Sharp,
      op: 'sharpen',
      options: {},
      position: { x: 10, y: 20 },
    })
  })
})

describe('canConnect', () => {
  it('connects Input to a step and a step to Output', () => {
    const { workflow, input, resize, output } = workflowWithSteps()

    expect(canConnect(workflow, input, resize)).toBe(true)
    expect(canConnect(workflow, resize, output)).toBe(true)
  })

  it('never connects into Input or out of Output', () => {
    const { workflow, input, resize, output } = workflowWithSteps()

    expect(canConnect(workflow, resize, input)).toBe(false)
    expect(canConnect(workflow, output, resize)).toBe(false)
  })

  it('never connects a step to itself', () => {
    const { workflow, resize } = workflowWithSteps()

    expect(canConnect(workflow, resize, resize)).toBe(false)
  })

  it('keeps the pipeline a single line: one connection in and out per step', () => {
    const { workflow, input, resize, upscale } = workflowWithSteps()
    const connected = {
      ...workflow,
      edges: [{ id: crypto.randomUUID(), source: input, target: resize }],
    }

    expect(canConnect(connected, input, upscale)).toBe(false)
    expect(canConnect(connected, upscale, resize)).toBe(false)
  })

  it('refuses a connection that would make a loop', () => {
    const { workflow, resize, upscale } = workflowWithSteps()
    const connected = {
      ...workflow,
      edges: [{ id: crypto.randomUUID(), source: resize, target: upscale }],
    }

    expect(canConnect(connected, upscale, resize)).toBe(false)
  })
})

describe('appendStep', () => {
  it('wires the first step between Input and Output', () => {
    const workflow = createWorkflow('Test')
    const resize = createSharpNode('resize', { x: 0, y: 0 })

    const next = appendStep(workflow, resize)

    expect(pipelineSteps(next).map((node) => node.kind)).toEqual([
      WorkflowNodeKind.Input,
      WorkflowNodeKind.Sharp,
      WorkflowNodeKind.Output,
    ])
  })

  it('adds later steps after the last one, before Output', () => {
    const resize = createSharpNode('resize', { x: 0, y: 0 })
    const upscale = createAiNode(
      { tool: AiToolId.Upscale, settings: SETTINGS },
      { x: 0, y: 0 },
    )

    const next = appendStep(appendStep(createWorkflow('Test'), resize), upscale)

    expect(
      pipelineSteps(next)
        .map(({ id }) => id)
        .slice(1, -1),
    ).toEqual([resize.id, upscale.id])
  })

  it('places the step to the right of the last one and keeps Output after it', () => {
    const workflow = createWorkflow('Test')
    const input = nodeOfKind(workflow, WorkflowNodeKind.Input)

    const next = appendStep(
      appendStep(workflow, createSharpNode('resize', { x: 0, y: 0 })),
      createSharpNode('sharpen', { x: 0, y: 0 }),
    )
    const steps = pipelineSteps(next)
    const [first, second, output] = [steps.at(1), steps.at(2), steps.at(3)]

    expect(first?.position.x).toBeGreaterThan(input.position.x)
    expect(second?.position.x).toBeGreaterThan(first?.position.x ?? 0)
    expect(output?.position.x).toBeGreaterThan(second?.position.x ?? 0)
  })
})

describe('removeStep', () => {
  it('removes the step and reconnects its neighbours', () => {
    const resize = createSharpNode('resize', { x: 0, y: 0 })
    const workflow = appendStep(createWorkflow('Test'), resize)

    const next = removeStep(workflow, resize.id)

    expect(next.nodes.map(({ id }) => id)).not.toContain(resize.id)
    expect(pipelineSteps(next).map((node) => node.kind)).toEqual([
      WorkflowNodeKind.Input,
      WorkflowNodeKind.Output,
    ])
  })

  it('never removes Input or Output', () => {
    const workflow = createWorkflow('Test')

    expect(
      removeStep(workflow, nodeOfKind(workflow, WorkflowNodeKind.Input).id),
    ).toBe(workflow)
  })
})

describe('insertStepAfter', () => {
  function opsOf(workflow: Workflow): Array<string> {
    const labels: Array<string> = []
    for (const node of pipelineSteps(workflow)) {
      labels.push(node.kind === WorkflowNodeKind.Sharp ? node.op : node.kind)
    }
    return labels
  }

  function resizeThenRotate(): Workflow {
    return appendStep(
      appendStep(
        createWorkflow('Test'),
        createSharpNode('resize', { x: 0, y: 0 }),
      ),
      createSharpNode('rotate', { x: 0, y: 0 }),
    )
  }

  it('inserts the step between the chosen step and the one after it', () => {
    const workflow = resizeThenRotate()
    const resize = pipelineSteps(workflow).at(1)

    const next = insertStepAfter(
      workflow,
      resize?.id ?? '',
      createSharpNode('sharpen', { x: 0, y: 0 }),
    )

    expect(opsOf(next)).toEqual([
      'input',
      'resize',
      'sharpen',
      'rotate',
      'output',
    ])
  })

  it('inserts straight after Input', () => {
    const workflow = resizeThenRotate()
    const input = nodeOfKind(workflow, WorkflowNodeKind.Input)

    const next = insertStepAfter(
      workflow,
      input.id,
      createSharpNode('sharpen', { x: 0, y: 0 }),
    )

    expect(opsOf(next).slice(0, 3)).toEqual(['input', 'sharpen', 'resize'])
  })

  it('inserts before Output when Output is chosen', () => {
    const workflow = resizeThenRotate()
    const output = nodeOfKind(workflow, WorkflowNodeKind.Output)

    const next = insertStepAfter(
      workflow,
      output.id,
      createSharpNode('sharpen', { x: 0, y: 0 }),
    )

    expect(opsOf(next).slice(-2)).toEqual(['sharpen', 'output'])
  })

  it('moves the later steps right so nothing overlaps', () => {
    const workflow = resizeThenRotate()
    const resize = pipelineSteps(workflow).at(1)

    const next = insertStepAfter(
      workflow,
      resize?.id ?? '',
      createSharpNode('sharpen', { x: 0, y: 0 }),
    )

    const xs: Array<number> = []
    for (const node of pipelineSteps(next)) xs.push(node.position.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(new Set(xs).size).toBe(xs.length)
  })
})

describe('input sources', () => {
  function sourceIds(workflow: Workflow): ReadonlyArray<string> {
    const input = nodeOfKind(workflow, WorkflowNodeKind.Input)
    return input.kind === WorkflowNodeKind.Input ? input.sourceIds : []
  }

  it('starts with no sources', () => {
    expect(sourceIds(createWorkflow('Test'))).toEqual([])
  })

  it('adds sources in the order chosen, once each', () => {
    const workflow = addInputSources(createWorkflow('Test'), ['a', 'b'])

    expect(sourceIds(addInputSources(workflow, ['b', 'c', 'a']))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('removes one source by id', () => {
    const workflow = addInputSources(createWorkflow('Test'), ['a', 'b'])

    expect(sourceIds(removeInputSource(workflow, 'a'))).toEqual(['b'])
  })

  it('keeps every other step as it was', () => {
    const resized = appendStep(
      createWorkflow('Test'),
      createSharpNode('resize', { x: 0, y: 0 }),
    )

    const next = addInputSources(resized, ['a'])

    expect(next.nodes.filter((n) => n.kind !== WorkflowNodeKind.Input)).toEqual(
      resized.nodes.filter((n) => n.kind !== WorkflowNodeKind.Input),
    )
  })
})

describe('updateOutputSettings', () => {
  it('starts with the default output settings', () => {
    const output = nodeOfKind(createWorkflow('Test'), WorkflowNodeKind.Output)

    expect(output.kind === WorkflowNodeKind.Output && output.settings).toEqual(
      defaultOutputSettings(),
    )
  })

  it('replaces the settings of Output and nothing else', () => {
    const workflow = appendStep(
      createWorkflow('Test'),
      createSharpNode('resize', { x: 0, y: 0 }),
    )

    const next = updateOutputSettings(workflow, {
      ...defaultOutputSettings(),
      widths: [480, 768],
    })

    const output = nodeOfKind(next, WorkflowNodeKind.Output)
    expect(
      output.kind === WorkflowNodeKind.Output && output.settings.widths,
    ).toEqual([480, 768])
    expect(
      next.nodes.filter((n) => n.kind !== WorkflowNodeKind.Output),
    ).toEqual(workflow.nodes.filter((n) => n.kind !== WorkflowNodeKind.Output))
  })
})
