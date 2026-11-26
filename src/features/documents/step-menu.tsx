import { RiMoreLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface StepMenuProps {
  /** The step's name, for the button that opens the menu. */
  label: string
  /** The menu's items. */
  children: React.ReactNode
}

/** The ⋯ menu of a step's row: what can be done with that step besides the row's own buttons. */
export function StepMenu({
  label,
  children,
}: StepMenuProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More actions for ${label}`}
        >
          <RiMoreLine aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}
