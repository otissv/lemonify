import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NavigatorPanel } from '@/features/viewport/navigator-panel'
import type { ViewFrame } from '@/features/viewport/viewport'
import {
  INITIAL_APP_STATE,
  PreviewStatus,
  useAppStore,
} from '@/store/app-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

/** A square picture in a 1000 x 800 window: fitted it is 800 x 800. */
const FRAME: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  ratio: 1,
  naturalWidth: 800,
}

/** The preview is drawn 200 x 200 at the top left of the page. */
function mockPreviewBox(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function measure(this: HTMLElement) {
      return this.dataset.slot === 'navigator-preview'
        ? DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 200 })
        : DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 })
    },
  )
}

function viewport() {
  return (
    useAppStore.getState().viewports[DOCUMENT_ID] ?? {
      zoom: 1,
      x: 0.5,
      y: 0.5,
    }
  )
}

function zoomTo(zoom: number): void {
  act(() => {
    useAppStore.getState().setViewport(DOCUMENT_ID, { zoom, x: 0.5, y: 0.5 })
  })
}

function preview(): HTMLElement {
  return screen.getByRole('application', { name: 'Navigator preview' })
}

function finder(): HTMLElement {
  const element = preview().querySelector<HTMLElement>(
    '[data-slot="navigator-view"]',
  )
  if (!element) throw new Error('No view frame.')
  return element
}

function show(): void {
  loadDocumentIntoEditor(documentView())
  useAppStore.getState().setPreview(DOCUMENT_ID, {
    status: PreviewStatus.Ready,
    key: 'preview-key',
    pendingStepIds: [],
    problems: [],
  })
  useAppStore.getState().setViewFrame(DOCUMENT_ID, FRAME)
  render(<NavigatorPanel documentId={DOCUMENT_ID} />)
}

beforeEach(() => {
  useAppStore.setState(INITIAL_APP_STATE)
  mockPreviewBox()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NavigatorPanel', () => {
  it('says so when the document has nothing to show', () => {
    render(<NavigatorPanel documentId={DOCUMENT_ID} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'There is no picture to navigate.',
    )
  })

  it('shows the picture small, with the zoom control below', () => {
    show()

    expect(
      within(preview()).getByRole('img', { name: 'one.png' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Zoom' })).toHaveValue('100%')
  })

  it('frames the whole picture at fit, and only the part on the canvas once zoomed', () => {
    show()
    expect(finder().style.cssText).toContain('width: 100%')
    expect(finder().style.cssText).toContain('height: 100%')

    zoomTo(4)

    expect(finder().style.width).toBe('31.25%')
    expect(finder().style.left).toBe('34.375%')
    expect(finder().style.height).toBe('25%')
    expect(finder().style.top).toBe('37.5%')
  })

  it('moves the frame, and so the canvas, when the picture is clicked outside it', () => {
    show()
    zoomTo(4)

    fireEvent.pointerDown(preview(), { pointerId: 1, clientX: 40, clientY: 40 })

    expect(viewport().x).toBeCloseTo(0.2, 8)
    expect(viewport().y).toBeCloseTo(0.2, 8)
  })

  it('drags the frame without it jumping to the pointer', () => {
    show()
    zoomTo(4)

    fireEvent.pointerDown(preview(), {
      pointerId: 1,
      clientX: 110,
      clientY: 100,
    })
    expect(viewport().x).toBeCloseTo(0.5, 8)
    fireEvent.pointerMove(preview(), {
      pointerId: 1,
      clientX: 130,
      clientY: 120,
    })
    expect(viewport().x).toBeCloseTo(0.6, 8)
    expect(viewport().y).toBeCloseTo(0.6, 8)

    fireEvent.pointerUp(preview(), { pointerId: 1 })
    fireEvent.pointerMove(preview(), {
      pointerId: 1,
      clientX: 190,
      clientY: 190,
    })
    expect(viewport().x).toBeCloseTo(0.6, 8)
  })

  it('does not drag the frame out of the picture', () => {
    show()
    zoomTo(4)

    fireEvent.pointerDown(preview(), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(preview(), {
      pointerId: 1,
      clientX: 2000,
      clientY: -2000,
    })

    expect(viewport().x).toBeCloseTo(1 - 0.125 / 1, 1)
    expect(viewport().y).toBeCloseTo(0.125, 8)
  })

  it('zooms the canvas from its zoom control', () => {
    show()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))

    expect(viewport().zoom).toBe(1.25)
  })
})
