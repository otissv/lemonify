import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
} from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { aiStepSummary } from '@/features/ai/ai-defaults'
import type { AiRun } from '@/features/documents/document-render'
import { cancelAiRun } from '@/features/documents/document-render-sync'
import { DEFAULT_STEP_BLEND } from '@/features/pipeline/step-blend'
import type { StepBlend } from '@/features/pipeline/step-blend'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type { LeafStep } from '@/features/pipeline/pipeline'
import {
  pipelineStepTitle,
  stepProblem,
} from '@/features/pipeline/step-problems'
import { StepViewPart } from '@/features/overlay/step-view'
import {
  StepPicture,
  StepPictures,
  StepThumbnail,
} from '@/features/documents/step-pictures'
import { cn } from '@/lib/utils'
import { JobState } from '@/server/jobs/job-types'

const PERCENT = 100

/** For a step whose tool has a picture of its own: that picture's small picture, and which of the step's two pictures the canvas shows. */
export interface StepPictureChoice {
  /** Small picture of the tool's own picture. */
  tool: string | undefined
  /** The part of the step shown on the canvas now; undefined while another step is. */
  shown: StepViewPart | undefined
  onShow: (stepId: string, part: StepViewPart) => void
}

/** The keys held while a step was clicked: they extend what is picked. */
export interface SelectModifiers {
  toggle: boolean
  range: boolean
}

export interface StepRowProps {
  documentId: string
  step: LeafStep
  /** The group the step is in, when it is in one. */
  groupId?: string
  /** Picked together with other steps, to group them. */
  marked?: boolean
  /** Where the step is in the pipeline: later steps are drawn on top of earlier ones. */
  position: number
  count: number
  selected: boolean
  dragging: boolean
  thumbnail: string | undefined
  /** For a step a tool draws on the picture for: the two pictures to choose between, and which is shown. Undefined for any other step. */
  pictures?: StepPictureChoice
  /** The server has no result for this AI step yet. */
  outOfDate: boolean
  /** For a layer: the file name of its image. */
  sourceName: string | undefined
  /** Why the server left this step out of the picture, if it did. */
  skipped: string | undefined
  run: AiRun | undefined
  onSelect: (stepId: string, modifiers: SelectModifiers) => void
  onToggle: (stepId: string, isOn: boolean) => void
  onDelete: (stepId: string) => void
  onMove: (stepId: string, index: number, groupId?: string) => void
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

/** "multiply 50%": how a step's result is blended, naming only what differs from normal and 100%. */
function blendSummary(blend: StepBlend): string {
  const parts: string[] = []
  if (blend.mode !== DEFAULT_STEP_BLEND.mode) parts.push(blend.mode)
  if (blend.opacity !== DEFAULT_STEP_BLEND.opacity)
    parts.push(`${blend.opacity}%`)
  return parts.join(' ')
}

function statusOf(
  step: LeafStep,
  sourceName: string | undefined,
  outOfDate: boolean,
  skipped: string | undefined,
  run: AiRun | undefined,
): StepStatus {
  const problem = stepProblem(step) ?? skipped
  if (problem !== undefined)
    return { text: problem, problem: true, running: false }
  if (isLayerStep(step)) {
    const { text, problem } = layerKind(step).display(step, sourceName)
    return { text, problem, running: false }
  }
  if (step.kind === PipelineStepKind.Sharp) {
    const count = Object.keys(step.options).length
    const options =
      count === 0
        ? 'Default options'
        : `${count} ${count === 1 ? 'option' : 'options'} set`
    const parts = step.blend ? [options, blendSummary(step.blend)] : [options]
    return { text: parts.join(' · '), problem: false, running: false }
  }
  if (run?.stepId === step.id) return runStatus(run)
  if (outOfDate) return { text: 'Not run yet', problem: false, running: false }
  return { text: aiStepSummary(step), problem: false, running: false }
}

/** One step of a document's pipeline in the sidebar: select it, switch it off, move or delete it. */
export function StepRow({
  documentId,
  step,
  groupId,
  marked = false,
  position,
  count,
  selected,
  dragging,
  thumbnail,
  pictures,
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
  const status = statusOf(step, sourceName, outOfDate, skipped, run)

  function handleSelect(event: React.MouseEvent<HTMLButtonElement>): void {
    onSelect(step.id, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    })
  }

  function handleToolPicture(event: React.MouseEvent<HTMLButtonElement>): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      handleSelect(event)
      return
    }
    pictures?.onShow(step.id, StepViewPart.Tool)
  }

  function handleOutputPicture(): void {
    pictures?.onShow(step.id, StepViewPart.Output)
  }

  function handleToggle(): void {
    onToggle(step.id, !step.enabled)
  }

  function handleDelete(): void {
    onDelete(step.id)
  }

  function handleMoveUp(): void {
    onMove(step.id, position + 1, groupId)
  }

  function handleMoveDown(): void {
    onMove(step.id, position - 1, groupId)
  }

  function handleCancel(): void {
    void cancelAiRun(documentId)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md p-1',
        (selected || marked) && 'bg-accent',
        dragging && 'opacity-50',
        !step.enabled && 'opacity-60',
      )}
    >
      {pictures !== undefined && (
        <StepPictures label={`Pictures of ${label}`}>
          <StepPicture
            label={`Output of ${label}`}
            title="Output"
            subtitle="After this step"
            url={thumbnail}
            pressed={pictures.shown === StepViewPart.Output}
            onClick={handleOutputPicture}
          />
          <StepPicture
            label={`${label} picture`}
            title={label}
            subtitle={status.text}
            problem={status.problem}
            url={pictures.tool}
            pressed={pictures.shown === StepViewPart.Tool}
            onClick={handleToolPicture}
          />
        </StepPictures>
      )}
      {pictures === undefined && (
        <button
          type="button"
          aria-current={selected ? 'true' : undefined}
          aria-label={label}
          className="flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={handleSelect}
        >
          {pictures === undefined && <StepThumbnail url={thumbnail} />}
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
      )}
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
          disabled={position === 0}
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
      </div>
    </div>
  )
}
