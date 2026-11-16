import { usePreview } from '@/features/pipeline/use-preview'
import type { PipelinePreview } from '@/features/pipeline/use-preview'
import { useAppStore } from '@/store/app-store'

export interface ShownPicture {
  url: string
  name: string
}

/** The picture a person is shown, which is the original while they compare. */
export function pictureUrl(
  preview: Pick<PipelinePreview, 'imageUrl' | 'originalUrl'>,
  showOriginal: boolean,
): string | undefined {
  return showOriginal ? preview.originalUrl : preview.imageUrl
}

/** The picture the canvas shows for a document, for anything else that shows it too. Undefined while the document loads or has no image. */
export function useShownPicture(documentId: string): ShownPicture | undefined {
  const showOriginal = useAppStore(
    (state) => state.showOriginal[documentId] ?? false,
  )
  const preview = usePreview(documentId)
  if (!preview) return undefined
  const url = pictureUrl(preview, showOriginal)
  if (url === undefined) return undefined
  return { url, name: preview.document.name }
}
