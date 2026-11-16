import {
  RiAddLine,
  RiFlowChart,
  RiGalleryLine,
  RiImageAddLine,
  RiImageLine,
} from '@remixicon/react'
import { Link, getRouteApi } from '@tanstack/react-router'
import type { RemixiconComponentType } from '@remixicon/react'

import { useImageOpener } from '@/features/app/image-opener'
import { AddWorkflowDialog } from '@/features/workflows/add-workflow-dialog'
import { relativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'

const rootRoute = getRouteApi('__root__')

const MAX_RECENT_IMAGES = 8
const MAX_RECENT_WORKFLOWS = 5

const ACTION_CLASS =
  'inline-flex w-fit items-center gap-3 rounded-sm py-1 text-body-md text-link outline-none hover:text-link-active focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50'
const ITEM_CLASS =
  'flex min-w-0 items-baseline gap-3 rounded-sm py-1 text-body-md text-link outline-none hover:text-link-active focus-visible:ring-[3px] focus-visible:ring-ring/50'

interface StartActionProps {
  icon: RemixiconComponentType
  label: string
  busy?: boolean
  onSelect: () => void
}

function StartAction({
  icon: Icon,
  label,
  busy = false,
  onSelect,
}: StartActionProps): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        className={ACTION_CLASS}
        onClick={onSelect}
      >
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        {label}
      </button>
    </li>
  )
}

function newestFirst<T extends { updatedAt: string }>(
  items: ReadonlyArray<T>,
  limit: number,
): Array<T> {
  const sorted = [...items]
  sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sorted.slice(0, limit)
}

function RecentDetail({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="truncate text-caption text-muted-foreground">{text}</span>
  )
}

/**
 * What a signed-in User sees with nothing open: ways to start, then the
 * images and workflows they worked on last.
 */
export function HomePage(): React.JSX.Element {
  const { documents, workflows } = rootRoute.useLoaderData()
  const opener = useImageOpener()
  const now = new Date()
  const recentImages = newestFirst(documents, MAX_RECENT_IMAGES)
  const recentWorkflows = newestFirst(workflows, MAX_RECENT_WORKFLOWS)

  return (
    <div className="flex size-full overflow-y-auto">
      <div className="m-auto flex w-full max-w-md flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-md font-light text-muted-foreground">
            Lemonify
          </h1>
          <p className="text-title-md text-muted-foreground">
            Edit and process images
          </p>
        </div>
        <section aria-labelledby="home-start" className="flex flex-col gap-2">
          <h2 id="home-start" className="text-title-md font-light">
            Start
          </h2>
          <ul aria-label="Start" className="flex flex-col">
            <StartAction
              icon={RiImageAddLine}
              label="Open image…"
              busy={opener.opening}
              onSelect={opener.openImage}
            />
            <StartAction
              icon={RiGalleryLine}
              label="Uploaded images…"
              onSelect={opener.showUploadedImages}
            />
            <li>
              <AddWorkflowDialog
                trigger={
                  <button type="button" className={ACTION_CLASS}>
                    <RiAddLine aria-hidden="true" className="size-5 shrink-0" />
                    New workflow…
                  </button>
                }
              />
            </li>
          </ul>
        </section>
        <section aria-labelledby="home-recent" className="flex flex-col gap-2">
          <h2 id="home-recent" className="text-title-md font-light">
            Recent
          </h2>
          {recentImages.length === 0 ? (
            <p role="status" className="text-body-md text-muted-foreground">
              No recent images yet.
            </p>
          ) : (
            <ul aria-label="Recent images" className="flex flex-col">
              {recentImages.map((document) => (
                <li key={document.id}>
                  <Link
                    to="/documents/$id"
                    params={{ id: document.id }}
                    className={ITEM_CLASS}
                  >
                    <RiImageLine
                      aria-hidden="true"
                      className="size-4 shrink-0 self-center"
                    />
                    <span className="truncate">{document.name}</span>
                    {document.source && (
                      <RecentDetail text={document.source.fileName} />
                    )}
                    <span
                      className={cn(
                        'ml-auto shrink-0 text-caption text-muted-foreground',
                      )}
                    >
                      {relativeTime(document.updatedAt, now)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {recentWorkflows.length > 0 && (
          <section
            aria-labelledby="home-workflows"
            className="flex flex-col gap-2"
          >
            <h2 id="home-workflows" className="text-title-md font-light">
              Workflows
            </h2>
            <ul aria-label="Recent workflows" className="flex flex-col">
              {recentWorkflows.map((workflow) => (
                <li key={workflow.id}>
                  <Link
                    to="/workflows/$id"
                    params={{ id: workflow.id }}
                    className={ITEM_CLASS}
                  >
                    <RiFlowChart
                      aria-hidden="true"
                      className="size-4 shrink-0 self-center"
                    />
                    <span className="truncate">{workflow.name}</span>
                    <span className="ml-auto shrink-0 text-caption text-muted-foreground">
                      {relativeTime(workflow.updatedAt, now)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
