import { actionById } from '@/features/keybindings/actions'
import type { ActionDefinition } from '@/features/keybindings/actions'
import { eventMatches, parseBinding } from '@/features/keybindings/binding'
import type {
  KeyEventLike,
  ParsedBinding,
} from '@/features/keybindings/binding'
import type { EffectiveBindings } from '@/features/keybindings/keybindings-file'

/** What a key press must say for the page to decide whether it is a shortcut. */
export interface DispatchEvent extends KeyEventLike {
  repeat: boolean
  isComposing: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

export interface BindingIndex {
  readonly entries: ReadonlyArray<{
    action: ActionDefinition
    binding: ParsedBinding
  }>
}

/**
 * Places where keys belong to the control the person is using: typing in a
 * field, moving through a menu, list, slider or tabs, and anything inside a
 * dialog. A shortcut there would take the key away from them.
 */
const OWN_KEYS_SELECTOR = [
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="combobox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-radix-popper-content-wrapper]',
].join(',')

export function isIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  return target.closest(OWN_KEYS_SELECTOR) !== null
}

/** Reads the keys in force once, so a key press does not parse text. A binding that cannot be read is left out. */
export function buildBindingIndex(effective: EffectiveBindings): BindingIndex {
  const entries: Array<{ action: ActionDefinition; binding: ParsedBinding }> =
    []
  for (const [id, list] of Object.entries(effective)) {
    const action = actionById(id)
    if (action === undefined) continue
    for (const text of list) {
      const binding = parseBinding(text)
      if (binding !== undefined) entries.push({ action, binding })
    }
  }
  return { entries }
}

/** The action a key press is a shortcut for, or nothing when it is not one or must be left to something else. */
export function actionForKeyEvent(
  event: DispatchEvent,
  index: BindingIndex,
  mac: boolean,
): ActionDefinition | undefined {
  if (event.defaultPrevented || event.isComposing) return undefined
  if (isIgnoredTarget(event.target)) return undefined
  for (const { action, binding } of index.entries) {
    if (!eventMatches(event, binding, mac)) continue
    if (event.repeat && !action.repeats) return undefined
    return action
  }
  return undefined
}
