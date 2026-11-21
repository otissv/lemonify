import { Canvas } from '@/features/documents/canvas'
import { OverlayLayer } from '@/features/overlay/overlay-layer'
import { useDocument } from '@/features/documents/use-document'
import { pictureUrl } from '@/features/documents/use-shown-picture'
import type { PictureSize } from '@/features/documents/document-render'
import { usePreview } from '@/features/pipeline/use-preview'
import type { PipelinePreview } from '@/features/pipeline/use-preview'
import { useUiStore } from '@/store/ui-store'

/** The shown picture's size in its own pixels: the original's while comparing, else the render's, else the canvas's until the first render says. */
function pictureSize(
  preview: PipelinePreview,
  showOriginal: boolean,
): PictureSize {
  if (showOriginal && preview.source) {
    return { width: preview.source.width, height: preview.source.height }
  }
  return preview.size ?? preview.pipeline.canvas
}

interface DocumentViewProps {
  id: string
}

/** The image of a document: the result of its edits, or as uploaded while the person compares. */
export function DocumentView({ id }: DocumentViewProps): React.JSX.Element {
  const showOriginal = useUiStore((state) => state.showOriginal[id] ?? false)
  const { session, loadError } = useDocument(id)
  const preview = usePreview(id)

  if (loadError !== undefined) {
    return (
      <div className="flex size-full items-center justify-center">
        <p role="alert" className="text-body-md text-destructive">
          {loadError}
        </p>
      </div>
    )
  }

  if (!session || !preview) return <div className="size-full" />

  const { name } = preview.document
  const url = pictureUrl(preview, showOriginal)
  if (url === undefined) {
    return (
      <div className="flex size-full items-center justify-center">
        <p role="status" className="text-body-md text-muted-foreground">
          Rendering…
        </p>
      </div>
    )
  }
  const size = pictureSize(preview, showOriginal)
  return (
    <Canvas
      id={id}
      url={url}
      name={name}
      width={size.width}
      height={size.height}
      overlay={<OverlayLayer documentId={id} />}
    />
  )
}
