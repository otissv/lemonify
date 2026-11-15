import { describe, expect, it } from 'vitest'

import {
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
  it('rejects a connection to a step that does not exist', () => {
    const created = createWorkflow('Test')
    const broken = {
      ...created,
      edges: [
        {
          id: crypto.randomUUID(),
          source: created.nodes[0]?.id,
          target: crypto.randomUUID(),
        },
      ],
    }

    expect(WorkflowSchema.safeParse(broken).success).toBe(false)
  })

  it('rejects an unknown Sharp op', () => {
    const created = createWorkflow('Test')
    const broken = {
      ...created,
      nodes: [
        ...created.nodes,
        {
          id: crypto.randomUUID(),
          kind: 'sharp',
          op: 'explode',
          options: {},
          position: { x: 0, y: 0 },
        },
      ],
    }

    expect(WorkflowSchema.safeParse(broken).success).toBe(false)
  })
})

describe('node defaults', () => {
  it('starts Input with no sources', () => {
    expect(
      createWorkflow('Test').nodes.find((node) => node.kind === 'input'),
    ).toMatchObject({ sourceIds: [] })
  })

  it('starts Output with the default settings', () => {
    expect(
      createWorkflow('Test').nodes.find((node) => node.kind === 'output'),
    ).toMatchObject({ settings: { widths: [], suffix: '' } })
  })

  it('rejects an AI step that names no known tool', () => {
    const created = createWorkflow('Test')
    const broken = {
      ...created,
      nodes: [
        ...created.nodes,
        {
          id: crypto.randomUUID(),
          kind: 'ai',
          tool: 'sky-select',
          settings: {},
          position: { x: 0, y: 0 },
        },
      ],
    }

    expect(WorkflowSchema.safeParse(broken).success).toBe(false)
  })
})
