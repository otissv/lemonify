import { Canvas } from '@/features/documents/canvas'
import { useDocument } from '@/features/documents/use-document'
import { pictureUrl } from '@/features/documents/use-shown-picture'
import { usePreview } from '@/features/pipeline/use-preview'
import { useAppStore } from '@/store/app-store'

interface DocumentViewProps {
  id: string
}

/** The image of a document: the result of its edits, or as uploaded while the person compares. */
export function DocumentView({ id }: DocumentViewProps): React.JSX.Element {
  const showOriginal = useAppStore((state) => state.showOriginal[id] ?? false)
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
  const { source } = preview
  const url = pictureUrl(preview, showOriginal)
  if (source === undefined || url === undefined) {
    return (
      <div className="flex size-full items-center justify-center">
        <p role="status" className="text-body-md text-muted-foreground">
          This document has no image. Add one from Edit › Insert image.
        </p>
      </div>
    )
  }
  return (
    <Canvas
      id={id}
      url={url}
      name={name}
      width={source.width}
      height={source.height}
    />
  )
}
