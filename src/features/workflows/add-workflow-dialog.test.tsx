import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AddWorkflowDialog } from '@/features/workflows/add-workflow-dialog'
import type { WorkflowView } from '@/server/services/workflow-service'
import { workflowView } from '@/test/workflow-fixtures'
import {
  createWorkflowFn,
  listWorkflows,
} from '@/features/workflows/workflow-functions'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate }),
}))

vi.mock('@/features/workflows/workflow-functions', () => ({
  createWorkflowFn: vi.fn(),
  listWorkflows: vi.fn(),
}))

afterEach(() => {
  vi.resetAllMocks()
})

describe('AddWorkflowDialog', () => {
  it('suggests the next free name', async () => {
    vi.mocked(listWorkflows).mockResolvedValue([])
    const user = userEvent.setup()
    render(<AddWorkflowDialog />)

    await user.click(screen.getByRole('button', { name: 'Add workflow' }))

    expect(await screen.findByDisplayValue('Workflow 1')).toBeVisible()
  })

  it('keeps a name typed before the suggestion arrives', async () => {
    let answer: (workflows: WorkflowView[]) => void = () => {}
    vi.mocked(listWorkflows).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    vi.mocked(createWorkflowFn).mockResolvedValue(
      workflowView('wf-1', 'Holiday photos'),
    )
    const user = userEvent.setup()
    render(<AddWorkflowDialog />)

    await user.click(screen.getByRole('button', { name: 'Add workflow' }))
    await user.type(screen.getByLabelText('Name'), 'Holiday photos')
    answer([])
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(createWorkflowFn).toHaveBeenCalledWith({
      data: { name: 'Holiday photos' },
    })
  })
})
