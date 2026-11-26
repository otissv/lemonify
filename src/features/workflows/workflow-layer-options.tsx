import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { layerSettingsOf } from '@/features/pipeline/layer'
import type { LayerSettings } from '@/features/pipeline/layer'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  ContainerStep,
  EmbeddedDocumentStep,
} from '@/features/pipeline/pipeline'
import { useLayerNames } from '@/features/documents/item-names'
import {
  DOCUMENT_LAYER_KIND,
  IMAGE_LAYER_KIND,
  WORKFLOW_LAYER_KIND,
  layerKind,
} from '@/features/pipeline/layer-kinds'
import type {
  DocumentLayerStep,
  ImageLayerStep,
  LayerStep,
  WorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import { useStepDraft } from '@/features/pipeline/use-step-draft'
import { LayerSettingsForm } from '@/features/tools/layer-settings-form'
import {
  ConvertToEmbedded,
  OpenUsedItem,
  UsedItemSummary,
} from '@/features/tools/used-item'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import { INPUT_SLOT_SUMMARY } from '@/features/workflows/workflow-steps'

type ChangeHandler = (change: DocumentChange) => void

interface PlacementProps {
  step: LayerStep | EmbeddedDocumentStep
  onChange: ChangeHandler
}

/** Where and how a layer or an embedded document layer is placed on the canvas. */
function Placement({ step, onChange }: PlacementProps): React.JSX.Element {
  const stepId = step.id
  const { draft, change, flush } = useStepDraft<LayerSettings>(
    layerSettingsOf(step),
    (settings) => {
      onChange({ type: 'set-layer', stepId, settings })
    },
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them
    <div onBlur={flush}>
      <LayerSettingsForm settings={draft} onChange={change} />
    </div>
  )
}

interface LayerOptionsProps {
  /** The workflow the layer is in. */
  workflowId: string
  step: LayerStep
  /** The file name of an image. */
  imageName: (sourceId: string) => string
  /** Whether this layer is the workflow's input slot: its first image layer that is on. */
  isInputSlot: boolean
  onChange: ChangeHandler
}

function layerText(
  isInputSlot: boolean,
  sourceId: string | undefined,
  imageName: (sourceId: string) => string,
): string {
  if (isInputSlot) {
    return sourceId === undefined
      ? `${INPUT_SLOT_SUMMARY}: a run draws each of the workflow's input images in this layer, its first image layer.`
      : `${INPUT_SLOT_SUMMARY}: a run draws each of the workflow's input images in this layer, its first image layer, in place of ${imageName(sourceId)}.`
  }
  return sourceId === undefined
    ? 'This layer has no image yet, so it draws nothing. Choose one to draw the same image every time, such as a logo.'
    : `This layer always draws ${imageName(sourceId)}.`
}

interface LayerImageChoiceProps {
  stepId: string
  sourceId: string | undefined
  /** What the layer does with its image, or that it has none. */
  text: string
  onChange: ChangeHandler
}

/** What a layer does with its image, and ways to choose, replace or remove it. */
function LayerImageChoice({
  stepId,
  sourceId,
  text,
  onChange,
}: LayerImageChoiceProps): React.JSX.Element {
  function handlePick(pickedId: string): void {
    onChange({ type: 'set-image', stepId, sourceId: pickedId })
  }

  function handleClear(): void {
    onChange({ type: 'set-image', stepId, sourceId: null })
  }

  return (
    <>
      <p className="text-body-md text-muted-foreground">{text}</p>
      <ImagePicker
        label="image"
        uploadLabel={
          sourceId === undefined ? 'Choose an image…' : 'Replace image…'
        }
        onPick={handlePick}
      />
      {sourceId !== undefined && (
        <Button variant="secondary" size="sm" onClick={handleClear}>
          Remove the image
        </Button>
      )}
    </>
  )
}

type KindProps<Step extends LayerStep> = Omit<LayerOptionsProps, 'step'> & {
  step: Step
}

function ImageLayerKindOptions({
  step,
  imageName,
  isInputSlot,
  onChange,
}: KindProps<ImageLayerStep>): React.JSX.Element {
  return (
    <LayerImageChoice
      stepId={step.id}
      sourceId={step.sourceId}
      text={layerText(isInputSlot, step.sourceId, imageName)}
      onChange={onChange}
    />
  )
}

function DocumentLayerKindOptions({
  workflowId,
  step,
}: KindProps<DocumentLayerStep>): React.JSX.Element {
  const name = useLayerNames(undefined).document(step.documentId)
  const used = layerKind(step).uses(step)
  return (
    <>
      <UsedItemSummary
        name={name}
        missing="Document not available"
        action={
          used !== undefined &&
          name !== undefined && <OpenUsedItem item={used} name={name} />
        }
      >
        <p className="text-caption text-muted-foreground">
          Draws the document at its own canvas size, as it is now, in every run.
        </p>
      </UsedItemSummary>
      <ConvertToEmbedded itemId={workflowId} stepId={step.id} />
    </>
  )
}

function WorkflowLayerKindOptions({
  workflowId,
  step,
  imageName,
  onChange,
}: KindProps<WorkflowLayerStep>): React.JSX.Element {
  const name = useLayerNames(undefined).workflow(step.workflowId)
  const used = layerKind(step).uses(step)
  return (
    <>
      <UsedItemSummary
        name={name}
        missing="Workflow not available"
        action={
          used !== undefined &&
          name !== undefined && <OpenUsedItem item={used} name={name} />
        }
      />
      <LayerImageChoice
        stepId={step.id}
        sourceId={step.sourceId}
        text={
          step.sourceId === undefined
            ? 'This layer has no image in its input slot yet, so the workflow draws without one.'
            : `The workflow draws on ${imageName(step.sourceId)}, at the size its canvas gives.`
        }
        onChange={onChange}
      />
      <ConvertToEmbedded itemId={workflowId} stepId={step.id} />
    </>
  )
}

/** What each kind of layer adds in a workflow. */
function KindOptions(props: LayerOptionsProps): React.JSX.Element {
  const { step } = props
  switch (step.kind) {
    case IMAGE_LAYER_KIND:
      return <ImageLayerKindOptions {...props} step={step} />
    case DOCUMENT_LAYER_KIND:
      return <DocumentLayerKindOptions {...props} step={step} />
    case WORKFLOW_LAYER_KIND:
      return <WorkflowLayerKindOptions {...props} step={step} />
  }
}

/** A layer in a workflow: what its kind adds (an image layer is the place each input image goes, or a fixed image such as a logo; a document or workflow layer draws that item), then where it is placed. */
export function WorkflowLayerOptions(
  props: LayerOptionsProps,
): React.JSX.Element {
  return (
    <>
      <div className="flex flex-col gap-3 p-4">
        <KindOptions {...props} />
      </div>
      <Placement step={props.step} onChange={props.onChange} />
    </>
  )
}

interface ContainerOptionsProps {
  step: ContainerStep
  onChange: ChangeHandler
}

/** A group or an embedded document layer in a workflow: whether it is an embedded document layer, which draws on a picture of its own, and where that picture is placed. */
export function WorkflowContainerOptions({
  step,
  onChange,
}: ContainerOptionsProps): React.JSX.Element {
  function handleEmbedded(embedded: boolean): void {
    onChange({ type: 'set-embedded', stepId: step.id, embedded })
  }

  return (
    <>
      <div className="flex items-center gap-2 p-4">
        <Switch
          id={`${step.id}-embedded-document`}
          checked={step.kind === PipelineStepKind.EmbeddedDocument}
          onCheckedChange={handleEmbedded}
        />
        <Label htmlFor={`${step.id}-embedded-document`}>
          Embedded document layer
        </Label>
      </div>
      {step.kind === PipelineStepKind.EmbeddedDocument && (
        <Placement step={step} onChange={onChange} />
      )}
    </>
  )
}
