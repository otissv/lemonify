import { AiRunControl } from '@/features/ai/ai-run-control'
import { catalogueFor } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { AiToolId } from '@/features/ai/ai-tools'
import type { AiCatalogue } from '@/features/ai/ai-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  AiStep,
  SharpStep,
  SourceStep,
} from '@/features/pipeline/pipeline'
import {
  setAiSettings,
  setSharpOptions,
  setStepSource,
} from '@/features/pipeline/pipeline-actions'
import { imagesOpenedBefore } from '@/features/pipeline/opened-images'
import { formatSize } from '@/lib/format-size'
import { pipelineStepLabel } from '@/features/pipeline/step-problems'
import { usePreview } from '@/features/pipeline/use-preview'
import { useStepDraft } from '@/features/pipeline/use-step-draft'
import { UpscaleSettingsForm } from '@/features/upscale/upscale-settings-form'
import type { UpscaleSettings } from '@/features/upscale/upscale-settings'
import { ImageChoicesContext } from '@/features/workflows/fields/image-choices'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import { SharpOptionsForm } from '@/features/workflows/sharp-options-form'
import { sourceImageUrl } from '@/features/documents/image-urls'
import type { SourceSummary } from '@/features/documents/document'
import { useAppStore } from '@/store/app-store'

interface StepOptionsProps {
  documentId: string
  catalogues: AiCatalogues
}

interface SharpStepOptionsProps {
  documentId: string
  step: SharpStep
  /** The images the steps before this one open: the only second images it can use. */
  images: ReadonlyArray<SourceSummary>
}

interface SourceStepOptionsProps {
  documentId: string
  step: SourceStep
  source: SourceSummary | undefined
}

interface UpscaleStepOptionsProps {
  documentId: string
  step: Extract<AiStep, { tool: AiToolId.Upscale }>
  catalogue: AiCatalogue
}

type SharpOptions = SharpStep['options']

/** "1267 × 704 px · PNG · 749.4 KB". */
function imageMeta(source: SourceSummary): string {
  const type =
    source.mediaType.split('/').at(1)?.toUpperCase() ?? source.mediaType
  return `${source.width} × ${source.height} px · ${type} · ${formatSize(source.bytes)}`
}

function SourceStepOptions({
  documentId,
  step,
  source,
}: SourceStepOptionsProps): React.JSX.Element {
  const stepId = step.id

  function handlePick(sourceId: string): void {
    setStepSource(documentId, stepId, sourceId)
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <img
          src={sourceImageUrl(step.sourceId)}
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
      <ImagePicker label="image" onPick={handlePick} />
    </div>
  )
}

function SharpStepOptions({
  documentId,
  step,
  images,
}: SharpStepOptionsProps): React.JSX.Element {
  const stepId = step.id
  const { draft, change, flush } = useStepDraft<SharpOptions>(
    step.options,
    (options) => {
      setSharpOptions(documentId, stepId, options)
    },
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them
    <div onBlur={flush}>
      <ImageChoicesContext.Provider value={images}>
        <SharpOptionsForm op={step.op} options={draft} onChange={change} />
      </ImageChoicesContext.Provider>
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

/** The options of the step selected in the sidebar. */
export function StepOptions({
  documentId,
  catalogues,
}: StepOptionsProps): React.JSX.Element {
  const selectedId = useAppStore((state) => state.selectedSteps[documentId])
  const preview = usePreview(documentId)
  const step = preview?.pipeline.steps.find(({ id }) => id === selectedId)
  const skipped = preview?.problems.find(
    ({ stepId }) => stepId === selectedId,
  )?.message
  const catalogue = catalogueFor(catalogues, AiToolId.Upscale)

  if (!step || !preview) {
    return (
      <p className="p-4 text-body-md text-muted-foreground">
        Select a step in the sidebar, or add one from Tools.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {step.kind !== PipelineStepKind.Source && (
        <h2 className="px-4 pt-4 text-title-sm">{pipelineStepLabel(step)}</h2>
      )}
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
      {step.kind === PipelineStepKind.Source && (
        <SourceStepOptions
          key={step.id}
          documentId={documentId}
          step={step}
          source={preview.document.sources.find(
            ({ id }) => id === step.sourceId,
          )}
        />
      )}
      {step.kind === PipelineStepKind.Sharp && (
        <SharpStepOptions
          key={step.id}
          documentId={documentId}
          step={step}
          images={imagesOpenedBefore(
            preview.pipeline,
            step.id,
            preview.document.sources,
          )}
        />
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
    </div>
  )
}
