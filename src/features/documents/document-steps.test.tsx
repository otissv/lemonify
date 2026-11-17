import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { PreviewStatus } from '@/features/documents/document-render'
import {
  changeDocument,
  getDocument,
  listDocuments,
} from '@/features/documents/document-functions'
import { followJob } from '@/features/jobs/follow-job'
import { cancelJob } from '@/features/jobs/job-functions'
import {
  createAiStep,
  createGroupStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import {
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { JobState } from '@/server/jobs/job-types'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import {
  DOCUMENT_ID,
  documentView,
  echoChanges,
} from '@/test/document-fixtures'
import { renderApp } from '@/test/render-app'

vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))

const BLUR = createSharpStep('blur', { sigma: 2 })
const FLIP = createSharpStep('flip')
const UPSCALE = createAiStep({
  tool: AiToolId.Upscale,
  settings: { model: 'siax', scale: 4, iterations: 1, tta: false },
})

const SUMMARY = {
  id: DOCUMENT_ID,
  name: 'one.png',
  source: documentView().source,
  revision: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

async function showSteps(
  steps: ReadonlyArray<PipelineStep>,
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const view = documentView(steps)
  vi.mocked(getDocument).mockResolvedValue(view)
  echoChanges(vi.mocked(changeDocument), view)
  await renderApp(`/documents/${DOCUMENT_ID}`)
  await user.click(
    await screen.findByRole('button', { name: 'Show steps of one.png' }),
  )
  return screen.findByRole('list', { name: 'Steps of one.png' })
}

describe('DocumentSteps', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(listDocuments).mockResolvedValue([SUMMARY])
    vi.mocked(requestPreview).mockResolvedValue({ id: 'p' } as never)
    vi.mocked(requestThumbnails).mockResolvedValue({ id: 't' } as never)
    vi.mocked(followJob).mockReturnValue(new Promise(() => undefined))
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('says there are no edits for a document with no steps', async () => {
    const user = userEvent.setup()
    await renderApp(`/documents/${DOCUMENT_ID}`)
    vi.mocked(getDocument).mockResolvedValue({
      ...documentView(),
      pipeline: { steps: [] },
    })
    await user.click(
      await screen.findByRole('button', { name: 'Show steps of one.png' }),
    )

    expect(await screen.findByText('No edits yet.')).toBeVisible()
  })

  it('lists the first layer last, as the canvas, with the name of its file', async () => {
    const list = await showSteps([BLUR], userEvent.setup())

    const items = within(list).getAllByRole('listitem')
    const canvas = items.at(-1) as HTMLElement
    expect(within(canvas).getByText('Layer')).toBeInTheDocument()
    expect(within(canvas).getByText('Canvas · one.png')).toBeInTheDocument()
  })

  it('lets the layer that sets the canvas be hidden, moved and deleted like any other', async () => {
    const list = await showSteps([BLUR], userEvent.setup())

    const canvas = within(list).getAllByRole('listitem').at(-1) as HTMLElement
    expect(
      within(canvas).getByRole('button', { name: 'Hide Layer' }),
    ).toBeEnabled()
    expect(
      within(canvas).getByRole('button', { name: 'Move Layer up' }),
    ).toBeEnabled()
    expect(
      within(canvas).getByRole('button', { name: 'Delete Layer' }),
    ).toBeEnabled()
    expect(canvas).toHaveAttribute('draggable', 'true')
  })

  it('lists the steps with the last on top, with what is set on each', async () => {
    const list = await showSteps([BLUR, FLIP], userEvent.setup())

    const names = within(list)
      .getAllByRole('button', { pressed: undefined })
      .map((button) => button.getAttribute('aria-label'))
      .filter((name) => name === 'Blur' || name === 'Flip')
    expect(names).toEqual(['Flip', 'Blur'])
    expect(within(list).getByText('1 option set')).toBeVisible()
    expect(within(list).getByText('Default options')).toBeVisible()
  })

  it('titles a step by its name, and keeps the tool’s name for its options', async () => {
    const list = await showSteps(
      [{ ...BLUR, name: 'Soften' }],
      userEvent.setup(),
    )

    expect(within(list).getByRole('button', { name: 'Soften' })).toBeVisible()
    expect(
      within(list).queryByRole('button', { name: 'Blur' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide Soften' })).toBeVisible()
  })

  it('says how a step is blended, naming only what differs from the defaults', async () => {
    const blended = {
      ...createSharpStep('blur', { sigma: 2 }),
      blend: { mode: 'multiply' as const, opacity: 50 },
    }
    const list = await showSteps([blended], userEvent.setup())

    expect(within(list).getByText('1 option set · multiply 50%')).toBeVisible()
  })

  it('shows a layer with its image, opacity and blend', async () => {
    const layer = {
      ...createLayerStep('second'),
      opacity: 50,
      blend: 'multiply' as const,
    }
    const user = userEvent.setup()
    const view = documentView([layer])
    const second = { ...view.source, id: 'second', fileName: 'logo.png' }
    vi.mocked(getDocument).mockResolvedValue({
      ...view,
      sources: [view.source, second],
    })
    await renderApp(`/documents/${DOCUMENT_ID}`)
    await user.click(
      await screen.findByRole('button', { name: 'Show steps of one.png' }),
    )

    const list = await screen.findByRole('list', { name: 'Steps of one.png' })

    expect(
      await within(list).findByText('logo.png · 50% · multiply'),
    ).toBeVisible()
  })

  it('switches a step off, sending one change to the server', async () => {
    const user = userEvent.setup()
    await showSteps([BLUR], user)

    await user.click(screen.getByRole('button', { name: 'Hide Blur' }))

    await waitFor(() => {
      expect(changeDocument).toHaveBeenCalledWith({
        data: {
          id: DOCUMENT_ID,
          revision: 0,
          change: { type: 'set-enabled', stepId: BLUR.id, enabled: false },
        },
      })
    })
    expect(
      await screen.findByRole('button', { name: 'Show Blur' }),
    ).toBeVisible()
  })

  it('deletes a step', async () => {
    const user = userEvent.setup()
    await showSteps([BLUR, FLIP], user)

    await user.click(screen.getByRole('button', { name: 'Delete Blur' }))

    expect(
      screen.queryByRole('button', { name: 'Blur' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flip' })).toBeVisible()
    await waitFor(() => {
      expect(changeDocument).toHaveBeenCalledWith({
        data: {
          id: DOCUMENT_ID,
          revision: 0,
          change: { type: 'remove-step', stepId: BLUR.id },
        },
      })
    })
  })

  it('moves a step up, which is later in the pipeline, with its button', async () => {
    const user = userEvent.setup()
    const list = await showSteps([BLUR, FLIP], user)

    await user.click(screen.getByRole('button', { name: 'Move Blur up' }))

    await waitFor(() => {
      expect(changeDocument).toHaveBeenCalledWith({
        data: {
          id: DOCUMENT_ID,
          revision: 0,
          change: { type: 'move-step', stepId: BLUR.id, to: 2 },
        },
      })
    })
    const order = within(list)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((name) => name === 'Blur' || name === 'Flip')
    expect(order).toEqual(['Blur', 'Flip'])
  })

  it('offers no move that would leave the pipeline', async () => {
    const user = userEvent.setup()
    await showSteps([BLUR, FLIP], user)

    expect(screen.getByRole('button', { name: 'Move Flip up' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move Layer down' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Blur down' })).toBeEnabled()
  })

  it('selects a step and shows its options', async () => {
    const user = userEvent.setup()
    await showSteps([BLUR], user)

    await user.click(screen.getByRole('button', { name: 'Blur' }))

    expect(useAppStore.getState().selectedSteps[DOCUMENT_ID]).toBe(BLUR.id)
    expect(useAppStore.getState().activeTool).toBe('options')
  })

  it('shows the small picture the server made for a step', async () => {
    const user = userEvent.setup()
    const list = await showSteps([BLUR], user)

    useAppStore
      .getState()
      .setThumbnails(DOCUMENT_ID, [{ stepId: BLUR.id, key: 'abc' }])

    await waitFor(() => {
      expect(
        list.querySelector('[data-slot="step-thumbnail"]'),
      ).toHaveAttribute(
        'src',
        `/api/documents/${DOCUMENT_ID}/renders/thumbnail/abc`,
      )
    })
  })

  describe('a group', () => {
    const MEMBER_ONE = createSharpStep('blur', { sigma: 3 })
    const MEMBER_TWO = createSharpStep('flop')
    const GROUP = createGroupStep([MEMBER_ONE, MEMBER_TWO], 'Look')

    function lastChange(): unknown {
      const call = vi.mocked(changeDocument).mock.calls.at(-1)
      return (call?.[0] as { data: { change: unknown } } | undefined)?.data
        .change
    }

    it('lists its steps under it, the last on top, and says how many it holds', async () => {
      const list = await showSteps([GROUP], userEvent.setup())

      const inner = within(list).getByRole('list', { name: 'Steps in Look' })
      const names = within(inner)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
        .filter((name) => name === 'Blur' || name === 'Flop')
      expect(names).toEqual(['Flop', 'Blur'])
      expect(within(list).getByText('2 steps')).toBeVisible()
    })

    it('folds away its steps and shows them again', async () => {
      const user = userEvent.setup()
      const list = await showSteps([GROUP], user)

      await user.click(
        within(list).getByRole('button', { name: 'Collapse Look' }),
      )
      expect(
        within(list).queryByRole('list', { name: 'Steps in Look' }),
      ).not.toBeInTheDocument()

      await user.click(
        within(list).getByRole('button', { name: 'Expand Look' }),
      )
      expect(
        within(list).getByRole('list', { name: 'Steps in Look' }),
      ).toBeVisible()
    })

    it('is switched off with one change to the group', async () => {
      const user = userEvent.setup()
      await showSteps([GROUP], user)

      await user.click(screen.getByRole('button', { name: 'Hide Look' }))

      await waitFor(() => {
        expect(lastChange()).toEqual({
          type: 'set-enabled',
          stepId: GROUP.id,
          enabled: false,
        })
      })
    })

    it('is deleted with the steps in it', async () => {
      const user = userEvent.setup()
      await showSteps([GROUP], user)

      await user.click(screen.getByRole('button', { name: 'Delete Look' }))

      await waitFor(() => {
        expect(lastChange()).toEqual({ type: 'remove-step', stepId: GROUP.id })
      })
    })

    it('is made from steps picked with ctrl, with the toolbar button', async () => {
      const user = userEvent.setup()
      await showSteps([BLUR, FLIP], user)
      const group = screen.getByRole('button', {
        name: 'Group selected steps',
      })
      expect(group).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Blur' }))
      await user.keyboard('{Control>}')
      await user.click(screen.getByRole('button', { name: 'Flip' }))
      await user.keyboard('{/Control}')
      expect(group).toBeEnabled()
      await user.click(group)

      await waitFor(() => {
        expect(lastChange()).toMatchObject({
          type: 'group-steps',
          group: { kind: 'group', steps: [BLUR, FLIP] },
        })
      })
    })

    it('cannot be made from steps that are not next to each other', async () => {
      const user = userEvent.setup()
      await showSteps([BLUR, FLIP], user)

      await user.click(screen.getByRole('button', { name: 'Layer' }))
      await user.keyboard('{Control>}')
      await user.click(screen.getByRole('button', { name: 'Flip' }))
      await user.keyboard('{/Control}')

      expect(
        screen.getByRole('button', { name: 'Group selected steps' }),
      ).toBeDisabled()
    })

    it('says it has its own picture, and can be made one from its options', async () => {
      const user = userEvent.setup()
      await showSteps([GROUP], user)

      await user.click(screen.getByRole('button', { name: 'Group Look' }))
      await user.click(
        await screen.findByRole('switch', { name: 'Own picture' }),
      )

      await waitFor(() => {
        expect(lastChange()).toEqual({
          type: 'set-sub-document',
          stepId: GROUP.id,
          subDocument: true,
        })
      })
      expect(await screen.findByText('Own picture · 2 steps')).toBeVisible()
    })

    it('shows where it is placed only once it is a picture of its own', async () => {
      const user = userEvent.setup()
      await showSteps([{ ...GROUP, subDocument: true }], user)

      await user.click(screen.getByRole('button', { name: 'Group Look' }))

      expect(await screen.findByLabelText(/opacity/i)).toBeVisible()
    })

    it('can be taken apart from its options', async () => {
      const user = userEvent.setup()
      await showSteps([GROUP], user)

      await user.click(screen.getByRole('button', { name: 'Group Look' }))
      await user.click(await screen.findByRole('button', { name: 'Ungroup' }))

      await waitFor(() => {
        expect(lastChange()).toEqual({ type: 'ungroup', groupId: GROUP.id })
      })
    })
  })

  describe('an AI step', () => {
    it('says it has not run while the server has no result for it', async () => {
      const user = userEvent.setup()
      const list = await showSteps([UPSCALE], user)

      useAppStore.getState().setPreview(DOCUMENT_ID, {
        status: PreviewStatus.Ready,
        key: 'k',
        pendingStepIds: [UPSCALE.id],
        problems: [],
      })

      expect(await within(list).findByText('Not run yet')).toBeVisible()
    })

    it('shows how far it has run, and cancels it', async () => {
      vi.mocked(cancelJob).mockResolvedValue({} as never)
      const user = userEvent.setup()
      const list = await showSteps([UPSCALE], user)

      useAppStore.getState().setAiRun(DOCUMENT_ID, {
        jobId: 'job-1',
        stepId: UPSCALE.id,
        state: JobState.Running,
        progress: 0.4,
      })

      expect(await within(list).findByText('Running 40%')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Cancel Upscale' }))
      expect(cancelJob).toHaveBeenCalledWith({ data: { id: 'job-1' } })
    })

    it('shows why a run failed', async () => {
      const user = userEvent.setup()
      const list = await showSteps([UPSCALE], user)

      useAppStore.getState().setAiRun(DOCUMENT_ID, {
        jobId: null,
        stepId: UPSCALE.id,
        state: JobState.Failed,
        progress: 0,
        error: 'No GPU was found.',
      })

      expect(await within(list).findByText('No GPU was found.')).toBeVisible()
    })
  })
})
