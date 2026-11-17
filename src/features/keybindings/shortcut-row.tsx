import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { ActionDefinition } from '@/features/keybindings/actions'
import { actionById } from '@/features/keybindings/actions'
import {
  assignBinding,
  clearBindings,
  resetBindings,
} from '@/features/keybindings/keybinding-edit'
import type { AssignMode } from '@/features/keybindings/keybinding-edit'
import type { KeybindingEditor } from '@/features/keybindings/use-keybinding-editor'
import { ShortcutKeys } from '@/features/keybindings/shortcut-keys'
import { useKeyRecorder } from '@/features/keybindings/use-key-recorder'
import { MAX_BINDINGS_PER_ACTION } from '@/features/keybindings/keybindings-file'
import type { KeybindingsFile } from '@/features/keybindings/keybindings-file'

interface ShortcutRowProps {
  action: ActionDefinition
  editor: KeybindingEditor
}

type Pending = {
  binding: string
  holderLabel: string
  reassign: KeybindingsFile
}

/** One action in the shortcuts list: its keys, and the buttons to record a new key, add one, take them off or go back to the defaults. */
export function ShortcutRow({
  action,
  editor,
}: ShortcutRowProps): React.JSX.Element {
  const { view, saving, save, reportProblem, clearError } = editor
  const [mode, setMode] = useState<AssignMode | undefined>(undefined)
  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const keys = view.effective[action.id] ?? []
  const changed = Object.hasOwn(view.overrides.bindings, action.id)

  const handleCancel = useCallback((): void => {
    setMode(undefined)
  }, [])

  const handleRecord = useCallback(
    (binding: string): void => {
      if (mode === undefined) return
      setMode(undefined)
      clearError()
      const result = assignBinding(
        view.effective,
        view.overrides,
        action.id,
        binding,
        mode,
      )
      if (result.kind === 'problem') {
        reportProblem(result.message)
        return
      }
      if (result.kind === 'conflict') {
        setPending({
          binding: result.binding,
          holderLabel: actionById(result.holderId)?.label ?? result.holderId,
          reassign: result.reassign,
        })
        return
      }
      void save(result.overrides)
    },
    [mode, view, action.id, save, reportProblem, clearError],
  )

  useKeyRecorder(mode !== undefined, handleRecord, handleCancel)

  const handleChange = useCallback((): void => {
    clearError()
    setPending(undefined)
    setMode('replace')
  }, [clearError])

  const handleAdd = useCallback((): void => {
    clearError()
    setPending(undefined)
    setMode('add')
  }, [clearError])

  const handleClear = useCallback((): void => {
    void save(clearBindings(view.overrides, action.id))
  }, [save, view.overrides, action.id])

  const handleReset = useCallback((): void => {
    void save(resetBindings(view.overrides, action.id))
  }, [save, view.overrides, action.id])

  const handleReassign = useCallback((): void => {
    if (pending === undefined) return
    setPending(undefined)
    void save(pending.reassign)
  }, [pending, save])

  const handleKeep = useCallback((): void => {
    setPending(undefined)
  }, [])

  const recording = mode !== undefined
  return (
    <li
      data-action={action.id}
      className="flex flex-col gap-2 border-b border-border py-2 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-0 flex-1 text-body-md">{action.label}</span>
        <ShortcutKeys bindings={keys} />
        <span className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={saving}
            aria-pressed={mode === 'replace'}
            aria-label={`Change the key for ${action.label}`}
            onClick={handleChange}
          >
            Change
          </Button>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={saving || keys.length >= MAX_BINDINGS_PER_ACTION}
            aria-pressed={mode === 'add'}
            aria-label={`Add a key for ${action.label}`}
            onClick={handleAdd}
          >
            Add
          </Button>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={saving || keys.length === 0}
            aria-label={`Remove the keys of ${action.label}`}
            onClick={handleClear}
          >
            Remove
          </Button>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={saving || !changed}
            aria-label={`Put the default keys back for ${action.label}`}
            onClick={handleReset}
          >
            Reset
          </Button>
        </span>
      </div>
      {recording && (
        <p role="status" className="text-caption text-muted-foreground">
          Press the key you want, or Esc to cancel.
        </p>
      )}
      {pending !== undefined && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-caption"
        >
          <span>
            <ShortcutKeys
              bindings={[pending.binding]}
              className="inline-flex"
            />{' '}
            already belongs to {pending.holderLabel}.
          </span>
          <Button type="button" size="xs" onClick={handleReassign}>
            Move it here
          </Button>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={handleKeep}
          >
            Keep it there
          </Button>
        </div>
      )}
    </li>
  )
}
