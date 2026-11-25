import {
  RiArrowDownLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiArrowUpLine,
  RiAspectRatioLine,
  RiFullscreenExitLine,
} from '@remixicon/react'
import type { RemixiconComponentType } from '@remixicon/react'
import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { useActionHint } from '@/features/keybindings/use-action-hint'
import { PAN_STEPS, panDistance } from '@/features/viewport/pan-step'
import { useViewport } from '@/features/viewport/use-viewport'
import { cn } from '@/lib/utils'

interface ViewToolbarProps {
  label: string
  className?: string
  children: React.ReactNode
}

interface ViewButtonProps {
  documentId: string
}

interface ViewActionButtonProps {
  actionId: string
  label: string
  icon: RemixiconComponentType
  disabled: boolean
  onClick: () => void
}

interface PanButtonSpec {
  actionId: string
  label: string
  icon: RemixiconComponentType
}

const PAN_BUTTONS: ReadonlyArray<PanButtonSpec> = [
  {
    actionId: 'view.panLeft',
    label: 'Move the picture left',
    icon: RiArrowLeftLine,
  },
  { actionId: 'view.panUp', label: 'Move the picture up', icon: RiArrowUpLine },
  {
    actionId: 'view.panDown',
    label: 'Move the picture down',
    icon: RiArrowDownLine,
  },
  {
    actionId: 'view.panRight',
    label: 'Move the picture right',
    icon: RiArrowRightLine,
  },
]

/** A strip of controls for the view of a canvas, made of the parts below or any others. */
export function ViewToolbar({
  label,
  className,
  children,
}: ViewToolbarProps): React.JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-slot="view-toolbar"
      className={cn(
        'flex h-9 shrink-0 items-center gap-1 border-t bg-background px-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A gap between groups of controls in a toolbar. */
export function ViewToolbarDivider(): React.JSX.Element {
  return <div aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
}

function ViewActionButton({
  actionId,
  label,
  icon: Icon,
  disabled,
  onClick,
}: ViewActionButtonProps): React.JSX.Element {
  const hint = useActionHint(actionId)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={hint.titled(label)}
      aria-keyshortcuts={hint.aria}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}

/** Fits the whole picture in the window. */
export function FitButton({ documentId }: ViewButtonProps): React.JSX.Element {
  const view = useViewport(documentId)
  return (
    <ViewActionButton
      actionId="view.fit"
      label="Fit on screen"
      icon={RiFullscreenExitLine}
      disabled={view.frame === undefined}
      onClick={view.fit}
    />
  )
}

/** One picture pixel to one screen pixel. */
export function ActualSizeButton({
  documentId,
}: ViewButtonProps): React.JSX.Element {
  const view = useViewport(documentId)
  return (
    <ViewActionButton
      actionId="view.actualSize"
      label="Actual size"
      icon={RiAspectRatioLine}
      disabled={view.frame === undefined}
      onClick={view.actualSize}
    />
  )
}

function PanButton({
  documentId,
  actionId,
  label,
  icon,
}: ViewButtonProps & PanButtonSpec): React.JSX.Element {
  const view = useViewport(documentId)
  const step = PAN_STEPS[actionId]
  const { panBy } = view
  const handleClick = useCallback((): void => {
    if (step === undefined) return
    const [dx, dy] = panDistance(step)
    panBy(dx, dy)
  }, [panBy, step])
  return (
    <ViewActionButton
      actionId={actionId}
      label={label}
      icon={icon}
      disabled={view.frame === undefined || step === undefined}
      onClick={handleClick}
    />
  )
}

/** Moves the picture a step each way, as the arrow keys do. */
export function PanButtons({ documentId }: ViewButtonProps): React.JSX.Element {
  return (
    <>
      {PAN_BUTTONS.map((pan) => (
        <PanButton key={pan.actionId} documentId={documentId} {...pan} />
      ))}
    </>
  )
}
