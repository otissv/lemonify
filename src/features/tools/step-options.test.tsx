import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { PreviewStatus } from '@/features/documents/document-render'
import { changeDocument } from '@/features/documents/document-functions'
import { followJob } from '@/features/jobs/follow-job'
import { createAiStep, createSharpStep } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { requestAiStep } from '@/features/render/render-functions'
import { StepOptions } from '@/features/tools/step-options'
import {
  AI_CATALOGUES,
  DOCUMENT_ID,
  documentView,
  echoChanges,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'
import {
  INITIAL_APP_STATE,
  currentPipeline,
  useAppStore,
} from '@/store/app-store'

vi.mock('@/features/documents/document-functions', () => ({
  getDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))

const SETTINGS = { model: 'siax', scale: 4, iterations: 1, tta: false }

function upscaleStep(): PipelineStep {
  return createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
}

function firstStep(): PipelineStep | undefined {
  return currentPipeline(useAppStore.getState(), DOCUMENT_ID)?.steps.at(0)
}

function showOptionsOf(step?: PipelineStep): void {
  const view = documentView()
  echoChanges(vi.mocked(changeDocument), view)
  loadDocumentIntoEditor(view)
  if (step) addStepAfter(DOCUMENT_ID, step)
  render(<StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />)
}

describe('StepOptions', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('asks for a step to be selected when none is', () => {
    showOptionsOf()

    expect(
      screen.getByText('Select a step in the sidebar, or add one from Tools.'),
    ).toBeVisible()
  })

  describe('a Sharp step', () => {
    it('shows the options of its tool under its name', () => {
      showOptionsOf(createSharpStep('blur'))

      expect(screen.getByRole('heading', { name: 'Blur' })).toBeVisible()
      expect(screen.getByLabelText('Sigma')).toBeVisible()
    })

    it('commits typing as one change after it settles, and sends it to the server once', async () => {
      const user = userEvent.setup()
      showOptionsOf(createSharpStep('blur'))

      await user.type(screen.getByLabelText('Sigma'), '25')

      expect(firstStep()).toMatchObject({ options: {} })
      await waitFor(() => {
        expect(firstStep()).toMatchObject({ options: { sigma: 25 } })
      })
      expect(firstStep()).toMatchObject({ options: { sigma: 25 } })
    })

    it('commits when a field loses focus, without waiting', async () => {
      const user = userEvent.setup()
      showOptionsOf(createSharpStep('blur'))

      await user.type(screen.getByLabelText('Sigma'), '3')
      await user.tab()

      expect(firstStep()).toMatchObject({ options: { sigma: 3 } })
    })

    it('shows what undo restores', async () => {
      const user = userEvent.setup()
      const blur = createSharpStep('blur', { sigma: 2 })
      showOptionsOf(blur)
      await user.clear(screen.getByLabelText('Sigma'))
      await user.type(screen.getByLabelText('Sigma'), '9')
      await user.tab()
      await waitFor(() => {
        expect(firstStep()).toMatchObject({ options: { sigma: 9 } })
      })

      const restored = documentView([blur])
      useAppStore.getState().confirmDocument(restored, true)

      await waitFor(() => {
        expect(screen.getByLabelText('Sigma')).toHaveValue(2)
      })
    })

    it('says when the step is switched off', () => {
      showOptionsOf({ ...createSharpStep('blur'), enabled: false })

      expect(screen.getByText('This step is off.')).toBeVisible()
    })
  })

  describe('an upscale step', () => {
    it('starts from the settings it was added with', () => {
      showOptionsOf(upscaleStep())

      expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent(
        'NMKD Siax',
      )
      expect(screen.getByRole('combobox', { name: 'Scale' })).toHaveTextContent(
        '4×',
      )
      expect(
        screen.queryByRole('combobox', { name: 'Noise reduction' }),
      ).not.toBeInTheDocument()
    })

    it('saves a changed scale on the step', async () => {
      const user = userEvent.setup()
      showOptionsOf(upscaleStep())

      await user.click(screen.getByRole('combobox', { name: 'Scale' }))
      await user.click(screen.getByRole('option', { name: '2×' }))

      await waitFor(() => {
        expect(firstStep()).toMatchObject({ settings: { scale: 2 } })
      })
    })

    it('offers noise reduction for a model that has it', async () => {
      const user = userEvent.setup()
      showOptionsOf(upscaleStep())

      await user.click(screen.getByRole('combobox', { name: 'Model' }))
      await user.click(screen.getByRole('option', { name: 'Waifu2x CUnet' }))

      expect(
        screen.getByRole('combobox', { name: 'Noise reduction' }),
      ).toBeInTheDocument()
      await waitFor(() => {
        expect(firstStep()).toMatchObject({
          settings: { model: 'waifu', scale: 4, noise: 0 },
        })
      })
    })

    it('lists recently chosen models first', async () => {
      const user = userEvent.setup()
      showOptionsOf(upscaleStep())

      await user.click(screen.getByRole('combobox', { name: 'Model' }))
      await user.click(screen.getByRole('option', { name: 'Waifu2x CUnet' }))
      await user.click(screen.getByRole('combobox', { name: 'Model' }))

      const first = screen.getAllByRole('group').at(0) ?? document.body
      expect(first).toHaveAccessibleName('Recent')
      expect(
        within(first)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Waifu2x CUnet'])
    })

    it('sets the number of passes and test-time augmentation', async () => {
      const user = userEvent.setup()
      showOptionsOf(upscaleStep())

      screen.getByRole('slider', { name: 'Passes' }).focus()
      await user.keyboard('{ArrowRight}')
      await user.click(
        screen.getByRole('switch', { name: 'Test-time augmentation' }),
      )

      await waitFor(() => {
        expect(firstStep()).toMatchObject({
          settings: { iterations: 2, tta: true },
        })
      })
    })

    it('offers Run while the step has no result, and runs the pending steps', async () => {
      const step = upscaleStep()
      vi.mocked(requestAiStep).mockResolvedValue({
        id: 'job-1',
        kind: 'ai-step',
      } as never)
      vi.mocked(followJob).mockResolvedValue(undefined)
      const user = userEvent.setup()
      showOptionsOf(step)
      useAppStore.getState().setPreview(DOCUMENT_ID, {
        status: PreviewStatus.Ready,
        key: 'k',
        pendingStepIds: [step.id],
        problems: [],
      })

      await user.click(await screen.findByRole('button', { name: 'Run' }))

      expect(requestAiStep).toHaveBeenCalledWith({
        data: { documentId: DOCUMENT_ID, stepId: step.id },
      })
    })

    it('says the step has run, with no Run, once it has a result', async () => {
      showOptionsOf(upscaleStep())
      useAppStore.getState().setPreview(DOCUMENT_ID, {
        status: PreviewStatus.Ready,
        key: 'k',
        pendingStepIds: [],
        problems: [],
      })

      expect(await screen.findByText('This step has run.')).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Run' }),
      ).not.toBeInTheDocument()
    })
  })
})
