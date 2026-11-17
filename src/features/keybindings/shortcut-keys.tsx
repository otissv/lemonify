import { formatBinding } from '@/features/keybindings/binding'
import { useIsMac } from '@/features/keybindings/platform'
import { cn } from '@/lib/utils'

interface ShortcutKeysProps {
  bindings: ReadonlyArray<string>
  className?: string
}

const KEY_CLASS =
  'rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-caption text-foreground'

/** The keys of an action as people read them, each in its own key cap, or "No key" when it has none. */
export function ShortcutKeys({
  bindings,
  className,
}: ShortcutKeysProps): React.JSX.Element {
  const mac = useIsMac()
  if (bindings.length === 0) {
    return (
      <span className={cn('text-caption text-muted-foreground', className)}>
        No key
      </span>
    )
  }
  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {bindings.map((binding) => (
        <kbd key={binding} className={KEY_CLASS}>
          {formatBinding(binding, mac)}
        </kbd>
      ))}
    </span>
  )
}
