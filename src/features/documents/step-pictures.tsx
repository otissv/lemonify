import { RiImageLine } from '@remixicon/react'

import { cn } from '@/lib/utils'

/** A step's small picture, or a placeholder while it has none. */
export function StepThumbnail({
  url,
}: {
  url: string | undefined
}): React.JSX.Element {
  if (url === undefined) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <RiImageLine aria-hidden="true" className="size-4" />
      </span>
    )
  }
  return (
    <img
      data-slot="step-thumbnail"
      src={url}
      alt=""
      width={48}
      height={48}
      className="size-12 shrink-0 rounded-sm bg-muted object-cover"
    />
  )
}

interface StepPicturesProps {
  /** Names the group for a screen reader: "Pictures of Extract". */
  label: string
  /** The pictures, as `StepPicture`s, stacked in the order given. */
  children: React.ReactNode
}

/** A step's pictures stacked one above the other. It knows nothing about which pictures a step has or where they come from; the step lists them. */
export function StepPictures({
  label,
  children,
}: StepPicturesProps): React.JSX.Element {
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
    >
      {children}
    </fieldset>
  )
}

interface StepPictureProps {
  /** Names the button for a screen reader. */
  label: string
  title: string
  /** The line under the title. */
  subtitle: string
  problem?: boolean
  url: string | undefined
  /** Whether it is the picture the canvas shows. */
  pressed: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}

/** One picture of a step, laid out like any step in the list: its small picture, a title and a line under it, outlined while it is the one the canvas shows. */
export function StepPicture({
  label,
  title,
  subtitle,
  problem = false,
  url,
  pressed,
  onClick,
}: StepPictureProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className="flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={onClick}
    >
      <span
        className={cn(
          'shrink-0 rounded-md p-0.5',
          pressed ? 'ring-2 ring-ring' : 'ring-1 ring-transparent',
        )}
      >
        <StepThumbnail url={url} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span data-slot="step-name" className="truncate text-body-md">
          {title}
        </span>
        <span
          className={cn(
            'truncate text-caption',
            problem ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {subtitle}
        </span>
      </span>
    </button>
  )
}
