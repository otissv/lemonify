import { Button } from '@/components/ui/button'
import { catalogueFor, startingAiContent } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { planChange } from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'
import type { PictureSize } from '@/features/pipeline/canvas'
import { resetChangeFor } from '@/features/pipeline/step-reset'

interface StepResetButtonProps {
  pipeline: Pipeline
  step: PipelineStep
  catalogues: AiCatalogues
  /** The size of the picture the step acts on, when the page knows it, which a resize goes back to. */
  size?: PictureSize
  onReset: (change: DocumentChange) => void
}

/** The reset of a step, or nothing for a step with nothing to reset: a plain group, or an AI step whose tool has no catalogue here. */
function resetChangeOf(
  step: PipelineStep,
  catalogues: AiCatalogues,
  size: PictureSize | undefined,
): DocumentChange | undefined {
  if (step.kind === PipelineStepKind.Group && !step.subDocument)
    return undefined
  if (step.kind !== PipelineStepKind.Ai) return resetChangeFor(step, { size })
  const catalogue = catalogueFor(catalogues, step.tool)
  if (catalogue === undefined) return undefined
  return resetChangeFor(step, { ai: startingAiContent(step.tool, catalogue) })
}

function changesNothing(pipeline: Pipeline, change: DocumentChange): boolean {
  try {
    return planChange(pipeline, change) === null
  } catch {
    return true
  }
}

/** Puts the step back as a new one of its kind starts: options and blend, settings, or placement. Off while it already is. The page decides where the change goes. */
export function StepResetButton({
  pipeline,
  step,
  catalogues,
  size,
  onReset,
}: StepResetButtonProps): React.JSX.Element | null {
  const change = resetChangeOf(step, catalogues, size)
  if (change === undefined) return null

  function handleClick(): void {
    if (change !== undefined) onReset(change)
  }

  return (
    <div className="border-t border-border px-4 py-4">
      <Button
        variant="secondary"
        size="sm"
        disabled={changesNothing(pipeline, change)}
        title="Put this step back as a new one starts: its options, blend or placement"
        onClick={handleClick}
      >
        Reset to defaults
      </Button>
    </div>
  )
}
