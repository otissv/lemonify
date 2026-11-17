import { Button } from '@/components/ui/button'
import type { SourceSummary } from '@/features/documents/document'
import { sourceImageUrl } from '@/features/documents/image-urls'
import { layerSettingsOf } from '@/features/pipeline/layer'
import type { LayerSettings } from '@/features/pipeline/layer'
import { IMAGE_LAYER_KIND } from '@/features/pipeline/layer-kinds'
import type {
  ImageLayerStep,
  LayerStep,
  LayerStepKind,
} from '@/features/pipeline/layer-kinds'
import {
  setLayerSettings,
  setStepImage,
} from '@/features/pipeline/pipeline-actions'
import { useStepDraft } from '@/features/pipeline/use-step-draft'
import { LayerSettingsForm } from '@/features/tools/layer-settings-form'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import { formatSize } from '@/lib/format-size'

interface KindOptionsProps<Step extends LayerStep> {
  documentId: string
  step: Step
  /** The images the document's layers use, to find the one this layer draws. */
  sources: ReadonlyArray<SourceSummary>
}

/** "1267 × 704 px · PNG · 749.4 KB". */
function imageMeta(source: SourceSummary): string {
  const type =
    source.mediaType.split('/').at(1)?.toUpperCase() ?? source.mediaType
  return `${source.width} × ${source.height} px · ${type} · ${formatSize(source.bytes)}`
}

function ImageLayerOptions({
  documentId,
  step,
  sources,
}: KindOptionsProps<ImageLayerStep>): React.JSX.Element {
  const stepId = step.id
  const { sourceId } = step
  const source = sources.find(({ id }) => id === sourceId)

  function handlePick(pickedId: string): void {
    setStepImage(documentId, stepId, pickedId)
  }

  function handleRemove(): void {
    setStepImage(documentId, stepId, null)
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {sourceId === undefined ? (
        <p className="text-body-md text-muted-foreground">
          This layer has no image yet. It keeps its settings and draws nothing
          until it has one.
        </p>
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
    </div>
  )
}

/** What each kind of layer shows in the options panel, above the settings every layer shares. */
const KIND_OPTIONS: {
  [Kind in LayerStepKind]: (
    props: KindOptionsProps<Extract<LayerStep, { kind: Kind }>>,
  ) => React.JSX.Element
} = {
  [IMAGE_LAYER_KIND]: ImageLayerOptions,
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
  const { draft, change, flush } = useStepDraft<LayerSettings>(
    layerSettingsOf(step),
    (settings) => {
      setLayerSettings(documentId, stepId, settings)
    },
  )
  const KindOptions = KIND_OPTIONS[step.kind]

  return (
    <>
      <KindOptions documentId={documentId} step={step} sources={sources} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them */}
      <div onBlur={flush}>
        <LayerSettingsForm settings={draft} onChange={change} />
      </div>
    </>
  )
}
