import defaultBindingsJson from '@/features/keybindings/default-bindings.json' with {
  type: 'json',
}
import {
  parseKeybindingsFile,
  type KeybindingsFile,
} from '@/features/keybindings/keybindings-file'

/** The keys everyone starts with, read from `default-bindings.json`; a file that does not pass the schema stops the app from starting. */
export const DEFAULT_KEYBINDINGS: KeybindingsFile =
  parseKeybindingsFile(defaultBindingsJson)
