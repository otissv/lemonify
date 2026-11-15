import { RiAddLine } from '@remixicon/react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import type { AiToolId, AiToolSummary } from '@/features/ai/ai-tools'
import { SHARP_OP_GROUPS, opLabel } from '@/features/workflows/sharp-op-fields'

/** What the palette adds: a Sharp operation by name, or an AI tool. */
export type PaletteChoice =
  | { kind: 'sharp'; op: string }
  | { kind: 'ai'; tool: AiToolId }

interface StepPaletteProps {
  aiTools: ReadonlyArray<AiToolSummary>
  onAdd: (choice: PaletteChoice) => void
}

interface PaletteStep {
  value: string
  label: string
  choice: PaletteChoice
}

interface PaletteItemProps {
  step: PaletteStep
  onAdd: (choice: PaletteChoice) => void
}

interface PaletteGroupProps {
  label: string
  steps: ReadonlyArray<PaletteStep>
  onAdd: (choice: PaletteChoice) => void
}

function PaletteItem({ step, onAdd }: PaletteItemProps): React.JSX.Element {
  function handleClick(): void {
    onAdd(step.choice)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Add ${step.label}`}
      className="w-full justify-start gap-2 px-2"
      onClick={handleClick}
    >
      <RiAddLine aria-hidden="true" />
      {step.label}
    </Button>
  )
}

function PaletteGroup({
  label,
  steps,
  onAdd,
}: PaletteGroupProps): React.JSX.Element {
  const headingId = useId()

  return (
    <div className="flex flex-col gap-1">
      <h3
        id={headingId}
        className="px-2 text-caption font-medium text-muted-foreground"
      >
        {label}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col">
        {steps.map((step) => (
          <li key={step.value}>
            <PaletteItem step={step} onAdd={onAdd} />
          </li>
        ))}
      </ul>
    </div>
  )
}

const SHARP_GROUPS = SHARP_OP_GROUPS.map((group) => ({
  label: group.label,
  steps: group.ops.map((op) => ({
    value: op,
    label: opLabel(op),
    choice: { kind: 'sharp', op } as const,
  })),
}))

/** The image CLI's steps, grouped as the CLI groups them. Clicking one adds it after the selected step, or at the end. */
export function StepPalette({
  aiTools,
  onAdd,
}: StepPaletteProps): React.JSX.Element {
  const aiSteps = aiTools.map(
    (tool): PaletteStep => ({
      value: tool.id,
      label: tool.label,
      choice: { kind: 'ai', tool: tool.id },
    }),
  )

  return (
    <section
      aria-label="Steps"
      className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-2"
    >
      {aiSteps.length > 0 && (
        <PaletteGroup label="AI" steps={aiSteps} onAdd={onAdd} />
      )}
      {SHARP_GROUPS.map((group) => (
        <PaletteGroup
          key={group.label}
          label={group.label}
          steps={group.steps}
          onAdd={onAdd}
        />
      ))}
    </section>
  )
}
