import { Fragment, useCallback } from 'react'

import {
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
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

/** One item of a menu: an action, with the text it shows when that is not the action's own label, and whether it is ticked when it switches something on and off. */
export interface ActionMenuEntry {
  actionId: string
  label?: string
  checked?: boolean
}

/** Whether the action applies on the page, so its item is shown. */
function appliesOn(actionId: string, context: ActionContext): boolean {
  return actionById(actionId)?.contexts.includes(context.page) ?? false
}

function shownSections(
  sections: ReadonlyArray<ReadonlyArray<ActionMenuEntry>>,
  context: ActionContext,
): ActionMenuEntry[][] {
  const shown: ActionMenuEntry[][] = []
  for (const section of sections) {
    const entries = section.filter((entry) =>
      appliesOn(entry.actionId, context),
    )
    if (entries.length > 0) shown.push(entries)
  }
  return shown
}

interface ActionMenuProps {
  title: string
  context: ActionContext
  /** The items, in sections divided by a line. Items whose action does not apply on the page are left out, and so is a section or menu left empty. */
  sections: ReadonlyArray<ReadonlyArray<ActionMenuEntry>>
}

/** A menu of the menu bar built from actions, showing only those that apply on the page. */
export function ActionMenu({
  title,
  context,
  sections,
}: ActionMenuProps): React.JSX.Element | null {
  const shown = shownSections(sections, context)
  if (shown.length === 0) return null
  return (
    <MenubarMenu>
      <MenubarTrigger>{title}</MenubarTrigger>
      <MenubarContent>
        {shown.map((entries, index) => (
          <Fragment key={entries[0]?.actionId}>
            {index > 0 && <MenubarSeparator />}
            {entries.map((entry) =>
              entry.checked === undefined ? (
                <ActionMenuItem
                  key={entry.actionId}
                  actionId={entry.actionId}
                  context={context}
                  label={entry.label}
                />
              ) : (
                <ActionCheckboxItem
                  key={entry.actionId}
                  actionId={entry.actionId}
                  context={context}
                  label={entry.label}
                  checked={entry.checked}
                />
              ),
            )}
          </Fragment>
        ))}
      </MenubarContent>
    </MenubarMenu>
  )
}
