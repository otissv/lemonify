import { useDocument } from '@/features/documents/use-document'
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
  const url = showOriginal ? preview.originalUrl : preview.imageUrl
  if (source === undefined || url === undefined) {
    return (
      <div className="flex size-full items-center justify-center">
        <p role="status" className="text-body-md text-muted-foreground">
          No image is open. Switch on an Open image step, or add one from Tools.
        </p>
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={name}
      width={source.width}
      height={source.height}
      className="size-full object-contain"
    />
  )
}
