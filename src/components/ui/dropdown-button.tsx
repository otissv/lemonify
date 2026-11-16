import { RiArrowDownSLine } from '@remixicon/react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface DropdownButtonProps {
  /** The text on the button. */
  label: string
  /** Names the button for assistive technology when the text alone is not enough. */
  ariaLabel?: string
  children: React.ReactNode
}

/** A secondary button that opens a menu of the `DropdownMenuItem`s given as children. */
export function DropdownButton({
  label,
  ariaLabel,
  children,
}: DropdownButtonProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={ariaLabel}
          className="w-full justify-between"
        >
          {label}
          <RiArrowDownSLine aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}
