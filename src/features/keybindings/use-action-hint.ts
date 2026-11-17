import { ariaKeyShortcuts, formatBinding } from '@/features/keybindings/binding'
import { useIsMac } from '@/features/keybindings/platform'
import { useEffectiveBindings } from '@/features/keybindings/keybindings-context'

export interface ActionHint {
  /** The first key as people read it, for showing beside the control. */
  shown: string | undefined
  /** `text` with the keys after it in brackets, for a `title`. */
  titled: (text: string) => string
  /** Every key as `aria-keyshortcuts` writes them. */
  aria: string | undefined
}

/** How a control that does an action tells people, and assistive technology, which keys do the same. */
export function useActionHint(actionId: string): ActionHint {
  const keys = useEffectiveBindings()[actionId] ?? []
  const mac = useIsMac()
  const shown = keys.map((key) => formatBinding(key, mac))
  const aria = keys
    .map((key) => ariaKeyShortcuts(key, mac))
    .filter((key): key is string => key !== undefined)
    .join(' ')
  return {
    shown: shown[0],
    titled: (text) =>
      shown.length === 0 ? text : `${text} (${shown.join(', ')})`,
    aria: aria === '' ? undefined : aria,
  }
}
