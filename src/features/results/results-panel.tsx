import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { resultDownloadUrl } from '@/features/documents/image-urls'
import type { ResultView } from '@/features/results/result'
import { errorMessage } from '@/lib/error-message'
import { useLibraryStore } from '@/store/library-store'

interface ResultsPanelProps {
  documentId: string
}

const KIND_LABELS: Readonly<Record<ResultView['kind'], string>> = {
  'ai-step': 'AI step',
  export: 'Export',
  'run-item': 'Workflow',
}

const LOAD_FAILED = 'The results could not be listed.'
const DELETE_FAILED = 'The result could not be deleted.'
const CLEAR_FAILED = 'The unused results could not be cleared.'
const BYTES_PER_MEGABYTE = 1_000_000
const DECIMALS = 1

function megabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MEGABYTE).toFixed(DECIMALS)} MB`
}

/** The AI results and exports kept for a document: download or delete them, and clear the AI results its pipeline no longer uses. */
export function ResultsPanel({
  documentId,
}: ResultsPanelProps): React.JSX.Element {
  const results = useLibraryStore((state) => state.results[documentId])
  const usage = useLibraryStore((state) => state.usage)
  const loadResults = useLibraryStore((state) => state.loadResults)
  const removeResult = useLibraryStore((state) => state.removeResult)
  const clearUnused = useLibraryStore((state) => state.clearUnusedResults)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    loadResults(documentId).catch((caught: unknown) => {
      if (current) setError(errorMessage(caught, LOAD_FAILED))
    })
    return () => {
      current = false
    }
  }, [documentId, loadResults])

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      setError(null)
      setNotice(null)
      try {
        await removeResult(id)
      } catch (caught) {
        setError(errorMessage(caught, DELETE_FAILED))
      }
    },
    [removeResult],
  )

  async function handleClear(): Promise<void> {
    setError(null)
    setNotice(null)
    try {
      const removed = await clearUnused(documentId)
      setNotice(
        removed === 0
          ? 'No unused AI results.'
          : `Removed ${removed} unused AI ${removed === 1 ? 'result' : 'results'}.`,
      )
    } catch (caught) {
      setError(errorMessage(caught, CLEAR_FAILED))
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {results !== undefined && results.length === 0 && (
        <p role="status" className="text-body-md text-muted-foreground">
          Nothing is kept for this image yet. AI steps and exports appear here.
        </p>
      )}
      <ul aria-label="Results" className="flex flex-col gap-2">
        {(results ?? []).map((result) => (
          <li
            key={result.id}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body-md">{result.fileName}</span>
              <span className="text-caption text-muted-foreground">
                {KIND_LABELS[result.kind]} · {megabytes(result.bytes)}
              </span>
            </span>
            <span className="flex shrink-0 gap-1">
              <Button asChild variant="secondary" size="xs">
                <a
                  href={resultDownloadUrl(result.id)}
                  download={result.fileName}
                  aria-label={`Download ${result.fileName}`}
                >
                  Download
                </a>
              </Button>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Delete ${result.fileName}`}
                onClick={() => void handleDelete(result.id)}
              >
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" onClick={() => void handleClear()}>
        Clear unused AI results
      </Button>
      {usage && (
        <p className="text-caption text-muted-foreground">
          {megabytes(usage.usedBytes)} of {megabytes(usage.maxBytes)} used
        </p>
      )}
      {notice && (
        <p role="status" className="text-caption text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
