import type { ExportStatus } from '@/features/documents/use-export-document'
import { formatSize } from '@/lib/format-size'

interface TransferStatusProps {
  exporting: ExportStatus
  importing: boolean
}

function describe(
  exporting: ExportStatus,
  importing: boolean,
): { text: string; fraction?: number } | null {
  if (importing) return { text: 'Opening the document…' }
  switch (exporting.kind) {
    case 'idle':
      return null
    case 'preparing':
      return { text: 'Preparing the document…' }
    case 'saved':
      return { text: `Saved “${exporting.fileName}”.` }
    case 'saving': {
      const { loaded, total } = exporting
      if (total === undefined) {
        return { text: `Saving the document… ${formatSize(loaded)}` }
      }
      return {
        text: `Saving the document… ${formatSize(loaded)} of ${formatSize(total)}`,
        fraction: loaded / total,
      }
    }
  }
}

/** Tells the person that a document is being saved or opened, how far it has got, and when it is done. */
export function TransferStatus({
  exporting,
  importing,
}: TransferStatusProps): React.JSX.Element | null {
  const shown = describe(exporting, importing)
  if (shown === null) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 text-caption shadow-lg"
    >
      <p>{shown.text}</p>
      {shown.fraction !== undefined && (
        <progress
          className="h-1 w-full"
          max={1}
          value={shown.fraction}
          aria-label="Saving the document"
        />
      )}
    </div>
  )
}
