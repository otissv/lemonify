/**
 * A key binding is written as text: the modifiers `mod`, `alt` and `shift`,
 * then one key, joined with `+` (`mod+shift+z`, `g`, `delete`). `mod` is Ctrl
 * on Windows and Linux and Cmd on a Mac, so one binding serves everyone. The
 * key is the physical key (`KeyboardEvent.code`), so a binding means the same
 * key on every layout. Text is written in one canonical order, so two
 * spellings of the same binding compare equal.
 */

export interface ParsedBinding {
  /** The canonical text: `mod+alt+shift+key`. */
  text: string
  mod: boolean
  alt: boolean
  shift: boolean
  /** The `KeyboardEvent.code` of the key. */
  code: string
}

/** The parts of a keyboard event that bindings look at. */
export interface KeyEventLike {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MOD = 'mod'
const ALT = 'alt'
const SHIFT = 'shift'
const SEPARATOR = '+'
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const FUNCTION_KEYS = 12

/** The named keys: the text, the `code` it stands for, and how it is shown. */
const NAMED_KEYS: ReadonlyArray<readonly [string, string, string]> = [
  ['enter', 'Enter', 'Enter'],
  ['escape', 'Escape', 'Esc'],
  ['space', 'Space', 'Space'],
  ['tab', 'Tab', 'Tab'],
  ['backspace', 'Backspace', 'Backspace'],
  ['delete', 'Delete', 'Delete'],
  ['home', 'Home', 'Home'],
  ['end', 'End', 'End'],
  ['pageup', 'PageUp', 'Page Up'],
  ['pagedown', 'PageDown', 'Page Down'],
  ['arrowleft', 'ArrowLeft', '←'],
  ['arrowright', 'ArrowRight', '→'],
  ['arrowup', 'ArrowUp', '↑'],
  ['arrowdown', 'ArrowDown', '↓'],
  ['minus', 'Minus', '-'],
  ['equal', 'Equal', '='],
  ['comma', 'Comma', ','],
  ['period', 'Period', '.'],
  ['slash', 'Slash', '/'],
  ['backslash', 'Backslash', '\\'],
  ['semicolon', 'Semicolon', ';'],
  ['quote', 'Quote', "'"],
  ['backquote', 'Backquote', '`'],
  ['bracketleft', 'BracketLeft', '['],
  ['bracketright', 'BracketRight', ']'],
  ['numpadadd', 'NumpadAdd', 'Num +'],
  ['numpadsubtract', 'NumpadSubtract', 'Num -'],
]

interface KeyName {
  text: string
  label: string
}

const CODE_TO_KEY = new Map<string, KeyName>()
const TEXT_TO_CODE = new Map<string, string>()

function addKey(text: string, code: string, label: string): void {
  CODE_TO_KEY.set(code, { text, label })
  TEXT_TO_CODE.set(text, code)
}

for (const letter of LETTERS) {
  addKey(letter, `Key${letter.toUpperCase()}`, letter.toUpperCase())
}
for (const digit of DIGITS) addKey(digit, `Digit${digit}`, digit)
for (let number = 1; number <= FUNCTION_KEYS; number += 1) {
  addKey(`f${number}`, `F${number}`, `F${number}`)
}
for (const [text, code, label] of NAMED_KEYS) addKey(text, code, label)

/** Parses a binding's text, or returns undefined when it is not one. */
export function parseBinding(input: string): ParsedBinding | undefined {
  const parts = input.trim().toLowerCase().split(SEPARATOR)
  const key = parts.pop()
  if (key === undefined) return undefined
  const code = TEXT_TO_CODE.get(key)
  if (code === undefined) return undefined
  const seen = new Set<string>()
  for (const part of parts) {
    if (part !== MOD && part !== ALT && part !== SHIFT) return undefined
    if (seen.has(part)) return undefined
    seen.add(part)
  }
  return build(seen.has(MOD), seen.has(ALT), seen.has(SHIFT), key, code)
}

function build(
  mod: boolean,
  alt: boolean,
  shift: boolean,
  key: string,
  code: string,
): ParsedBinding {
  const parts: string[] = []
  if (mod) parts.push(MOD)
  if (alt) parts.push(ALT)
  if (shift) parts.push(SHIFT)
  parts.push(key)
  return { text: parts.join(SEPARATOR), mod, alt, shift, code }
}

const BROWSER_KEPT = new Set<string>([
  ...'twnqrlkdhjufgpoeacvxs'.split('').map((key) => `mod+${key}`),
  ...DIGITS.split('').map((digit) => `mod+${digit}`),
  'mod+tab',
  'mod+shift+tab',
  'mod+pageup',
  'mod+pagedown',
  'mod+equal',
  'mod+minus',
  'mod+shift+equal',
  'mod+numpadadd',
  'mod+numpadsubtract',
  ...'tnwqrgbopaijc'.split('').map((key) => `mod+shift+${key}`),
  'mod+shift+delete',
  'mod+shift+tab',
  'alt+arrowleft',
  'alt+arrowright',
  'alt+home',
  'alt+d',
  'alt+e',
  'alt+f',
  'alt+f4',
  'mod+bracketleft',
  'mod+bracketright',
  'mod+shift+bracketleft',
  'mod+shift+bracketright',
  ...'f1,f3,f5,f6,f7,f10,f11,f12'.split(','),
  'shift+f5',
  'mod+f5',
])

const ALREADY_USED_KEYS = new Set(['enter', 'space', 'tab', 'escape'])

/** Why a text cannot be used as a binding, in words, or undefined when it can. */
export function bindingProblem(input: string): string | undefined {
  const binding = parseBinding(input)
  if (binding === undefined) {
    return `"${input}" is not a key binding. Write any of mod, alt and shift, then one key, joined with +, for example mod+shift+z.`
  }
  if (BROWSER_KEPT.has(binding.text)) {
    return `${binding.text} is kept by the browser, so the page cannot use it.`
  }
  const key = binding.text.split(SEPARATOR).pop() ?? ''
  if (ALREADY_USED_KEYS.has(key) && !binding.mod && !binding.alt) {
    return `${binding.text} already does something on its own in buttons, menus and fields, so it cannot be a shortcut.`
  }
  return undefined
}

/** Whether a keyboard event is the binding. `mac` makes `mod` mean Cmd instead of Ctrl; the other of the two must not be held. */
export function eventMatches(
  event: KeyEventLike,
  binding: ParsedBinding,
  mac: boolean,
): boolean {
  if (event.code !== binding.code) return false
  const mod = mac ? event.metaKey : event.ctrlKey
  const other = mac ? event.ctrlKey : event.metaKey
  return (
    mod === binding.mod &&
    !other &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift
  )
}

/** The binding a pressed key stands for, or undefined for a modifier alone, a key that has no name here, or the other system's modifier. Used to record a new binding. */
export function bindingFromEvent(
  event: KeyEventLike,
  mac: boolean,
): string | undefined {
  const key = CODE_TO_KEY.get(event.code)
  if (key === undefined) return undefined
  const other = mac ? event.ctrlKey : event.metaKey
  if (other) return undefined
  const mod = mac ? event.metaKey : event.ctrlKey
  return build(mod, event.altKey, event.shiftKey, key.text, event.code).text
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  [MOD]: '⌘',
  [ALT]: '⌥',
  [SHIFT]: '⇧',
}
const OTHER_NAMES: Readonly<Record<string, string>> = {
  [MOD]: 'Ctrl',
  [ALT]: 'Alt',
  [SHIFT]: 'Shift',
}

/** A binding as people read it: `Ctrl+Shift+Z`, or `⌘⇧Z` on a Mac. A text that is not a binding is returned as it is. */
export function formatBinding(text: string, mac: boolean): string {
  const binding = parseBinding(text)
  if (binding === undefined) return text
  const label = CODE_TO_KEY.get(binding.code)?.label ?? text
  const names: string[] = []
  const table = mac ? MAC_SYMBOLS : OTHER_NAMES
  if (binding.mod) names.push(table[MOD] ?? '')
  if (binding.alt) names.push(table[ALT] ?? '')
  if (binding.shift) names.push(table[SHIFT] ?? '')
  names.push(label)
  return names.join(mac ? '' : SEPARATOR)
}

const ARIA_KEY_NAMES: Readonly<Record<string, string>> = {
  NumpadAdd: 'Plus',
  NumpadSubtract: 'Minus',
}

function ariaKeyName(code: string, label: string): string {
  const named = ARIA_KEY_NAMES[code]
  if (named !== undefined) return named
  if (label.length === 1 && !code.startsWith('Arrow')) return label
  return code.startsWith('Key') || code.startsWith('Digit') ? label : code
}

/** A binding as `aria-keyshortcuts` writes it (`Control+Shift+Z`, `Meta+Shift+Z`), so assistive technology can announce it. Undefined when the text is not a binding. */
export function ariaKeyShortcuts(
  text: string,
  mac: boolean,
): string | undefined {
  const binding = parseBinding(text)
  if (binding === undefined) return undefined
  const label = CODE_TO_KEY.get(binding.code)?.label ?? text
  const names: string[] = []
  if (binding.mod) names.push(mac ? 'Meta' : 'Control')
  if (binding.alt) names.push('Alt')
  if (binding.shift) names.push('Shift')
  names.push(ariaKeyName(binding.code, label))
  return names.join(SEPARATOR)
}
