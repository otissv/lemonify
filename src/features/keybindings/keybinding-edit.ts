import { bindingProblem, parseBinding } from '@/features/keybindings/binding'
import {
  KEYBINDINGS_VERSION,
  MAX_BINDINGS_PER_ACTION,
} from '@/features/keybindings/keybindings-file'
import type {
  EffectiveBindings,
  KeybindingsFile,
} from '@/features/keybindings/keybindings-file'

export type AssignMode = 'replace' | 'add'

export type AssignResult =
  | { kind: 'ok'; overrides: KeybindingsFile }
  | { kind: 'problem'; message: string }
  /** Another action has the key; `reassign` is the file that takes it from there and gives it to this one. */
  | {
      kind: 'conflict'
      binding: string
      holderId: string
      reassign: KeybindingsFile
    }

function withList(
  overrides: KeybindingsFile,
  actionId: string,
  list: string[],
): KeybindingsFile {
  return {
    version: KEYBINDINGS_VERSION,
    bindings: { ...overrides.bindings, [actionId]: list },
  }
}

function holderOf(
  effective: EffectiveBindings,
  actionId: string,
  binding: string,
): string | undefined {
  for (const [id, list] of Object.entries(effective)) {
    if (id !== actionId && list.includes(binding)) return id
  }
  return undefined
}

/** What the User's changes become when `binding` is given to an action, by replacing its keys or adding to them. Never changes anything itself: the result is what to save. */
export function assignBinding(
  effective: EffectiveBindings,
  overrides: KeybindingsFile,
  actionId: string,
  binding: string,
  mode: AssignMode,
): AssignResult {
  const problem = bindingProblem(binding)
  const parsed = parseBinding(binding)
  if (problem !== undefined || parsed === undefined) {
    return { kind: 'problem', message: problem ?? `"${binding}" is not a key.` }
  }
  const text = parsed.text
  const current = effective[actionId] ?? []
  if (mode === 'add' && current.includes(text)) {
    return { kind: 'ok', overrides }
  }
  if (mode === 'add' && current.length >= MAX_BINDINGS_PER_ACTION) {
    return {
      kind: 'problem',
      message: `An action can have at most ${MAX_BINDINGS_PER_ACTION} keys. Remove one first.`,
    }
  }
  const list = mode === 'add' ? [...current, text] : [text]
  const next = withList(overrides, actionId, list)
  const holderId = holderOf(effective, actionId, text)
  if (holderId === undefined) return { kind: 'ok', overrides: next }
  const kept = (effective[holderId] ?? []).filter((key) => key !== text)
  return {
    kind: 'conflict',
    binding: text,
    holderId,
    reassign: withList(next, holderId, kept),
  }
}

/** The changes with the action left without any key. */
export function clearBindings(
  overrides: KeybindingsFile,
  actionId: string,
): KeybindingsFile {
  return withList(overrides, actionId, [])
}

/** The changes with one action back to its default keys, or all of them when no action is named. */
export function resetBindings(
  overrides: KeybindingsFile,
  actionId?: string,
): KeybindingsFile {
  if (actionId === undefined) {
    return { version: KEYBINDINGS_VERSION, bindings: {} }
  }
  const bindings: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(overrides.bindings)) {
    if (id !== actionId) bindings[id] = list
  }
  return { version: KEYBINDINGS_VERSION, bindings }
}
