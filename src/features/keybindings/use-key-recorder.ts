import { useEffect } from 'react'

import { bindingFromEvent } from '@/features/keybindings/binding'
import { isMacPlatform } from '@/features/keybindings/platform'

const CANCEL_CODE = 'Escape'

/**
 * While `active`, takes the next key combination the person presses and
 * hands it over as a binding, so they can set a key by pressing it. The page
 * sees nothing meanwhile, so recording a key never also runs its action.
 * Escape on its own cancels; modifiers alone are waited past.
 */
export function useKeyRecorder(
  active: boolean,
  onRecord: (binding: string) => void,
  onCancel: () => void,
): void {
  useEffect(() => {
    if (!active) return
    function handleKeyDown(event: KeyboardEvent): void {
      event.preventDefault()
      event.stopPropagation()
      const plain = !(
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
      if (event.code === CANCEL_CODE && plain) {
        onCancel()
        return
      }
      const binding = bindingFromEvent(event, isMacPlatform())
      if (binding !== undefined) onRecord(binding)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [active, onRecord, onCancel])
}
