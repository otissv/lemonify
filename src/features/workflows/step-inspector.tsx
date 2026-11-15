import { RiDeleteBinLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { AiToolId } from '@/features/ai/ai-tools'
import type { AiContent } from '@/features/ai/ai-tools'
import type { UpscaleSettings } from '@/features/upscale/upscale-settings'
import { UpscaleSettingsForm } from '@/features/upscale/upscale-settings-form'
import { catalogueOf } from '@/features/workflows/ai-tool-entries'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import { InputSourcesPanel } from '@/features/workflows/input-sources-panel'
import { OutputPanel } from '@/features/workflows/output-panel'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { SharpOptionsForm } from '@/features/workflows/sharp-options-form'
import { WorkflowNodeKind } from '@/features/workflows/workflow-graph'
import type { AiNode, WorkflowNode } from '@/features/workflows/workflow-graph'
import { stepLabel } from '@/features/workflows/workflow-steps'

type Options = Extract<
  WorkflowNode,
  { kind: WorkflowNodeKind.Sharp }
>['options']

interface StepInspectorProps {
  step: WorkflowNode | undefined
  aiTools: ReadonlyArray<AiToolEntry>
  onOptionsChange: (id: string, options: Options) => void
  onSettingsChange: (id: string, content: AiContent<AiNode>) => void
  onRemove: (id: string) => void
  onAddSources: (sourceIds: ReadonlyArray<string>) => void
  onRemoveSource: (sourceId: string) => void
  onOutputChange: (settings: OutputSettings) => void
  /** An image name to show how results are named. */
  sampleName: string
}

function StepOptions({
  step,
  aiTools,
  onOptionsChange,
  onSettingsChange,
  onAddSources,
  onRemoveSource,
  onOutputChange,
  sampleName,
}: Omit<StepInspectorProps, 'step' | 'onRemove'> & {
  step: WorkflowNode
}): React.JSX.Element {
  function handleOptionsChange(options: Options): void {
    onOptionsChange(step.id, options)
  }

  function handleSettingsChange(content: AiContent<AiNode>): void {
    onSettingsChange(step.id, content)
  }

  switch (step.kind) {
    case WorkflowNodeKind.Sharp:
      return (
        <SharpOptionsForm
          op={step.op}
          options={step.options}
          onChange={handleOptionsChange}
        />
      )
    case 'ai':
      return (
        <AiSettingsForm
          step={step}
          aiTools={aiTools}
          onChange={handleSettingsChange}
        />
      )
    case WorkflowNodeKind.Input:
      return (
        <InputSourcesPanel
          sourceIds={step.sourceIds}
          onAdd={onAddSources}
          onRemove={onRemoveSource}
        />
      )
    case WorkflowNodeKind.Output:
      return (
        <OutputPanel
          settings={step.settings}
          sampleName={sampleName}
          onChange={onOutputChange}
        />
      )
  }
}

interface AiSettingsFormProps {
  step: Extract<WorkflowNode, { kind: 'ai' }>
  aiTools: ReadonlyArray<AiToolEntry>
  onChange: (content: AiContent<AiNode>) => void
}

function AiSettingsForm({
  step,
  aiTools,
  onChange,
}: AiSettingsFormProps): React.JSX.Element {
  const catalogue = catalogueOf(aiTools, step.tool)
  if (catalogue === undefined) {
    return (
      <p role="alert" className="p-4 text-body-md text-destructive">
        This tool is not available on the server.
      </p>
    )
  }
  function handleUpscaleChange(settings: UpscaleSettings): void {
    onChange({ tool: AiToolId.Upscale, settings })
  }

  switch (step.tool) {
    case AiToolId.Upscale:
      return (
        <UpscaleSettingsForm
          catalogue={catalogue}
          settings={step.settings}
          onChange={handleUpscaleChange}
        />
      )
  }
}

/** The options of the selected step. */
export function StepInspector(props: StepInspectorProps): React.JSX.Element {
  const { step, onRemove } = props
  const removable = step?.kind === WorkflowNodeKind.Sharp || step?.kind === 'ai'

  function handleRemove(): void {
    if (step) onRemove(step.id)
  }

  return (
    <section
      aria-label="Step options"
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border"
    >
      {step ? (
        <>
          <div className="flex items-center justify-between gap-2 px-4 pt-4">
            <h2 className="text-title-sm">{stepLabel(step)}</h2>
            {removable && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove step"
                title="Remove step"
                onClick={handleRemove}
              >
                <RiDeleteBinLine aria-hidden="true" />
              </Button>
            )}
          </div>
          <StepOptions key={step.id} {...props} step={step} />
        </>
      ) : (
        <p className="p-4 text-body-md text-muted-foreground">
          Select a step to see its options.
        </p>
      )}
    </section>
  )
}
