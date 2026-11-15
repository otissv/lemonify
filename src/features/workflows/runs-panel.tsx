import { RiDownloadLine } from '@remixicon/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { resultUrl } from '@/features/results/result'
import type { ResultView } from '@/features/results/result'
import type { WorkflowRuns } from '@/features/workflows/use-workflow-runs'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'

interface RunsPanelProps {
  runs: WorkflowRuns
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

function RunImages({
  runs,
  run,
}: {
  runs: WorkflowRuns
  run: RunView
}): React.JSX.Element {
  const [images, setImages] = useState<ReadonlyArray<ResultView> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleShow(): Promise<void> {
    setError(null)
    try {
      setImages(await runs.images(run.id))
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
  runs,
  run,
}: {
  runs: WorkflowRuns
  run: RunView
}): React.JSX.Element {
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
            onClick={() => void runs.cancel(run.id)}
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void runs.remove(run.id)}
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
      {run.jobs.done > 0 && <RunImages runs={runs} run={run} />}
    </li>
  )
}

/** The workflow's runs, newest first: progress while they go, then the images to download. */
export function RunsPanel({ runs }: RunsPanelProps): React.JSX.Element {
  return (
    <section
      aria-label="Runs"
      className="max-h-56 shrink-0 overflow-y-auto border-t border-border px-4 py-2"
    >
      <h2 className="text-title-sm">Runs</h2>
      {runs.error && (
        <p role="alert" className="text-caption text-destructive">
          {runs.error}
        </p>
      )}
      {runs.runs.length === 0 ? (
        <p className="text-caption text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="flex flex-col">
          {runs.runs.map((run) => (
            <RunRow key={run.id} runs={runs} run={run} />
          ))}
        </ul>
      )}
    </section>
  )
}
