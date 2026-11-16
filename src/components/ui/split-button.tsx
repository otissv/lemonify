import { RiArrowDownSLine } from '@remixicon/react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface SplitButtonProps extends React.ComponentProps<'div'> {
  label: string
  children: React.ReactNode
  menuLabel: string
  items: React.ReactNode[]
}
export function SplitButton({
  label,
  menuLabel,
  items,
  children,
  className,
}: SplitButtonProps): React.JSX.Element {
  return (
    <div className={cn('flex', className)}>
      <SplitButtonMain label={label}>
        {children}
        {items.length > 0 && (
          <SplitButtonMenu label={menuLabel}>{items}</SplitButtonMenu>
        )}
      </SplitButtonMain>
    </div>
  )
}

interface SplitButtonMainProps extends React.ComponentProps<'fieldset'> {
  /** Names the group for assistive technology. */
  label?: string
}

/**
 * A main action with a menu of related actions beside it. Both are secondary
 * buttons that stretch to the same height and sit edge to edge, the main
 * button's right border serving as the divider.
 */
function SplitButtonMain({
  label,
  className,
  ...props
}: SplitButtonMainProps): React.JSX.Element {
  return (
    <fieldset
      aria-label={label}
      data-slot="split-button"
      className={cn(
        'm-0 flex w-full min-w-0 items-stretch border-0 p-0',
        className,
      )}
      {...props}
    />
  )
}

interface SplitButtonMenuProps
  extends React.ComponentProps<typeof DropdownMenu> {
  /** What the menu button does, for assistive technology and the tooltip. */
  label: string
  children: React.ReactNode
  buttonClassName?: string
  menuClassName?: string
  className?: string
}

/** The menu button of a split button: a chevron that opens the menu items given as children. */
export function SplitButtonMenu({
  label,
  children,
  buttonClassName,
  menuClassName,
  ...props
}: SplitButtonMenuProps): React.JSX.Element {
  return (
    <DropdownMenu {...props}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={label}
          title={label}
          className={cn(
            'self-stretch rounded-l-none border-l-0 px-2',
            buttonClassName,
          )}
        >
          <RiArrowDownSLine aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={menuClassName}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
