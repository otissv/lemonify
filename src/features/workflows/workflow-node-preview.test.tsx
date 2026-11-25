import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { followJob } from '@/features/jobs/follow-job'
import { requestWorkflowPreview } from '@/features/render/render-functions'
import { RunCanvasMode, createWorkflow } from '@/features/workflows/workflow'
import { WorkflowNodePreview } from '@/features/workflows/workflow-node-preview'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { JobView } from '@/server/services/job-service'
import { usePipelineStore } from '@/store/pipeline-store'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/render/render-functions', () => ({
  requestWorkflowPreview: vi.fn(),
}))

vi.mock('@/features/jobs/follow-job', () => ({
  followJob: vi.fn(),
}))

const KEY = 'a'.repeat(64)
const WORKFLOW_ID = 'wf-1'

function openWorkflow(): void {
  const workflow = createWorkflow('Web sizes')
  usePipelineStore.getState().confirmWorkflow(
    {
      ...workflow,
      id: WORKFLOW_ID,
      revision: 3,
      canUndo: false,
      canRedo: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    true,
  )
}

function finishedJob(
  result: JobView['result'],
  state: JobState = JobState.Done,
  error: string | null = null,
): JobView {
  return {
    id: 'job-1',
    kind: JobKind.WorkflowPreview,
    state,
    progress: 1,
    result,
    error,
    documentId: null,
    workflowRunId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  }
}

function renderPreview(nodeId = 'output'): ReturnType<typeof render> {
  return render(
    <WorkflowNodePreview
      workflowId={WORKFLOW_ID}
      nodeId={nodeId}
      canvasMode={RunCanvasMode.Workflow}
      name="Output"
    />,
  )
}

describe('WorkflowNodePreview', () => {
  beforeEach(() => {
    resetStores()
    openWorkflow()
    vi.mocked(requestWorkflowPreview).mockResolvedValue(
      finishedJob(null, JobState.Waiting),
    )
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('asks for the picture of the node and shows it large on a canvas', async () => {
    vi.mocked(followJob).mockResolvedValue(
      finishedJob({
        kind: JobKind.WorkflowPreview,
        nodeId: 'output',
        picture: { key: KEY, width: 1920, height: 1080 },
      }),
    )
    renderPreview()

    expect(screen.getByRole('status')).toHaveTextContent('Rendering…')
    const picture = await screen.findByRole('img', { name: 'Output' })
    expect(picture).toHaveAttribute(
      'src',
      `/api/workflows/${WORKFLOW_ID}/renders/preview/${KEY}`,
    )
    expect(screen.getByRole('application', { name: 'Canvas' })).toBeVisible()
    const toolbar = screen.getByRole('toolbar', { name: 'Preview view' })
    expect(toolbar).toContainElement(
      screen.getByRole('textbox', { name: 'Zoom' }),
    )
    expect(toolbar).toContainElement(
      screen.getByRole('button', { name: 'Move the picture left' }),
    )
    expect(requestWorkflowPreview).toHaveBeenCalledWith({
      data: {
        workflowId: WORKFLOW_ID,
        canvasMode: RunCanvasMode.Workflow,
        nodeId: 'output',
      },
    })
  })

  it('says so when the node has no picture', async () => {
    vi.mocked(followJob).mockResolvedValue(
      finishedJob({
        kind: JobKind.WorkflowPreview,
        nodeId: 'output',
        picture: null,
      }),
    )
    renderPreview()

    expect(
      await screen.findByText('This step has no picture yet.'),
    ).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows why the picture could not be made', async () => {
    vi.mocked(followJob).mockResolvedValue(
      finishedJob(null, JobState.Failed, 'The image is gone.'),
    )
    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The image is gone.',
    )
  })

  it('asks again when another node is chosen', async () => {
    vi.mocked(followJob).mockResolvedValue(
      finishedJob({
        kind: JobKind.WorkflowPreview,
        nodeId: 'output',
        picture: { key: KEY, width: 10, height: 10 },
      }),
    )
    const { rerender } = renderPreview()
    await screen.findByRole('img')
    rerender(
      <WorkflowNodePreview
        workflowId={WORKFLOW_ID}
        nodeId="canvas"
        canvasMode={RunCanvasMode.Workflow}
        name="Canvas"
      />,
    )

    await waitFor(() => {
      expect(requestWorkflowPreview).toHaveBeenLastCalledWith({
        data: {
          workflowId: WORKFLOW_ID,
          canvasMode: RunCanvasMode.Workflow,
          nodeId: 'canvas',
        },
      })
    })
  })
})
