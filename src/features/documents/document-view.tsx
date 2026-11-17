import { Canvas } from '@/features/documents/canvas'
import { useDocument } from '@/features/documents/use-document'
import { pictureUrl } from '@/features/documents/use-shown-picture'
import { usePreview } from '@/features/pipeline/use-preview'
import { useUiStore } from '@/store/ui-store'

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
  const { canvas } = preview.pipeline
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
  return (
    <Canvas
      id={id}
      url={url}
      name={name}
      width={canvas.width}
      height={canvas.height}
    />
  )
}
