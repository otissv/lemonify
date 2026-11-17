import { RiDownloadLine } from '@remixicon/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { resultUrl } from '@/features/results/result'
import type { ResultView } from '@/features/results/result'
import { listResults } from '@/features/results/result-functions'
import { useLibraryStore } from '@/store/library-store'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'

interface RunsPanelProps {
  workflowId: string
}

const STATE_LABELS: Readonly<Record<RunState, string>> = {
  [RunState.Running]: 'Running',
  [RunState.Done]: 'Done',
  [RunState.Failed]: 'Failed',
  [RunState.Cancelled]: 'Cancelled',
}

function percent(progress: number): number {
  return Math.round(progress * 100)
}

function RunImages({ run }: { run: RunView }): React.JSX.Element {
  const [images, setImages] = useState<ReadonlyArray<ResultView> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleShow(): Promise<void> {
    setError(null)
    try {
      setImages(await listResults({ data: { workflowRunId: run.id } }))
    } catch {
      setError('The images could not be loaded.')
    }
  }

  if (images === null) {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => void handleShow()}>
          Show images
        </Button>
        {error && (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}
      </>
    )
  }
  if (images.length === 0) {
    return <p className="text-caption text-muted-foreground">No images.</p>
  }
  return (
    <ul aria-label="Run images" className="flex flex-col">
      {images.map((image) => (
        <li key={image.id}>
          <a
            href={resultUrl(image.id)}
            download={image.fileName}
            className="inline-flex items-center gap-1 text-body-md underline"
          >
            <RiDownloadLine aria-hidden="true" className="size-4" />
            {image.fileName}
          </a>
        </li>
      ))}
    </ul>
  )
}

function RunRow({
  workflowId,
  run,
}: {
  workflowId: string
  run: RunView
}): React.JSX.Element {
  const cancelRun = useLibraryStore((state) => state.cancelRun)
  const removeRun = useLibraryStore((state) => state.removeRun)
  const running = run.state === RunState.Running

  return (
    <li className="flex flex-col gap-1 border-b border-border py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-md">
          {STATE_LABELS[run.state]}
          {running && ` · ${percent(run.progress)}%`}
          <span className="text-caption text-muted-foreground">
            {' '}
            · {run.jobs.done} of {run.jobs.total} done
            {run.jobs.failed > 0 && `, ${run.jobs.failed} failed`}
          </span>
        </span>
        {running ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void cancelRun(workflowId, run.id)}
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void removeRun(workflowId, run.id)}
          >
            Delete
          </Button>
        )}
      </div>
      {running && (
        <progress
          aria-label="Run progress"
          className="h-1 w-full"
          max={100}
          value={percent(run.progress)}
        />
      )}
      {run.errors.map((message) => (
        <p key={message} className="text-caption text-destructive">
          {message}
        </p>
      ))}
      {run.jobs.done > 0 && <RunImages run={run} />}
    </li>
  )
}

/** The workflow's runs, newest first: progress while they go, then the images to download. */
export function RunsPanel({ workflowId }: RunsPanelProps): React.JSX.Element {
  const runs = useLibraryStore((state) => state.runs[workflowId])
  const error = useLibraryStore((state) => state.runErrors[workflowId])

  return (
    <section aria-label="Runs" className="px-4 py-2">
      <h2 className="text-title-sm">Runs</h2>
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      {runs === undefined || runs.length === 0 ? (
        <p className="text-caption text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="flex flex-col">
          {runs.map((run) => (
            <RunRow key={run.id} workflowId={workflowId} run={run} />
          ))}
        </ul>
      )}
    </section>
  )
}
