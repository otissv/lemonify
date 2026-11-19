import { Suspense } from 'react'

import { OverlayContext } from '@/features/overlay/overlay-context'
import { waitsForEarlierAi } from '@/features/overlay/overlay-state'
import { overlayToolFor } from '@/features/overlay/overlay-tools'
import { PipelineStepKind, findStep } from '@/features/pipeline/pipeline'
import { usePreview } from '@/features/pipeline/use-preview'
import { useViewport } from '@/features/viewport/use-viewport'
import { fitSize } from '@/features/viewport/viewport'
import { useUiStore } from '@/store/ui-store'

interface OverlayLayerProps {
  documentId: string
}

/**
 * The layer over the picture that a tool draws its controls on, for the step
 * selected in the sidebar. It is placed inside the canvas, so it moves and
 * zooms with the picture and a position is a share of it. It stays out of the
 * way until it can be right: the picture shown must be the one the step acts
 * on, its size must be known, and no AI step ahead of the step may be waiting,
 * since until it runs the step's picture is not the one it will get.
 */
export function OverlayLayer({
  documentId,
}: OverlayLayerProps): React.JSX.Element | null {
  const preview = usePreview(documentId)
  const selectedId = useUiStore((state) => state.selectedSteps[documentId])
  const showOriginal = useUiStore(
    (state) => state.showOriginal[documentId] ?? false,
  )
  const { viewport, frame } = useViewport(documentId)

  if (!preview || !frame || showOriginal || selectedId === undefined) {
    return null
  }
  const step = findStep(preview.pipeline, selectedId)?.step
  if (step?.kind !== PipelineStepKind.Sharp) return null
  const tool = overlayToolFor(step)
  const { size } = preview
  if (!tool || !size || preview.beforeStepId !== step.id) return null

  if (waitsForEarlierAi(preview, step.id)) return null

  const scale = (fitSize(frame).width * viewport.zoom) / size.width
  if (!Number.isFinite(scale) || scale <= 0) return null
  return (
    <OverlayContext value={{ size, scale }}>
      <div
        data-slot="overlay"
        className="pointer-events-none absolute inset-0"
        style={{ '--inverse-zoom': 1 / viewport.zoom } as React.CSSProperties}
      >
        <Suspense fallback={null}>
          <tool.Component documentId={documentId} step={step} />
        </Suspense>
      </div>
    </OverlayContext>
  )
}
