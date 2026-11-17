import { RiDeleteBinLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { AiToolId } from '@/features/ai/ai-tools'
import type { AiContent } from '@/features/ai/ai-tools'
import { CanvasForm } from '@/features/documents/canvas-form'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { isLayerStep } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind, findStep } from '@/features/pipeline/pipeline'
import type {
  AiStep,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import type { Canvas } from '@/features/pipeline/canvas'
import type { UpscaleSettings } from '@/features/upscale/upscale-settings'
import { UpscaleSettingsForm } from '@/features/upscale/upscale-settings-form'
import { catalogueOf } from '@/features/workflows/ai-tool-entries'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import { InputSourcesPanel } from '@/features/workflows/input-sources-panel'
import { OutputPanel } from '@/features/workflows/output-panel'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { SharpOptionsForm } from '@/features/workflows/sharp-options-form'
import type { Workflow } from '@/features/workflows/workflow'
import {
  WorkflowGroupOptions,
  WorkflowLayerOptions,
} from '@/features/workflows/workflow-layer-options'
import type { Selection } from '@/features/workflows/workflow-selection'
import { stepLabel } from '@/features/workflows/workflow-steps'

type ChangeHandler = (change: DocumentChange) => void

interface StepInspectorProps {
  workflow: Workflow
  selection: Selection
  aiTools: ReadonlyArray<AiToolEntry>
  /** Applies a change to the workflow's pipeline, as in a document. */
  onChange: ChangeHandler
  onRemove: (id: string) => void
  onAddSources: (sourceIds: ReadonlyArray<string>) => void
  onRemoveSource: (sourceId: string) => void
  onOutputChange: (settings: OutputSettings) => void
  /** The file name of an image. */
  imageName: (sourceId: string) => string
  /** An image name to show how results are named. */
  sampleName: string
}

interface AiSettingsFormProps {
  step: AiStep
  aiTools: ReadonlyArray<AiToolEntry>
  onChange: (content: AiContent<AiStep>) => void
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

interface StepOptionsProps {
  step: PipelineStep
  aiTools: ReadonlyArray<AiToolEntry>
  imageName: (sourceId: string) => string
  onChange: ChangeHandler
}

function StepOptions({
  step,
  aiTools,
  imageName,
  onChange,
}: StepOptionsProps): React.JSX.Element {
  function handleOptions(options: SharpStep['options']): void {
    onChange({ type: 'set-options', stepId: step.id, options })
  }

  function handleSettings(content: AiContent<AiStep>): void {
    onChange({ ...content, type: 'set-settings', stepId: step.id })
  }

  if (isLayerStep(step)) {
    return (
      <WorkflowLayerOptions
        step={step}
        imageName={imageName}
        onChange={onChange}
      />
    )
  }
  switch (step.kind) {
    case PipelineStepKind.Group:
      return <WorkflowGroupOptions step={step} onChange={onChange} />
    case PipelineStepKind.Sharp:
      return (
        <SharpOptionsForm
          op={step.op}
          options={step.options}
          onChange={handleOptions}
        />
      )
    case PipelineStepKind.Ai:
      return (
        <AiSettingsForm
          step={step}
          aiTools={aiTools}
          onChange={handleSettings}
        />
      )
  }
}

interface PanelProps {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}

function Panel({ title, children, action }: PanelProps): React.JSX.Element {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 className="text-title-sm">{title}</h2>
        {action}
      </div>
      {children}
    </>
  )
}

function CanvasPanel({
  canvas,
  onChange,
}: {
  canvas: Canvas
  onChange: ChangeHandler
}): React.JSX.Element {
  function handleSubmit(next: Canvas): void {
    onChange({ type: 'set-canvas', canvas: next })
  }

  return (
    <Panel title="Canvas">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-body-md text-muted-foreground">
          The picture every input image is drawn on. A run can use a canvas the
          size of each image instead.
        </p>
        <CanvasForm
          key={JSON.stringify(canvas)}
          initial={canvas}
          submitLabel="Apply canvas"
          onSubmit={handleSubmit}
        />
      </div>
    </Panel>
  )
}

function Content(props: StepInspectorProps): React.JSX.Element {
  const { workflow, selection, aiTools, imageName, onChange, onRemove } = props
  switch (selection.kind) {
    case 'none':
      return <NothingSelected />
    case 'canvas':
      return (
        <CanvasPanel canvas={workflow.pipeline.canvas} onChange={onChange} />
      )
    case 'inputs':
      return (
        <Panel title="Input images">
          <InputSourcesPanel
            sourceIds={workflow.inputs}
            onAdd={props.onAddSources}
            onRemove={props.onRemoveSource}
          />
        </Panel>
      )
    case 'output':
      return (
        <Panel title="Output">
          <OutputPanel
            settings={workflow.output}
            sampleName={props.sampleName}
            onChange={props.onOutputChange}
          />
        </Panel>
      )
    case 'step': {
      const step = findStep(workflow.pipeline, selection.id)?.step
      if (step === undefined) return <NothingSelected />
      return (
        <Panel
          title={stepLabel(step)}
          action={<RemoveButton stepId={step.id} onRemove={onRemove} />}
        >
          <StepOptions
            key={step.id}
            step={step}
            aiTools={aiTools}
            imageName={imageName}
            onChange={onChange}
          />
        </Panel>
      )
    }
  }
}

function RemoveButton({
  stepId,
  onRemove,
}: {
  stepId: string
  onRemove: (id: string) => void
}): React.JSX.Element {
  function handleRemove(): void {
    onRemove(stepId)
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remove step"
      title="Remove step"
      onClick={handleRemove}
    >
      <RiDeleteBinLine aria-hidden="true" />
    </Button>
  )
}

function NothingSelected(): React.JSX.Element {
  return (
    <p className="p-4 text-body-md text-muted-foreground">
      Select a step to see its options.
    </p>
  )
}

/** The options of whatever is selected: a step, or the canvas, input images or output of the workflow. */
export function StepInspector(props: StepInspectorProps): React.JSX.Element {
  return (
    <section
      aria-label="Step options"
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border"
    >
      <Content {...props} />
    </section>
  )
}
