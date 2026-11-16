import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiImageLine,
} from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { aiStepSummary } from '@/features/ai/ai-defaults'
import type { AiRun } from '@/features/documents/document-render'
import { cancelAiRun } from '@/features/documents/document-render-sync'
import {
  DEFAULT_LAYER_SETTINGS,
  MAX_LAYER_OPACITY,
} from '@/features/pipeline/layer'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { LayerStep, PipelineStep } from '@/features/pipeline/pipeline'
import {
  pipelineStepTitle,
  stepProblem,
} from '@/features/pipeline/step-problems'
import { cn } from '@/lib/utils'
import { JobState } from '@/server/jobs/job-types'

const PERCENT = 100
/** The document's image is the first step, so no other step can go below it. */
const LOWEST_MOVABLE_POSITION = 1

export interface StepRowProps {
  documentId: string
  step: PipelineStep
  /** Where the step is in the pipeline: 0 is the document's image, and later steps are drawn on top of earlier ones. */
  position: number
  count: number
  selected: boolean
  dragging: boolean
  thumbnail: string | undefined
  /** The server has no result for this AI step yet. */
  outOfDate: boolean
  /** For the document's image and layers: the file name of the image. */
  sourceName: string | undefined
  /** Why the server left this step out of the picture, if it did. */
  skipped: string | undefined
  run: AiRun | undefined
  onSelect: (stepId: string) => void
  onToggle: (stepId: string, isOn: boolean) => void
  onDelete: (stepId: string) => void
  onMove: (stepId: string, index: number) => void
}

interface StepStatus {
  text: string
  problem: boolean
  /** Whether Cancel is offered. */
  running: boolean
}

function runStatus(run: AiRun): StepStatus {
  if (run.state === JobState.Failed) {
    return { text: run.error ?? 'It failed.', problem: true, running: false }
  }
  if (run.state === JobState.Running) {
    const percent = Math.round(run.progress * PERCENT)
    return { text: `Running ${percent}%`, problem: false, running: true }
  }
  return { text: 'Waiting to run', problem: false, running: true }
}

/** "logo.png · 50% · multiply": the layer's image and what differs from the defaults. */
function layerSummary(step: LayerStep, sourceName: string | undefined): string {
  const parts = [sourceName ?? 'Image not available']
  if (step.opacity !== MAX_LAYER_OPACITY) parts.push(`${step.opacity}%`)
  if (step.blend !== DEFAULT_LAYER_SETTINGS.blend) parts.push(step.blend)
  return parts.join(' · ')
}

function statusOf(
  step: PipelineStep,
  sourceName: string | undefined,
  outOfDate: boolean,
  skipped: string | undefined,
  run: AiRun | undefined,
): StepStatus {
  const problem = stepProblem(step) ?? skipped
  if (problem !== undefined)
    return { text: problem, problem: true, running: false }
  if (step.kind === PipelineStepKind.Source) {
    return {
      text: sourceName ?? 'Image not available',
      problem: sourceName === undefined,
      running: false,
    }
  }
  if (step.kind === PipelineStepKind.Layer) {
    return {
      text: layerSummary(step, sourceName),
      problem: sourceName === undefined,
      running: false,
    }
  }
  if (step.kind === PipelineStepKind.Sharp) {
    const count = Object.keys(step.options).length
    const text =
      count === 0
        ? 'Default options'
        : `${count} ${count === 1 ? 'option' : 'options'} set`
    return { text, problem: false, running: false }
  }
  if (run?.stepId === step.id) return runStatus(run)
  if (outOfDate) return { text: 'Not run yet', problem: false, running: false }
  return { text: aiStepSummary(step), problem: false, running: false }
}

/** One step of a document's pipeline in the sidebar: select it, switch it off, move or delete it. */
export function StepRow({
  documentId,
  step,
  position,
  count,
  selected,
  dragging,
  thumbnail,
  sourceName,
  outOfDate,
  skipped,
  run,
  onSelect,
  onToggle,
  onDelete,
  onMove,
}: StepRowProps): React.JSX.Element {
  const label = pipelineStepTitle(step)
  const isImage = step.kind === PipelineStepKind.Source
  const status = statusOf(step, sourceName, outOfDate, skipped, run)

  function handleSelect(): void {
    onSelect(step.id)
  }

  function handleToggle(): void {
    onToggle(step.id, !step.enabled)
  }

  function handleDelete(): void {
    onDelete(step.id)
  }

  function handleMoveUp(): void {
    onMove(step.id, position + 1)
  }

  function handleMoveDown(): void {
    onMove(step.id, position - 1)
  }

  function handleCancel(): void {
    void cancelAiRun(documentId)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md p-1',
        selected && 'bg-accent',
        dragging && 'opacity-50',
        !step.enabled && 'opacity-60',
      )}
    >
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        aria-label={label}
        className="flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={handleSelect}
      >
        {thumbnail ? (
          <img
            data-slot="step-thumbnail"
            src={thumbnail}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-sm bg-muted object-cover"
          />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <RiImageLine aria-hidden="true" className="size-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span data-slot="step-name" className="truncate text-body-md">
            {label}
          </span>
          <span
            className={cn(
              'truncate text-caption',
              status.problem ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {status.text}
          </span>
        </span>
      </button>
      <div className="flex items-center justify-end gap-1">
        {status.running && (
          <Button
            variant="secondary"
            size="xs"
            aria-label={`Cancel ${label}`}
            onClick={handleCancel}
          >
            Cancel
          </Button>
        )}
        {!isImage && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${step.enabled ? 'Hide' : 'Show'} ${label}`}
              title={step.enabled ? 'Hide this step' : 'Show this step'}
              onClick={handleToggle}
            >
              {step.enabled ? (
                <RiEyeLine aria-hidden="true" className="size-4" />
              ) : (
                <RiEyeOffLine aria-hidden="true" className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${label} up`}
              disabled={position === count - 1}
              onClick={handleMoveUp}
            >
              <RiArrowUpLine aria-hidden="true" className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${label} down`}
              disabled={position <= LOWEST_MOVABLE_POSITION}
              onClick={handleMoveDown}
            >
              <RiArrowDownLine aria-hidden="true" className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${label}`}
              onClick={handleDelete}
            >
              <RiDeleteBinLine aria-hidden="true" className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
