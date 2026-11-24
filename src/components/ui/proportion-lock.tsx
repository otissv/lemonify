import { RiLinkM, RiLinkUnlinkM } from '@remixicon/react'

import { Button } from '@/components/ui/button'

interface ProportionLockProps {
  /** What is kept, as the button's name, such as "Keep proportions". */
  label: string
  locked: boolean
  onLockedChange: (locked: boolean) => void
  className?: string
}

/** The chain between two linked values: pressed while changing one changes the other, released while each changes on its own. It knows nothing about what the values are. */
export function ProportionLock({
  label,
  locked,
  onLockedChange,
  className,
}: ProportionLockProps): React.JSX.Element {
  function handleClick(): void {
    onLockedChange(!locked)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={locked}
      title={
        locked
          ? 'Linked: changing one changes the other'
          : 'Not linked: each changes on its own'
      }
      className={className}
      onClick={handleClick}
    >
      {locked ? (
        <RiLinkM aria-hidden="true" />
      ) : (
        <RiLinkUnlinkM aria-hidden="true" />
      )}
    </Button>
  )
}
