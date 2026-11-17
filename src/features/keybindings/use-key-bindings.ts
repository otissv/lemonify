import { useEffect, useMemo, useRef } from 'react'

import { runAction } from '@/features/keybindings/action-runner'
import type { ActionContext } from '@/features/keybindings/action-runner'
import {
  actionForKeyEvent,
  buildBindingIndex,
} from '@/features/keybindings/key-dispatch'
import { useEffectiveBindings } from '@/features/keybindings/keybindings-context'
import { isMacPlatform } from '@/features/keybindings/platform'

/**
 * The one place keys become actions: a keydown anywhere on the page that is
 * one of the User's bindings runs its action. The key is taken from the
 * browser only when the action did something, so a key that cannot act here
 * (undo with nothing to undo) still does what the browser does with it.
 */
export function useKeyBindings(context: ActionContext): void {
  const effective = useEffectiveBindings()
  const index = useMemo(() => buildBindingIndex(effective), [effective])
  const latest = useRef(context)

  useEffect(() => {
    latest.current = context
  }, [context])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const action = actionForKeyEvent(event, index, isMacPlatform())
      if (action === undefined) return
      if (runAction(action.id, latest.current)) event.preventDefault()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [index])
}
