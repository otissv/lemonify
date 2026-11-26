import { Button } from '@/components/ui/button'
import type { SourceSummary } from '@/features/documents/document'
import { useLayerNames } from '@/features/documents/item-names'
import { sourceImageUrl } from '@/features/documents/image-urls'
import { layerSettingsOf } from '@/features/pipeline/layer'
import type { LayerSettings } from '@/features/pipeline/layer'
import {
  DOCUMENT_LAYER_KIND,
  IMAGE_LAYER_KIND,
  WORKFLOW_LAYER_KIND,
  layerKind,
} from '@/features/pipeline/layer-kinds'
import type {
  DocumentLayerStep,
  ImageLayerStep,
  LayerNames,
  LayerStep,
  WorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  setLayerSettings,
  setStepImage,
} from '@/features/pipeline/pipeline-actions'
import { useStepDraft } from '@/features/pipeline/use-step-draft'
import { LayerSettingsForm } from '@/features/tools/layer-settings-form'
import {
  ConvertToEmbedded,
  OpenUsedItem,
  UsedItemSummary,
} from '@/features/tools/used-item'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import { formatSize } from '@/lib/format-size'

const DOCUMENT_GONE = 'Document not available'
const WORKFLOW_GONE = 'Workflow not available'

interface KindOptionsProps<Step extends LayerStep> {
  documentId: string
  step: Step
  /** The images the document's layers use, to find the one this layer draws. */
  sources: ReadonlyArray<SourceSummary>
  names: LayerNames
}

/** "1267 × 704 px · PNG · 749.4 KB". */
function imageMeta(source: SourceSummary): string {
  const type =
    source.mediaType.split('/').at(1)?.toUpperCase() ?? source.mediaType
  return `${source.width} × ${source.height} px · ${type} · ${formatSize(source.bytes)}`
}

interface LayerImageProps {
  documentId: string
  stepId: string
  sourceId: string | undefined
  sources: ReadonlyArray<SourceSummary>
  /** What to say while the layer has no image. */
  empty: string
}

/** The image a layer draws, or that it has none, with ways to choose, replace or remove it. */
function LayerImage({
  documentId,
  stepId,
  sourceId,
  sources,
  empty,
}: LayerImageProps): React.JSX.Element {
  const source = sources.find(({ id }) => id === sourceId)

  function handlePick(pickedId: string): void {
    setStepImage(documentId, stepId, pickedId)
  }

  function handleRemove(): void {
    setStepImage(documentId, stepId, null)
  }

  return (
    <>
      {sourceId === undefined ? (
        <p className="text-body-md text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex items-center gap-3">
          <img
            src={sourceImageUrl(sourceId)}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-sm bg-muted object-cover"
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-body-md">
              {source?.fileName ?? 'Image not available'}
            </span>
            {source && (
              <span className="text-caption text-muted-foreground">
                {imageMeta(source)}
              </span>
            )}
          </div>
        </div>
      )}
      <ImagePicker
        label="image"
        uploadLabel={
          sourceId === undefined ? 'Choose image…' : 'Replace image…'
        }
        onPick={handlePick}
      />
      {sourceId !== undefined && (
        <Button variant="secondary" size="sm" onClick={handleRemove}>
          Remove image
        </Button>
      )}
    </>
  )
}

function ImageLayerOptions({
  documentId,
  step,
  sources,
}: KindOptionsProps<ImageLayerStep>): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-4">
      <LayerImage
        documentId={documentId}
        stepId={step.id}
        sourceId={step.sourceId}
        sources={sources}
        empty="This layer has no image yet. It keeps its settings and draws nothing until it has one."
      />
    </div>
  )
}

function DocumentLayerOptions({
  documentId,
  step,
  names,
}: KindOptionsProps<DocumentLayerStep>): React.JSX.Element {
  const name = names.document(step.documentId)
  const used = layerKind(step).uses(step)

  return (
    <div className="flex flex-col gap-3 p-4">
      <UsedItemSummary
        name={name}
        missing={DOCUMENT_GONE}
        action={
          used !== undefined &&
          name !== undefined && <OpenUsedItem item={used} name={name} />
        }
      >
        <p className="text-caption text-muted-foreground">
          Draws the document at its own canvas size, as it is now. It changes
          when the document does.
        </p>
      </UsedItemSummary>
      <ConvertToEmbedded itemId={documentId} stepId={step.id} />
    </div>
  )
}

function WorkflowLayerOptions({
  documentId,
  step,
  sources,
  names,
}: KindOptionsProps<WorkflowLayerStep>): React.JSX.Element {
  const name = names.workflow(step.workflowId)
  const used = layerKind(step).uses(step)

  return (
    <div className="flex flex-col gap-3 p-4">
      <UsedItemSummary
        name={name}
        missing={WORKFLOW_GONE}
        action={
          used !== undefined &&
          name !== undefined && <OpenUsedItem item={used} name={name} />
        }
      >
        <p className="text-caption text-muted-foreground">
          Draws the workflow on the image in its input slot, at the size its
          canvas gives. It changes when the workflow does.
        </p>
      </UsedItemSummary>
      <ConvertToEmbedded itemId={documentId} stepId={step.id} />
      <LayerImage
        documentId={documentId}
        stepId={step.id}
        sourceId={step.sourceId}
        sources={sources}
        empty="This layer has no image in its input slot yet, so the workflow draws without one."
      />
    </div>
  )
}

/** What each kind of layer shows in the options panel, above the settings every layer shares. */
function KindOptions(props: KindOptionsProps<LayerStep>): React.JSX.Element {
  const { step } = props
  switch (step.kind) {
    case IMAGE_LAYER_KIND:
      return <ImageLayerOptions {...props} step={step} />
    case DOCUMENT_LAYER_KIND:
      return <DocumentLayerOptions {...props} step={step} />
    case WORKFLOW_LAYER_KIND:
      return <WorkflowLayerOptions {...props} step={step} />
  }
}

interface LayerStepOptionsProps {
  documentId: string
  step: LayerStep
  sources: ReadonlyArray<SourceSummary>
}

/** The options of a layer: what its kind adds, then where and how it is placed. */
export function LayerStepOptions({
  documentId,
  step,
  sources,
}: LayerStepOptionsProps): React.JSX.Element {
  const stepId = step.id
  const names = useLayerNames(sources)
  const { draft, change, flush } = useStepDraft<LayerSettings>(
    layerSettingsOf(step),
    (settings) => {
      setLayerSettings(documentId, stepId, settings)
    },
  )

  return (
    <>
      <KindOptions
        documentId={documentId}
        step={step}
        sources={sources}
        names={names}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them */}
      <div onBlur={flush}>
        <LayerSettingsForm settings={draft} onChange={change} />
      </div>
    </>
  )
}
