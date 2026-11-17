import {
  RiArrowDownLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFolderLine,
} from '@remixicon/react'

import { Button } from '@/components/ui/button'
import type { SelectModifiers } from '@/features/documents/step-row'
import type { GroupStep } from '@/features/pipeline/pipeline'
import { pipelineStepTitle } from '@/features/pipeline/step-problems'
import { cn } from '@/lib/utils'

export interface GroupRowProps {
  group: GroupStep
  /** Where the group is among the top-level steps: later ones are drawn on top. */
  position: number
  count: number
  selected: boolean
  marked: boolean
  collapsed: boolean
  dragging: boolean
  /** The small picture of a sub-document as it lands on the canvas. */
  thumbnail: string | undefined
  /** Why the server left the group out of the picture, if it did. */
  skipped: string | undefined
  /** A step is being dragged over the group's header, which would put it in the group. */
  receiving: boolean
  onSelect: (stepId: string, modifiers: SelectModifiers) => void
  onCollapse: (groupId: string, collapsed: boolean) => void
  onToggle: (stepId: string, isOn: boolean) => void
  onDelete: (stepId: string) => void
  onMove: (stepId: string, index: number) => void
}

function summary(group: GroupStep): string {
  const count = group.steps.length
  const steps = `${count} ${count === 1 ? 'step' : 'steps'}`
  return group.subDocument ? `Own picture · ${steps}` : steps
}

/** The header of a group in the sidebar: fold it, select it, switch it (and all it holds) off, move or delete it. Its steps are listed under it. */
export function GroupRow({
  group,
  position,
  count,
  selected,
  marked,
  collapsed,
  dragging,
  receiving,
  thumbnail,
  skipped,
  onSelect,
  onCollapse,
  onToggle,
  onDelete,
  onMove,
}: GroupRowProps): React.JSX.Element {
  const label = pipelineStepTitle(group)

  function handleSelect(event: React.MouseEvent<HTMLButtonElement>): void {
    onSelect(group.id, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    })
  }

  function handleCollapse(): void {
    onCollapse(group.id, !collapsed)
  }

  function handleToggle(): void {
    onToggle(group.id, !group.enabled)
  }

  function handleDelete(): void {
    onDelete(group.id)
  }

  function handleMoveUp(): void {
    onMove(group.id, position + 1)
  }

  function handleMoveDown(): void {
    onMove(group.id, position - 1)
  }

  return (
    <div
      data-slot="group-row"
      className={cn(
        'flex flex-col gap-1 rounded-md p-1',
        (selected || marked) && 'bg-accent',
        receiving && 'ring-2 ring-ring',
        dragging && 'opacity-50',
        !group.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
          aria-expanded={!collapsed}
          onClick={handleCollapse}
        >
          {collapsed ? (
            <RiArrowRightSLine aria-hidden="true" className="size-4" />
          ) : (
            <RiArrowDownSLine aria-hidden="true" className="size-4" />
          )}
        </Button>
        <button
          type="button"
          aria-current={selected ? 'true' : undefined}
          aria-label={`Group ${label}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={handleSelect}
        >
          {thumbnail ? (
            <img
              data-slot="step-thumbnail"
              src={thumbnail}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0 rounded-sm bg-muted object-cover"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
              <RiFolderLine aria-hidden="true" className="size-4" />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span data-slot="step-name" className="truncate text-body-md">
              {label}
            </span>
            <span
              className={cn(
                'truncate text-caption',
                skipped === undefined
                  ? 'text-muted-foreground'
                  : 'text-destructive',
              )}
            >
              {skipped ?? summary(group)}
            </span>
          </span>
        </button>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${group.enabled ? 'Hide' : 'Show'} ${label}`}
          title={group.enabled ? 'Hide this group' : 'Show this group'}
          onClick={handleToggle}
        >
          {group.enabled ? (
            <RiEyeLine aria-hidden="true" className="size-4" />
          ) : (
            <RiEyeOffLine aria-hidden="true" className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${label} up`}
          disabled={position === count - 1}
          onClick={handleMoveUp}
        >
          <RiArrowUpLine aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${label} down`}
          disabled={position === 0}
          onClick={handleMoveDown}
        >
          <RiArrowDownLine aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${label}`}
          onClick={handleDelete}
        >
          <RiDeleteBinLine aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  )
}
