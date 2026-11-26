import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StepViewPart } from '@/features/overlay/step-view'
import { catalogueFor } from '@/features/ai/ai-defaults'
import { AiToolId } from '@/features/ai/ai-tools'
import { defaultUpscaleSettings } from '@/features/upscale/upscale-settings'
import { PreviewStatus } from '@/features/documents/document-render'
import { changeDocument } from '@/features/documents/document-functions'
import { followJob } from '@/features/jobs/follow-job'
import {
  createAiStep,
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { listSources } from '@/features/sources/source-functions'
import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'
import { requestAiStep } from '@/features/render/render-functions'
import { StepOptions } from '@/features/tools/step-options'
import {
  AI_CATALOGUES,
  DOCUMENT_ID,
  documentView,
  echoChanges,
  loadDocumentIntoEditor,
  baseLayer,
} from '@/test/document-fixtures'
import { useUiStore } from '@/store/ui-store'
import { currentPipeline, usePipelineStore } from '@/store/pipeline-store'
import { resetStores } from '@/store/reset-stores'

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
vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
}))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))

const SETTINGS = { model: 'siax', scale: 4, iterations: 1, tta: false }

function upscaleStep(): PipelineStep {
  return createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
}

function firstStep(): PipelineStep | undefined {
  return currentPipeline(usePipelineStore.getState(), DOCUMENT_ID)?.steps.at(1)
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
    resetStores()
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

  describe('the first layer', () => {
    function showOpenImage(extra: ReadonlyArray<PipelineStep> = []): void {
      const view = documentView(extra)
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      useUiStore
        .getState()
        .selectStep(DOCUMENT_ID, baseLayer(view.source.id).id)
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )
    }

    beforeEach(() => {
      useLibraryStore.setState(INITIAL_LIBRARY_STATE)
      vi.mocked(listSources).mockResolvedValue([])
    })

    it('shows its image under the heading Image layer', () => {
      showOpenImage()

      expect(screen.getByRole('heading', { name: 'Image layer' })).toBeVisible()
      expect(screen.getByText('one.png')).toBeVisible()
    })

    it('offers its settings, since it is placed on the canvas like any layer', () => {
      showOpenImage()

      expect(screen.getByRole('slider', { name: 'Opacity' })).toBeVisible()
    })

    it('lists the image’s size, type and weight, and no explanation', () => {
      showOpenImage()

      expect(screen.getByText('10 × 10 px · PNG · 100 B')).toBeVisible()
      expect(
        screen.queryByText(/first Open image step/),
      ).not.toBeInTheDocument()
    })

    it('replaces the image with one from the menu, and does not add a step', async () => {
      const other = {
        ...documentView().source,
        id: 'src-other',
        fileName: 'other.png',
      }
      vi.mocked(listSources).mockResolvedValue([other])
      const user = userEvent.setup()
      showOpenImage()

      await user.click(
        await screen.findByRole('button', {
          name: 'Choose an image for image',
        }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: 'other.png' }),
      )

      await waitFor(() => {
        expect(changeDocument).toHaveBeenCalledWith({
          data: expect.objectContaining({
            change: {
              type: 'set-image',
              stepId: baseLayer(documentView().source.id).id,
              sourceId: 'src-other',
            },
          }),
        })
      })
    })

    it('puts the list of your images on the side of the upload button, in one group', async () => {
      vi.mocked(listSources).mockResolvedValue([documentView().source])
      showOpenImage()

      const group = screen.getByRole('group', { name: 'image' })
      expect(
        within(group).getByRole('button', { name: 'Replace image…' }),
      ).toBeInTheDocument()
      expect(
        await within(group).findByRole('button', {
          name: 'Choose an image for image',
        }),
      ).toHaveAttribute('data-variant', 'secondary')
    })
  })

  describe('a step that uses a second image', () => {
    beforeEach(() => {
      useLibraryStore.setState(INITIAL_LIBRARY_STATE)
    })

    it('offers every image in the library, not only those the document uses', async () => {
      const mask = {
        ...documentView().source,
        id: 'src-mask',
        fileName: 'mask.png',
      }
      vi.mocked(listSources).mockResolvedValue([mask])
      const view = documentView()
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      const user = userEvent.setup()
      addStepAfter(DOCUMENT_ID, createSharpStep('boolean'))
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )

      await user.click(
        await screen.findByRole('button', {
          name: 'Choose an image for operand',
        }),
      )

      expect(
        await screen.findByRole('menuitem', { name: 'mask.png' }),
      ).toBeVisible()
      expect(
        screen.getByRole('menuitem', { name: 'Choose from library…' }),
      ).toBeVisible()
    })
  })

  describe('naming a step', () => {
    it('says what kind of step it is and lets it be renamed, as one change', async () => {
      const blur = createSharpStep('blur')
      const view = documentView([blur])
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      useUiStore.getState().selectStep(DOCUMENT_ID, blur.id)
      const user = userEvent.setup()
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )

      expect(screen.getByRole('heading', { name: 'Blur' })).toBeVisible()
      await user.type(
        screen.getByRole('textbox', { name: 'Name' }),
        'Soften{Enter}',
      )

      await waitFor(() => {
        expect(changeDocument).toHaveBeenCalledWith({
          data: expect.objectContaining({
            change: { type: 'rename-step', stepId: blur.id, name: 'Soften' },
          }),
        })
      })
      expect(screen.getByRole('heading', { name: 'Blur' })).toBeVisible()
    })
  })

  describe('a filter or colour step’s blend', () => {
    function showBlur(): { id: string } {
      const blur = createSharpStep('blur', { sigma: 2 })
      const view = documentView([blur])
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      useUiStore.getState().selectStep(DOCUMENT_ID, blur.id)
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )
      return blur
    }

    it('is offered under the step’s own options, and saved as one change', async () => {
      const user = userEvent.setup()
      const blur = showBlur()

      expect(screen.getByRole('heading', { name: 'Blend' })).toBeVisible()
      await user.click(screen.getByRole('combobox', { name: 'Blend mode' }))
      await user.click(screen.getByRole('option', { name: 'Multiply' }))

      await waitFor(() => {
        expect(changeDocument).toHaveBeenCalledWith({
          data: expect.objectContaining({
            change: {
              type: 'set-blend',
              stepId: blur.id,
              blend: { mode: 'multiply', opacity: 100 },
            },
          }),
        })
      })
    })

    it('is reset with the options by the one button below it, as one change', async () => {
      const user = userEvent.setup()
      const tint = {
        ...createSharpStep('tint', { colour: '#00ff00' }),
        blend: { mode: 'multiply' as const, opacity: 40 },
      }
      showOptionsOf(tint)
      const reset = screen.getByRole('button', { name: 'Reset to defaults' })
      const mode = screen.getByRole('combobox', { name: 'Blend mode' })

      expect(
        mode.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      await user.click(reset)

      expect(changeDocument).toHaveBeenCalledTimes(2)
      expect(changeDocument).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          change: { type: 'reset-step', stepId: tint.id },
        }),
      })
      expect(firstStep()).toMatchObject({ options: { colour: '#ff0000' } })
      expect(firstStep()).not.toHaveProperty('blend')
    })

    it('is not offered for a geometry step, which changes the size of the picture', () => {
      const flip = createSharpStep('flip')
      loadDocumentIntoEditor(documentView([flip]))
      useUiStore.getState().selectStep(DOCUMENT_ID, flip.id)
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )

      expect(
        screen.queryByRole('heading', { name: 'Blend' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('a layer', () => {
    beforeEach(() => {
      useLibraryStore.setState(INITIAL_LIBRARY_STATE)
      vi.mocked(listSources).mockResolvedValue([])
    })

    it('resets its placement and keeps its image', async () => {
      const user = userEvent.setup()
      showOptionsOf({
        ...createImageLayerStep('src-one'),
        opacity: 30,
        anchor: 'southeast',
      })

      await user.click(
        screen.getByRole('button', { name: 'Reset to defaults' }),
      )

      expect(firstStep()).toMatchObject({
        sourceId: 'src-one',
        opacity: 100,
        anchor: 'centre',
      })
    })

    it('shows its image and its settings under its name', () => {
      const layer = createImageLayerStep('src-mask')
      const view = documentView([layer])
      loadDocumentIntoEditor({
        ...view,
        sources: [
          view.source,
          { ...view.source, id: 'src-mask', fileName: 'mask.png' },
        ],
      })
      useUiStore.getState().selectStep(DOCUMENT_ID, layer.id)
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )

      expect(screen.getByRole('heading', { name: 'Image layer' })).toBeVisible()
      expect(screen.getByText('mask.png')).toBeVisible()
      expect(screen.getByRole('slider', { name: 'Opacity' })).toBeVisible()
      expect(screen.getByRole('combobox', { name: 'Blend mode' })).toBeVisible()
    })

    it('says an empty layer has no image, and fills it from the menu without removing anything', async () => {
      const empty = createImageLayerStep()
      const other = {
        ...documentView().source,
        id: 'src-other',
        fileName: 'other.png',
      }
      vi.mocked(listSources).mockResolvedValue([other])
      const view = documentView([empty])
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      useUiStore.getState().selectStep(DOCUMENT_ID, empty.id)
      const user = userEvent.setup()
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )

      expect(screen.getByText(/has no image yet/)).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Remove image' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('slider', { name: 'Opacity' })).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Choose image…' }),
      ).toBeVisible()

      await user.click(
        await screen.findByRole('button', {
          name: 'Choose an image for image',
        }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: 'other.png' }),
      )

      await waitFor(() => {
        expect(changeDocument).toHaveBeenCalledWith({
          data: expect.objectContaining({
            change: {
              type: 'set-image',
              stepId: empty.id,
              sourceId: 'src-other',
            },
          }),
        })
      })
    })

    it('takes the image away from a layer and keeps its settings', async () => {
      const layer = { ...createImageLayerStep('src-mask'), opacity: 40 }
      const view = documentView([layer])
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      useUiStore.getState().selectStep(DOCUMENT_ID, layer.id)
      const user = userEvent.setup()
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )

      await user.click(screen.getByRole('button', { name: 'Remove image' }))

      await waitFor(() => {
        expect(changeDocument).toHaveBeenCalledWith({
          data: expect.objectContaining({
            change: { type: 'set-image', stepId: layer.id, sourceId: null },
          }),
        })
      })
    })

    it('saves a changed setting on the layer as one change', async () => {
      const layer = createImageLayerStep('src-mask')
      const view = documentView([layer])
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      useUiStore.getState().selectStep(DOCUMENT_ID, layer.id)
      const user = userEvent.setup()
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )

      await user.click(screen.getByRole('combobox', { name: 'Blend mode' }))
      await user.click(screen.getByRole('option', { name: 'Multiply' }))

      await waitFor(() => {
        expect(changeDocument).toHaveBeenCalledWith({
          data: expect.objectContaining({
            change: {
              type: 'set-layer',
              stepId: layer.id,
              settings: expect.objectContaining({ blend: 'multiply' }),
            },
          }),
        })
      })
    })
  })

  describe('a Sharp step', () => {
    it('shows the options of its tool under its name', () => {
      showOptionsOf(createSharpStep('blur'))

      expect(screen.getByRole('heading', { name: 'Blur' })).toBeVisible()
      expect(screen.getByLabelText('Sigma')).toBeVisible()
    })

    it('commits a change as one change after it settles', async () => {
      const user = userEvent.setup()
      showOptionsOf(createSharpStep('blur'))

      screen.getByRole('slider', { name: 'Sigma' }).focus()
      await user.keyboard('{ArrowRight}{ArrowRight}')

      expect(firstStep()).toMatchObject({ options: {} })
      await waitFor(() => {
        expect(firstStep()).toMatchObject({
          options: { sigma: expect.any(Number) },
        })
      })
    })

    it('commits when a field loses focus, without waiting', async () => {
      const user = userEvent.setup()
      showOptionsOf(createSharpStep('blur'))

      screen.getByRole('slider', { name: 'Sigma' }).focus()
      await user.keyboard('{ArrowRight}')
      await user.tab()

      expect(firstStep()).toMatchObject({
        options: { sigma: expect.any(Number) },
      })
    })

    it('shows what undo restores', async () => {
      const user = userEvent.setup()
      const blur = createSharpStep('blur', { sigma: 2 })
      showOptionsOf(blur)
      const slider = screen.getByRole('slider', { name: 'Sigma' })
      slider.focus()
      await user.keyboard('{ArrowRight}')
      await user.tab()
      await waitFor(() => {
        expect(firstStep()).not.toMatchObject({ options: { sigma: 2 } })
      })

      const restored = documentView([blur])
      usePipelineStore.getState().confirmDocument(restored, true)

      await waitFor(() => {
        expect(screen.getByRole('slider', { name: 'Sigma' })).toHaveAttribute(
          'aria-valuenow',
          '2',
        )
      })
    })

    it('resets its options to what a new step starts with, as one change', async () => {
      const user = userEvent.setup()
      showOptionsOf(createSharpStep('scale', { percent: 250 }))

      await user.click(
        screen.getByRole('button', { name: 'Reset to defaults' }),
      )

      expect(firstStep()).toMatchObject({ options: { percent: 100 } })
      expect(
        screen.getByRole('button', { name: 'Reset to defaults' }),
      ).toBeDisabled()
    })

    it('resets a resize to the size of the picture it acts on', async () => {
      const user = userEvent.setup()
      const resize = createSharpStep('resize', { width: 10, height: 10 })
      showOptionsOf(resize)
      act(() => {
        usePipelineStore.getState().setThumbnails(DOCUMENT_ID, [
          {
            stepId: resize.id,
            key: 'before',
            before: true,
            size: { width: 800, height: 600 },
          },
        ])
      })

      await user.click(
        screen.getByRole('button', { name: 'Reset to defaults' }),
      )

      expect(firstStep()).toMatchObject({
        options: { width: 800, height: 600 },
      })
    })

    it('offers no reset while the options are already the ones it starts with', () => {
      showOptionsOf(createSharpStep('blur'))

      expect(
        screen.getByRole('button', { name: 'Reset to defaults' }),
      ).toBeDisabled()
    })

    it('says when the step is switched off', () => {
      showOptionsOf({ ...createSharpStep('blur'), enabled: false })

      expect(screen.getByText('This step is off.')).toBeVisible()
    })
  })

  describe('a group', () => {
    it('resets the placement of an embedded document layer', async () => {
      const user = userEvent.setup()
      showOptionsOf({
        ...createEmbeddedDocumentStep([createSharpStep('blur')]),
        rotation: 45,
      })

      await user.click(
        screen.getByRole('button', { name: 'Reset to defaults' }),
      )

      expect(firstStep()).toMatchObject({
        kind: 'embedded-document',
        rotation: 0,
      })
    })

    it('offers no reset for a plain group, which has nothing to reset', () => {
      showOptionsOf(createGroupStep([createSharpStep('blur')]))

      expect(
        screen.queryByRole('button', { name: 'Reset to defaults' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('a step a tool draws on the picture for', () => {
    function showStep(
      steps: ReadonlyArray<PipelineStep>,
      selected: PipelineStep,
    ) {
      const view = documentView(steps)
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      useUiStore.getState().selectStep(DOCUMENT_ID, selected.id)
      render(
        <StepOptions documentId={DOCUMENT_ID} catalogues={AI_CATALOGUES} />,
      )
    }

    it('says how to drag the box, beside the numbers', () => {
      const extract = createSharpStep('extract')
      showStep([extract], extract)

      expect(screen.getByText(/drag the box on the picture/i)).toBeVisible()
      expect(screen.getByLabelText(/^left/i)).toBeVisible()
    })

    it('offers the guides to draw in the box, and keeps the one chosen', async () => {
      const user = userEvent.setup()
      const extract = createSharpStep('extract')
      showStep([extract], extract)

      await user.click(screen.getByRole('combobox', { name: 'Guide' }))
      await user.click(screen.getByRole('option', { name: 'Golden spiral' }))

      expect(useUiStore.getState().overlayGuide).toBe('golden-spiral')
    })

    it('says it is showing the output, and offers no guide, while the output is chosen', () => {
      const extract = createSharpStep('extract')
      showStep([extract], extract)
      act(() => {
        useUiStore.getState().setStepView(DOCUMENT_ID, StepViewPart.Output)
      })

      expect(screen.getByText(/picture the step leaves/i)).toBeVisible()
      expect(
        screen.queryByRole('combobox', { name: 'Guide' }),
      ).not.toBeInTheDocument()
    })

    it('says to run the AI steps first while one ahead of it has not run', () => {
      const extract = createSharpStep('extract')
      const ai = upscaleStep()
      usePipelineStore.getState().setPreview(DOCUMENT_ID, {
        status: PreviewStatus.Ready,
        key: 'k',
        pendingStepIds: [ai.id],
        waitingLayerIds: [],
        problems: [],
      })
      showStep([ai, extract], extract)

      expect(
        screen.getByText(/run the ai steps before this one/i),
      ).toBeVisible()
    })

    it('says nothing for a step no tool draws on', () => {
      const blur = createSharpStep('blur')
      showStep([blur], blur)

      expect(screen.queryByText(/drag the box/i)).not.toBeInTheDocument()
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

    it('resets its settings to the ones its catalogue starts from', async () => {
      const user = userEvent.setup()
      const catalogue = catalogueFor(AI_CATALOGUES, AiToolId.Upscale)
      if (catalogue === undefined) throw new Error('no catalogue')
      showOptionsOf(
        createAiStep({
          tool: AiToolId.Upscale,
          settings: { ...SETTINGS, scale: 2, tta: true },
        }),
      )

      await user.click(
        screen.getByRole('button', { name: 'Reset to defaults' }),
      )

      expect(firstStep()).toMatchObject({
        settings: JSON.parse(JSON.stringify(defaultUpscaleSettings(catalogue))),
      })
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
      usePipelineStore.getState().setPreview(DOCUMENT_ID, {
        status: PreviewStatus.Ready,
        key: 'k',
        pendingStepIds: [step.id],
        waitingLayerIds: [],
        problems: [],
      })

      await user.click(await screen.findByRole('button', { name: 'Run' }))

      expect(requestAiStep).toHaveBeenCalledWith({
        data: { documentId: DOCUMENT_ID, stepId: step.id },
      })
    })

    it('says the step has run, with no Run, once it has a result', async () => {
      showOptionsOf(upscaleStep())
      usePipelineStore.getState().setPreview(DOCUMENT_ID, {
        status: PreviewStatus.Ready,
        key: 'k',
        pendingStepIds: [],
        waitingLayerIds: [],
        problems: [],
      })

      expect(await screen.findByText('This step has run.')).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Run' }),
      ).not.toBeInTheDocument()
    })
  })
})
