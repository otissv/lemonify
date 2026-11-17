import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
} from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import {
  outputSummary,
  stepLabel,
  stepSummary,
} from '@/features/workflows/workflow-steps'
import { inputsSummary } from '@/features/workflows/workflow-steps'
import type { Workflow } from '@/features/workflows/workflow'
import {
  CANVAS_SELECTION,
  INPUTS_SELECTION,
  OUTPUT_SELECTION,
  stepSelection,
} from '@/features/workflows/workflow-selection'
import type { Selection } from '@/features/workflows/workflow-selection'
import { cn } from '@/lib/utils'

interface WorkflowStepListProps {
  workflow: Workflow
  selection: Selection
  onSelect: (selection: Selection) => void
  onEnabledChange: (stepId: string, enabled: boolean) => void
  onMove: (stepId: string, delta: -1 | 1) => void
  onRemove: (stepId: string) => void
  /** The file name of an image, for the layers that draw one. */
  imageName: (sourceId: string) => string
}

interface FixedRowProps {
  label: string
  summary: string
  selected: boolean
  onSelect: () => void
}

function FixedRow({
  label,
  summary,
  selected,
  onSelect,
}: FixedRowProps): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={label}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-0.5 rounded-lg border bg-card px-4 py-3 text-left text-card-foreground',
          selected ? 'border-ring' : 'border-border',
        )}
      >
        <span className="text-label-md">{label}</span>
        <span className="truncate text-caption text-muted-foreground">
          {summary}
        </span>
      </button>
    </li>
  )
}

interface StepRowProps {
  step: PipelineStep
  indented: boolean
  selected: boolean
  summary: string
  onSelect: (selection: Selection) => void
  onEnabledChange: (stepId: string, enabled: boolean) => void
  onMove: (stepId: string, delta: -1 | 1) => void
  onRemove: (stepId: string) => void
}

function StepRow({
  step,
  indented,
  selected,
  summary,
  onSelect,
  onEnabledChange,
  onMove,
  onRemove,
}: StepRowProps): React.JSX.Element {
  const label = stepLabel(step)

  function handleSelect(): void {
    onSelect(stepSelection(step.id))
  }

  function handleEnabled(enabled: boolean): void {
    onEnabledChange(step.id, enabled)
  }

  function handleUp(): void {
    onMove(step.id, -1)
  }

  function handleDown(): void {
    onMove(step.id, 1)
  }

  function handleRemove(): void {
    onRemove(step.id)
  }

  return (
    <li
      className={cn(
        'flex items-center gap-1 rounded-lg border bg-card px-2 py-1.5 text-card-foreground',
        indented && 'ml-6',
        selected ? 'border-ring' : 'border-border',
        !step.enabled && 'opacity-60',
      )}
    >
      <Switch
        size="sm"
        checked={step.enabled}
        aria-label={`${label} on`}
        onCheckedChange={handleEnabled}
      />
      <button
        type="button"
        aria-pressed={selected}
        aria-label={label}
        onClick={handleSelect}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 text-left"
      >
        <span className="text-label-md">{label}</span>
        <span className="truncate text-caption text-muted-foreground">
          {summary}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} earlier`}
        title="Move earlier"
        onClick={handleUp}
      >
        <RiArrowUpLine aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} later`}
        title="Move later"
        onClick={handleDown}
      >
        <RiArrowDownLine aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${label}`}
        title="Remove step"
        onClick={handleRemove}
      >
        <RiDeleteBinLine aria-hidden="true" />
      </Button>
    </li>
  )
}

function canvasSummary({ pipeline }: Workflow): string {
  const { width, height, background } = pipeline.canvas
  return `${width} × ${height} px · ${background}`
}

/** The workflow, top to bottom in the order it runs: its canvas, the steps drawn on it (an image layer with no image is where each input image goes), and the Output. */
export function WorkflowStepList({
  workflow,
  selection,
  onSelect,
  onEnabledChange,
  onMove,
  onRemove,
  imageName,
}: WorkflowStepListProps): React.JSX.Element {
  const rows: Array<{ step: PipelineStep; indented: boolean }> = []
  for (const step of workflow.pipeline.steps) {
    rows.push({ step, indented: false })
    if (step.kind !== PipelineStepKind.Group) continue
    for (const inner of step.steps) rows.push({ step: inner, indented: true })
  }

  function handleCanvas(): void {
    onSelect(CANVAS_SELECTION)
  }

  function handleInputs(): void {
    onSelect(INPUTS_SELECTION)
  }

  function handleOutput(): void {
    onSelect(OUTPUT_SELECTION)
  }

  return (
    <section
      aria-label="Workflow steps"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
    >
      <ol className="mx-auto flex w-full max-w-xl flex-col gap-2">
        <FixedRow
          label="Canvas"
          summary={canvasSummary(workflow)}
          selected={selection.kind === 'canvas'}
          onSelect={handleCanvas}
        />
        <FixedRow
          label="Input images"
          summary={inputsSummary(workflow.inputs.length)}
          selected={selection.kind === 'inputs'}
          onSelect={handleInputs}
        />
        {rows.map(({ step, indented }) => (
          <StepRow
            key={step.id}
            step={step}
            indented={indented}
            selected={selection.kind === 'step' && selection.id === step.id}
            summary={stepSummary(step, imageName)}
            onSelect={onSelect}
            onEnabledChange={onEnabledChange}
            onMove={onMove}
            onRemove={onRemove}
          />
        ))}
        <FixedRow
          label="Output"
          summary={outputSummary(workflow.output)}
          selected={selection.kind === 'output'}
          onSelect={handleOutput}
        />
      </ol>
    </section>
  )
}
