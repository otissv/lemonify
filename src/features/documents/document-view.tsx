import { useState } from 'react'

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
          No image is open. Open one from the File menu.
        </p>
      </div>
    )
  }
  return (
    <Canvas
      key={url}
      url={url}
      name={name}
      width={source.width}
      height={source.height}
    />
  )
}

interface CanvasProps {
  url: string
  name: string
  /** The size of the document's image, used until the picture itself has loaded. */
  width: number
  height: number
}

/**
 * The picture on a checkerboard that is exactly as big as the picture, so
 * transparency shows against it and nothing around the picture is mistaken
 * for part of it. The picture can be any size, since edits change it, so the
 * box takes its shape from the loaded picture.
 */
function Canvas({ url, name, width, height }: CanvasProps): React.JSX.Element {
  const [ratio, setRatio] = useState(width / height)

  function handleLoad(event: React.SyntheticEvent<HTMLImageElement>): void {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (naturalWidth > 0 && naturalHeight > 0) {
      setRatio(naturalWidth / naturalHeight)
    }
  }

  return (
    <div className="@container flex size-full items-center justify-center">
      <div
        data-slot="canvas"
        className="aspect-(--ratio) w-[min(100cqw,calc(100cqh*var(--ratio)))] bg-checkerboard"
        style={{ '--ratio': ratio } as React.CSSProperties}
      >
        <img
          src={url}
          alt={name}
          className="size-full object-contain"
          onLoad={handleLoad}
        />
      </div>
    </div>
  )
}
