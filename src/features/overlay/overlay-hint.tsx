import { OptionSelect } from '@/features/tools/blend-controls'
import {
  OVERLAY_GUIDE_LABELS,
  OverlayGuide,
} from '@/features/overlay/grid-guides'
import { useUiStore } from '@/store/ui-store'
import { StepViewPart } from '@/features/overlay/step-view'
import { waitsForEarlierAi } from '@/features/overlay/overlay-state'
import { overlayToolFor } from '@/features/overlay/overlay-tools'
import type { SharpStep } from '@/features/pipeline/pipeline'
import { usePreview } from '@/features/pipeline/use-preview'

const RESULT =
  'This is the picture the step leaves. Choose its Edit picture in the sidebar to change the region.'

const WAITING =
  'Run the AI steps before this one to draw on the picture. Until then, type the numbers.'

interface OverlayHintProps {
  documentId: string
  step: SharpStep
}

/** How to use the tool that draws on the picture for a step, or why it is not there yet. Nothing for a step no tool draws on. */
export function OverlayHint({
  documentId,
  step,
}: OverlayHintProps): React.JSX.Element | null {
  const preview = usePreview(documentId)
  const part = useUiStore((state) => state.stepViews[documentId])
  const guide = useUiStore((state) => state.overlayGuide)
  const setGuide = useUiStore((state) => state.setOverlayGuide)
  const tool = overlayToolFor(step)
  if (!tool || !preview) return null
  const result = part === StepViewPart.Result
  let text = tool.hint
  if (result) text = RESULT
  else if (waitsForEarlierAi(preview, step.id)) text = WAITING
  return (
    <div className="flex flex-col gap-3 px-4 pt-3">
      <p className="text-caption text-muted-foreground">{text}</p>
      {tool.guides && !result && (
        <OptionSelect
          label="Guide"
          value={guide}
          labels={OVERLAY_GUIDE_LABELS}
          options={Object.values(OverlayGuide)}
          onChange={setGuide}
        />
      )}
    </div>
  )
}
