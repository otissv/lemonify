import {
  RiDeleteBinLine,
  RiDownloadLine,
  RiMoreLine,
  RiStopLine,
} from '@remixicon/react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { runArchiveUrl, sourceImageUrl } from '@/features/documents/image-urls'
import { resultUrl } from '@/features/results/result'
import { RunProgress } from '@/features/workflows/runs/run-progress'
import {
  ITEM_STATE_LABELS,
  imageCount,
  runSummary,
  stillInputs,
} from '@/features/workflows/runs/run-text'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'
import { RunItemState } from '@/server/workflows/run-items'
import type { RunItem } from '@/server/workflows/run-items'

interface RunDetailProps {
  run: RunView
  name: string
  inputs: ReadonlyArray<string>
  imageName: (sourceId: string) => string
  onRun: (sourceIds: string[]) => void
  onStop: (runId: string) => void
  onDelete: (runId: string) => void
}

function startedAt(run: RunView): string {
  return new Date(run.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function RunItemRow({
  item,
  name,
}: {
  item: RunItem
  name: string
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 py-1">
      <img
        src={sourceImageUrl(item.sourceId)}
        alt=""
        loading="lazy"
        className="size-8 shrink-0 rounded-sm object-cover"
      />
      <span className="min-w-0 flex-1 truncate text-body-md">{name}</span>
      <span className="text-caption text-muted-foreground">
        {ITEM_STATE_LABELS[item.state]}
      </span>
      {item.resultIds.map((resultId, index) => (
        <a
          key={resultId}
          href={resultUrl(resultId)}
          download
          aria-label={
            item.resultIds.length === 1
              ? `Download ${name}`
              : `Download ${name}, file ${index + 1}`
          }
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent"
        >
          <RiDownloadLine aria-hidden="true" className="size-4" />
        </a>
      ))}
    </li>
  )
}

function RunMenu({
  run,
  name,
  inputs,
  onRun,
  onDelete,
}: Pick<
  RunDetailProps,
  'run' | 'name' | 'inputs' | 'onRun' | 'onDelete'
>): React.JSX.Element {
  const again = stillInputs(run.sourceIds, inputs)
  const failed = stillInputs(
    run.items.flatMap((item) =>
      item.state === RunItemState.Failed ? [item.sourceId] : [],
    ),
    inputs,
  )

  function handleRunAgain(): void {
    onRun(again)
  }

  function handleRetry(): void {
    onRun(failed)
  }

  function handleDelete(): void {
    onDelete(run.id)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`More actions for ${name}`}
        >
          <RiMoreLine aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={again.length === 0}
          onSelect={handleRunAgain}
        >
          Run again
        </DropdownMenuItem>
        <DropdownMenuItem disabled={failed.length === 0} onSelect={handleRetry}>
          Retry failed
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={handleDelete}
        >
          <RiDeleteBinLine aria-hidden="true" className="size-4" />
          Delete run
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One run: how far it has got, why images failed, each image with its downloads, and what can be done with it. */
export function RunDetail(props: RunDetailProps): React.JSX.Element {
  const { run, name, imageName, onStop } = props
  const headingId = useId()
  const running = run.state === RunState.Running
  const anyDone = run.items.some((item) => item.state === RunItemState.Done)

  function handleStop(): void {
    onStop(run.id)
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-title-sm">
            {name}
          </h3>
          <p className="text-caption text-muted-foreground">
            {imageCount(run.sourceIds.length)} · started {startedAt(run)}
          </p>
        </div>
        {running ? (
          <Button variant="secondary" size="sm" onClick={handleStop}>
            <RiStopLine aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <>
            {anyDone && (
              <Button variant="secondary" size="sm" asChild>
                <a href={runArchiveUrl(run.id)} download>
                  <RiDownloadLine aria-hidden="true" />
                  Download all
                </a>
              </Button>
            )}
            <RunMenu {...props} />
          </>
        )}
      </div>
      <RunProgress run={run} label="Run progress" />
      <p className="text-caption text-muted-foreground">{runSummary(run)}</p>
      {run.errors.length > 0 && (
        <div
          role="alert"
          className="flex flex-col text-caption text-destructive"
        >
          {run.errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
      <ul aria-label="Images" className="flex min-h-0 flex-col overflow-y-auto">
        {run.items.map((item) => (
          <RunItemRow
            key={item.sourceId}
            item={item}
            name={imageName(item.sourceId)}
          />
        ))}
      </ul>
    </section>
  )
}
