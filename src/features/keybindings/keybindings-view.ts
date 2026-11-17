import { DEFAULT_KEYBINDINGS } from '@/features/keybindings/defaults'
import { effectiveBindings } from '@/features/keybindings/keybindings-file'
import type {
  EffectiveBindings,
  KeybindingsFile,
} from '@/features/keybindings/keybindings-file'

export type KeybindingsView = {
  /** What the User changed from the defaults. */
  overrides: KeybindingsFile
  /** The keys in force, for every action. */
  effective: EffectiveBindings
  /** When the changes were last saved; null while the User has none. */
  updatedAt: string | null
}

export const NO_OVERRIDES: KeybindingsFile = { version: 1, bindings: {} }

/** The keys of a User who has changed nothing. */
export function defaultKeybindingsView(): KeybindingsView {
  return {
    overrides: NO_OVERRIDES,
    effective: effectiveBindings(DEFAULT_KEYBINDINGS, NO_OVERRIDES),
    updatedAt: null,
  }
}

export function keybindingsView(
  overrides: KeybindingsFile,
  updatedAt: string | null,
): KeybindingsView {
  return {
    overrides,
    effective: effectiveBindings(DEFAULT_KEYBINDINGS, overrides),
    updatedAt,
  }
}
