import { useCallback } from 'react'

import {
  MenubarCheckboxItem,
  MenubarItem,
  MenubarShortcut,
} from '@/components/ui/menubar'
import { canRunAction, runAction } from '@/features/keybindings/action-runner'
import type { ActionContext } from '@/features/keybindings/action-runner'
import { actionById } from '@/features/keybindings/actions'
import { useActionHint } from '@/features/keybindings/use-action-hint'

interface ActionItemProps {
  actionId: string
  context: ActionContext
  /** What the item says when it is not the action's own label, e.g. with an ellipsis. */
  label?: string
}

function labelOf(actionId: string, label: string | undefined): string {
  return label ?? actionById(actionId)?.label ?? actionId
}

/** A menu item that does an action and shows the key the User has for it, so the menu and the key cannot disagree. */
export function ActionMenuItem({
  actionId,
  context,
  label,
}: ActionItemProps): React.JSX.Element {
  const { shown, aria } = useActionHint(actionId)

  const handleSelect = useCallback((): void => {
    runAction(actionId, context)
  }, [actionId, context])

  return (
    <MenubarItem
      disabled={!canRunAction(actionId, context)}
      aria-keyshortcuts={aria}
      onSelect={handleSelect}
    >
      {labelOf(actionId, label)}
      {shown !== undefined && <MenubarShortcut>{shown}</MenubarShortcut>}
    </MenubarItem>
  )
}

interface ActionCheckboxItemProps extends ActionItemProps {
  checked: boolean
}

/** The same for an action that switches something on and off. */
export function ActionCheckboxItem({
  actionId,
  context,
  label,
  checked,
}: ActionCheckboxItemProps): React.JSX.Element {
  const { shown, aria } = useActionHint(actionId)

  const handleCheckedChange = useCallback((): void => {
    runAction(actionId, context)
  }, [actionId, context])

  return (
    <MenubarCheckboxItem
      checked={checked}
      disabled={!canRunAction(actionId, context)}
      aria-keyshortcuts={aria}
      onCheckedChange={handleCheckedChange}
    >
      {labelOf(actionId, label)}
      {shown !== undefined && <MenubarShortcut>{shown}</MenubarShortcut>}
    </MenubarCheckboxItem>
  )
}
