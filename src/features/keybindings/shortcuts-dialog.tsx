import { useCallback, useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ACTIONS } from '@/features/keybindings/actions'
import type { ActionDefinition } from '@/features/keybindings/actions'
import { formatBinding } from '@/features/keybindings/binding'
import { isMacPlatform } from '@/features/keybindings/platform'
import { resetBindings } from '@/features/keybindings/keybinding-edit'
import { ShortcutRow } from '@/features/keybindings/shortcut-row'
import { useKeybindingEditor } from '@/features/keybindings/use-keybinding-editor'
import type { EffectiveBindings } from '@/features/keybindings/keybindings-file'
import { useUiStore } from '@/store/ui-store'

type Section = { group: string; actions: ActionDefinition[] }

function matches(
  action: ActionDefinition,
  keys: ReadonlyArray<string>,
  query: string,
  mac: boolean,
): boolean {
  const shown = keys.map((key) => formatBinding(key, mac)).join(' ')
  const text = `${action.label} ${action.group} ${action.id} ${shown}`
  return text.replace(/\s+/g, '').toLowerCase().includes(query)
}

function sectionsFor(
  effective: EffectiveBindings,
  rawQuery: string,
  mac: boolean,
): Section[] {
  const query = rawQuery.replace(/\s+/g, '').toLowerCase()
  const sections = new Map<string, ActionDefinition[]>()
  for (const action of ACTIONS) {
    if (!matches(action, effective[action.id] ?? [], query, mac)) continue
    sections.set(action.group, [...(sections.get(action.group) ?? []), action])
  }
  return [...sections].map(([group, actions]) => ({ group, actions }))
}

/** Every action with its keys, to read and to change. Opened from the Help menu or by its own shortcut. */
export function ShortcutsDialog(): React.JSX.Element {
  const open = useUiStore((state) => state.shortcutsOpen)
  const setOpen = useUiStore((state) => state.setShortcutsOpen)
  const editor = useKeybindingEditor()
  const [query, setQuery] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)
  const searchId = useId()
  const { view, error, saving, save, clearError } = editor
  const changedCount = Object.keys(view.overrides.bindings).length

  const sections = useMemo(
    () => sectionsFor(view.effective, query, isMacPlatform()),
    [view.effective, query],
  )

  const handleOpenChange = useCallback(
    (next: boolean): void => {
      setOpen(next)
      if (!next) {
        setConfirmingReset(false)
        clearError()
      }
    },
    [setOpen, clearError],
  )

  function handleQuery(event: React.ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value)
  }

  const handleAskReset = useCallback((): void => {
    setConfirmingReset(true)
  }, [])

  const handleCancelReset = useCallback((): void => {
    setConfirmingReset(false)
  }, [])

  const handleResetAll = useCallback((): void => {
    setConfirmingReset(false)
    void save(resetBindings(view.overrides))
  }, [save, view.overrides])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Change a key by pressing the one you want. Your changes are saved to
            your account and follow you to every browser.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            id={searchId}
            type="search"
            aria-label="Search shortcuts"
            placeholder="Search actions or keys"
            value={query}
            onChange={handleQuery}
          />
          {confirmingReset ? (
            <span className="flex shrink-0 items-center gap-1">
              <Button type="button" size="sm" onClick={handleResetAll}>
                Reset all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleCancelReset}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={saving || changedCount === 0}
              onClick={handleAskReset}
            >
              Reset all
            </Button>
          )}
        </div>
        {error !== undefined && (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {sections.length === 0 && (
            <p className="py-6 text-center text-body-md text-muted-foreground">
              No action or key matches that.
            </p>
          )}
          {sections.map((section) => (
            <section key={section.group} aria-label={section.group}>
              <h3 className="sticky top-0 bg-background py-1 text-caption font-medium text-muted-foreground">
                {section.group}
              </h3>
              <ul>
                {section.actions.map((action) => (
                  <ShortcutRow
                    key={action.id}
                    action={action}
                    editor={editor}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
