import { act, fireEvent, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreviewStatus } from '@/features/documents/document-render'
import type { DocumentPreview } from '@/features/documents/document-render'
import { StepViewPart } from '@/features/overlay/step-view'
import { OverlayLayer } from '@/features/overlay/overlay-layer'
import { AiToolId } from '@/features/ai/ai-tools'
import { createAiStep, createSharpStep } from '@/features/pipeline/pipeline'
import * as actions from '@/features/pipeline/pipeline-actions'
import { usePipelineStore } from '@/store/pipeline-store'
import { resetStores } from '@/store/reset-stores'
import { useUiStore } from '@/store/ui-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

const EXTRACT = createSharpStep('extract', {
  left: 400,
  top: 200,
  width: 800,
  height: 400,
})
const BLUR = createSharpStep('blur')
const UPSCALE = createAiStep({
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 2, iterations: 1, tta: false },
})

/** A 4000 x 2000 picture shown in a 1000 x 800 window: it fits at 25%. */
const FRAME = {
  viewWidth: 1000,
  viewHeight: 800,
  pictureWidth: 4000,
  pictureHeight: 2000,
}

function ready(overrides: Partial<DocumentPreview> = {}): void {
  usePipelineStore.getState().setPreview(DOCUMENT_ID, {
    status: PreviewStatus.Ready,
    key: 'k',
    size: { width: 4000, height: 2000 },
    view: { stepId: EXTRACT.id, part: StepViewPart.Tool },
    pendingStepIds: [],
    problems: [],
    ...overrides,
  })
}

async function mount(): Promise<void> {
  render(
    <Suspense fallback={null}>
      <OverlayLayer documentId={DOCUMENT_ID} />
    </Suspense>,
  )
  await act(async () => {})
}

beforeEach(() => {
  resetStores()
  loadDocumentIntoEditor(documentView([BLUR, EXTRACT, UPSCALE]))
  useUiStore.getState().selectStep(DOCUMENT_ID, EXTRACT.id)
  useUiStore.getState().setViewFrame(DOCUMENT_ID, FRAME)
})

describe('OverlayLayer', () => {
  it('draws the tool of the selected step on the picture before it', async () => {
    ready()
    await mount()

    const box = await screen.findByTestId('overlay-box')
    expect(box.style.left).toBe('10%')
    expect(box.style.width).toBe('20%')
  })

  it("draws nothing while the result of the step is shown, only the tool's own picture has the box", async () => {
    ready({ view: { stepId: EXTRACT.id, part: StepViewPart.Output } })
    await mount()
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()
  })

  describe('an extract step that has no region yet', () => {
    const UNSET = createSharpStep('extract')

    beforeEach(() => {
      loadDocumentIntoEditor(documentView([BLUR, UNSET]))
      useUiStore.getState().selectStep(DOCUMENT_ID, UNSET.id)
    })

    it('is given the whole picture as its region, once, so its numbers are set as the box shows', async () => {
      const save = vi
        .spyOn(actions, 'setSharpOptions')
        .mockImplementation(() => {})
      ready({ view: { stepId: UNSET.id, part: StepViewPart.Tool } })
      await mount()
      await screen.findByTestId('overlay-box')

      expect(save).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith(DOCUMENT_ID, UNSET.id, {
        left: 0,
        top: 0,
        width: 4000,
        height: 2000,
      })
    })

    it('is left as it is while the picture is not the one it acts on', async () => {
      const save = vi
        .spyOn(actions, 'setSharpOptions')
        .mockImplementation(() => {})
      ready({ view: undefined })
      await mount()

      expect(save).not.toHaveBeenCalled()
    })
  })

  it('does not change a region that is already set', async () => {
    const save = vi
      .spyOn(actions, 'setSharpOptions')
      .mockImplementation(() => {})
    ready()
    await mount()
    await screen.findByTestId('overlay-box')

    expect(save).not.toHaveBeenCalled()
  })

  it('draws nothing when no step, or one without such a tool, is selected', async () => {
    ready()
    useUiStore.getState().selectStep(DOCUMENT_ID, BLUR.id)
    await mount()
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()

    act(() => useUiStore.getState().selectStep(DOCUMENT_ID, undefined))
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()
  })

  it('draws nothing until the picture shown is the one before the step', async () => {
    ready({ view: undefined })
    await mount()
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()

    act(() => ready())
    expect(await screen.findByTestId('overlay-box')).toBeInTheDocument()
  })

  it('draws nothing before the first picture, before the canvas is measured, or while comparing with the original', async () => {
    usePipelineStore.getState().setPreview(DOCUMENT_ID, {
      status: PreviewStatus.Rendering,
      pendingStepIds: [],
      problems: [],
    })
    await mount()
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()

    act(() => ready())
    expect(await screen.findByTestId('overlay-box')).toBeInTheDocument()

    act(() => useUiStore.getState().setShowOriginal(DOCUMENT_ID, true))
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()
  })

  it('draws nothing while an AI step ahead of the step has not run, since its picture is not known', async () => {
    loadDocumentIntoEditor(documentView([UPSCALE, EXTRACT]))
    ready({ pendingStepIds: [UPSCALE.id] })
    await mount()
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()
  })

  it('still draws when an AI step after the step is waiting', async () => {
    ready({ pendingStepIds: [UPSCALE.id] })
    await mount()
    expect(await screen.findByTestId('overlay-box')).toBeInTheDocument()
  })

  it('draws nothing when the picture has no size on screen, which no drag could be measured on', async () => {
    useUiStore
      .getState()
      .setViewFrame(DOCUMENT_ID, { ...FRAME, pictureWidth: 0 })
    ready()
    await mount()
    expect(screen.queryByTestId('overlay-box')).not.toBeInTheDocument()
  })

  it('turns a drag into picture pixels at the zoom the picture is shown at', async () => {
    const save = vi
      .spyOn(actions, 'setSharpOptions')
      .mockImplementation(() => {})
    ready()
    await mount()
    const move = await screen.findByRole('button', {
      name: /move extract region/i,
    })
    move.setPointerCapture = vi.fn()

    fireEvent.pointerDown(move, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(move, { pointerId: 1, clientX: 25, clientY: 0 })
    fireEvent.pointerUp(move, { pointerId: 1, clientX: 25, clientY: 0 })

    expect(save).toHaveBeenCalledWith(DOCUMENT_ID, EXTRACT.id, {
      left: 500,
      top: 200,
      width: 800,
      height: 400,
    })
  })

  it('counts a screen pixel as less of the picture the further it is zoomed in', async () => {
    const save = vi
      .spyOn(actions, 'setSharpOptions')
      .mockImplementation(() => {})
    act(() =>
      useUiStore
        .getState()
        .setViewport(DOCUMENT_ID, { zoom: 0.5, x: 0.5, y: 0.5 }),
    )
    ready()
    await mount()
    const move = await screen.findByRole('button', {
      name: /move extract region/i,
    })
    move.setPointerCapture = vi.fn()

    fireEvent.pointerDown(move, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(move, { pointerId: 1, clientX: 25, clientY: 0 })
    fireEvent.pointerUp(move, { pointerId: 1, clientX: 25, clientY: 0 })

    expect(save).toHaveBeenCalledWith(
      DOCUMENT_ID,
      EXTRACT.id,
      expect.objectContaining({ left: 450 }),
    )
  })

  it('keeps the handles one size on screen by undoing the zoom', async () => {
    act(() =>
      useUiStore
        .getState()
        .setViewport(DOCUMENT_ID, { zoom: 4, x: 0.5, y: 0.5 }),
    )
    ready()
    await mount()
    await screen.findByTestId('overlay-box')

    const layer = document.querySelector<HTMLElement>('[data-slot="overlay"]')
    expect(layer?.style.getPropertyValue('--inverse-zoom')).toBe('0.25')
  })
})
