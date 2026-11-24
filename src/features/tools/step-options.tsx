import { useCallback, useId } from 'react'

import { OverlayHint } from '@/features/overlay/overlay-hint'
import { AiRunControl } from '@/features/ai/ai-run-control'
import { catalogueFor } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { AiToolId } from '@/features/ai/ai-tools'
import type { AiCatalogue } from '@/features/ai/ai-tools'
import { isLayerStep } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind, findStep } from '@/features/pipeline/pipeline'
import type { DocumentChange } from '@/features/pipeline/document-change'
import type { AiStep, GroupStep, SharpStep } from '@/features/pipeline/pipeline'
import { layerSettingsOf } from '@/features/pipeline/layer'
import type { LayerSettings } from '@/features/pipeline/layer'
import {
  applyStepChange,
  setAiSettings,
  renameStep,
  setLayerSettings,
  setSharpOptions,
  setStepBlend,
  setSubDocument,
  ungroupSteps,
} from '@/features/pipeline/pipeline-actions'
import {
  DEFAULT_STEP_BLEND,
  supportsBlend,
} from '@/features/pipeline/step-blend'
import type { StepBlend } from '@/features/pipeline/step-blend'
import { StepResetButton } from '@/features/tools/step-reset-button'
import { StepBlendForm } from '@/features/tools/step-blend-form'
import { StepNameField } from '@/features/tools/step-name-field'
import { LayerSettingsForm } from '@/features/tools/layer-settings-form'
import { LayerStepOptions } from '@/features/tools/layer-step-options'
import { pipelineStepLabel } from '@/features/pipeline/step-problems'
import { usePreview } from '@/features/pipeline/use-preview'
import { useStepDraft } from '@/features/pipeline/use-step-draft'
import { usePictureSizeBefore } from '@/features/pipeline/use-step-thumbnails'
import { UpscaleSettingsForm } from '@/features/upscale/upscale-settings-form'
import type { UpscaleSettings } from '@/features/upscale/upscale-settings'
import { SharpOptionsForm } from '@/features/workflows/sharp-options-form'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useUiStore } from '@/store/ui-store'

interface StepOptionsProps {
  documentId: string
  catalogues: AiCatalogues
}

interface SharpStepOptionsProps {
  documentId: string
  step: SharpStep
}

interface UpscaleStepOptionsProps {
  documentId: string
  step: Extract<AiStep, { tool: AiToolId.Upscale }>
  catalogue: AiCatalogue
}

type SharpOptions = SharpStep['options']

function SharpStepOptions({
  documentId,
  step,
}: SharpStepOptionsProps): React.JSX.Element {
  const stepId = step.id
  const { draft, change, flush } = useStepDraft<SharpOptions>(
    step.options,
    (options) => {
      setSharpOptions(documentId, stepId, options)
    },
  )

  return (
    <>
      <OverlayHint documentId={documentId} step={step} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them */}
      <div onBlur={flush}>
        <SharpOptionsForm op={step.op} options={draft} onChange={change} />
      </div>
      {supportsBlend(step.op) && (
        <SharpBlendOptions documentId={documentId} step={step} />
      )}
    </>
  )
}

function SharpBlendOptions({
  documentId,
  step,
}: SharpStepOptionsProps): React.JSX.Element {
  const stepId = step.id
  const { draft, change, flush } = useStepDraft<StepBlend>(
    step.blend ?? DEFAULT_STEP_BLEND,
    (blend) => {
      setStepBlend(documentId, stepId, blend)
    },
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them
    <div onBlur={flush}>
      <StepBlendForm blend={draft} onChange={change} />
    </div>
  )
}

function UpscaleStepOptions({
  documentId,
  step,
  catalogue,
}: UpscaleStepOptionsProps): React.JSX.Element {
  const stepId = step.id
  const { draft, change, flush } = useStepDraft<UpscaleSettings>(
    step.settings,
    (settings) => {
      setAiSettings(documentId, stepId, { tool: AiToolId.Upscale, settings })
    },
  )

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them */}
      <div onBlur={flush}>
        <UpscaleSettingsForm
          catalogue={catalogue}
          settings={draft}
          onChange={change}
        />
      </div>
      <AiRunControl documentId={documentId} stepId={stepId} />
    </>
  )
}

interface GroupOptionsProps {
  documentId: string
  group: GroupStep
}

/** What a group offers: it has no options of its own, only the steps in it, whether it is a picture of its own and where that is placed, and it can be taken apart. */
function GroupStepOptions({
  documentId,
  group,
}: GroupOptionsProps): React.JSX.Element {
  const switchId = useId()
  const groupId = group.id
  const { draft, change, flush } = useStepDraft<LayerSettings>(
    layerSettingsOf(group),
    (settings) => {
      setLayerSettings(documentId, groupId, settings)
    },
  )

  function handleUngroup(): void {
    ungroupSteps(documentId, groupId)
  }

  function handleSubDocument(checked: boolean): void {
    setSubDocument(documentId, groupId, checked)
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="px-4 text-caption text-muted-foreground">
        Holds {group.steps.length} {group.steps.length === 1 ? 'step' : 'steps'}
        . Switching the group off switches off every step in it. Drag steps in
        or out in the sidebar.
      </p>
      <div className="flex items-start gap-3 px-4">
        <Switch
          id={switchId}
          checked={group.subDocument}
          onCheckedChange={handleSubDocument}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={switchId}>Own picture</Label>
          <p className="text-caption text-muted-foreground">
            It is drawn on a blank canvas of the document’s size, its steps act
            on that picture only, and the result is placed on the canvas like a
            layer.
          </p>
        </div>
      </div>
      {group.subDocument && (
        // biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them
        <div onBlur={flush}>
          <LayerSettingsForm settings={draft} onChange={change} />
        </div>
      )}
      <div className="px-4 pb-4">
        <Button variant="secondary" size="sm" onClick={handleUngroup}>
          Ungroup
        </Button>
      </div>
    </div>
  )
}

/** The options of the step selected in the sidebar. */
export function StepOptions({
  documentId,
  catalogues,
}: StepOptionsProps): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedSteps[documentId])
  const preview = usePreview(documentId)
  const step =
    preview && selectedId !== undefined
      ? findStep(preview.pipeline, selectedId)?.step
      : undefined
  const skipped = preview?.problems.find(
    ({ stepId }) => stepId === selectedId,
  )?.message
  const catalogue = catalogueFor(catalogues, AiToolId.Upscale)
  const sizeBefore = usePictureSizeBefore(documentId, selectedId)
  const handleReset = useCallback(
    (change: DocumentChange): void => {
      applyStepChange(documentId, change)
    },
    [documentId],
  )

  if (!step || !preview) {
    return (
      <p className="p-4 text-body-md text-muted-foreground">
        Select a step in the sidebar, or add one from Tools.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      <h2 className="px-4 pt-4 text-title-sm">{pipelineStepLabel(step)}</h2>
      <div className="px-4 pt-3">
        <StepNameField
          key={step.id}
          name={step.name}
          fallback={pipelineStepLabel(step)}
          onRename={(name) => {
            renameStep(documentId, step.id, name)
          }}
        />
      </div>
      {skipped !== undefined && (
        <p role="status" className="px-4 pt-2 text-caption text-destructive">
          {skipped}
        </p>
      )}
      {!step.enabled && (
        <p className="px-4 pt-2 text-caption text-muted-foreground">
          This step is off.
        </p>
      )}
      {step.kind === PipelineStepKind.Group && (
        <GroupStepOptions documentId={documentId} group={step} />
      )}
      {isLayerStep(step) && (
        <LayerStepOptions
          key={step.id}
          documentId={documentId}
          step={step}
          sources={preview.document.sources}
        />
      )}
      {step.kind === PipelineStepKind.Sharp && (
        <SharpStepOptions key={step.id} documentId={documentId} step={step} />
      )}
      {step.kind === PipelineStepKind.Ai &&
        step.tool === AiToolId.Upscale &&
        catalogue !== undefined && (
          <UpscaleStepOptions
            key={step.id}
            documentId={documentId}
            step={step}
            catalogue={catalogue}
          />
        )}
      <StepResetButton
        pipeline={preview.pipeline}
        step={step}
        catalogues={catalogues}
        size={sizeBefore}
        onReset={handleReset}
      />
    </div>
  )
}
