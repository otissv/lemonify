import { RiAddLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { useActionHint } from '@/features/keybindings/use-action-hint'

interface LayerToolsProps {
  children: React.ReactNode
}

/** The Layers group at the top of Tools: the kinds of layer and container a page can add, given as its children. */
export function LayerTools({ children }: LayerToolsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-2 py-1 text-caption font-medium text-muted-foreground">
        Layers
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </div>
  )
}

interface LayerToolProps {
  label: string
  /** The key action that does the same, whose key is shown. */
  actionId?: string
  onAdd: () => void
}

/** One kind of layer in the Layers group. */
export function LayerTool({
  label,
  actionId,
  onAdd,
}: LayerToolProps): React.JSX.Element {
  const hint = useActionHint(actionId ?? '')

  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Add ${label}`}
        aria-keyshortcuts={hint.aria}
        title={hint.titled(`Add ${label}`)}
        className="w-full justify-start gap-2 px-2"
        onClick={onAdd}
      >
        <RiAddLine aria-hidden="true" />
        {label}
        {hint.shown !== undefined && (
          <kbd className="ml-auto font-mono text-caption text-muted-foreground">
            {hint.shown}
          </kbd>
        )}
      </Button>
    </li>
  )
}
