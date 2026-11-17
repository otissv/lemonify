import { z } from 'zod'

import { ACTIONS, isActionId } from '@/features/keybindings/actions'
import { bindingProblem, parseBinding } from '@/features/keybindings/binding'

export const KEYBINDINGS_VERSION = 1
export const MAX_BINDINGS_PER_ACTION = 4

const bindingSchema = z.string().transform((value, context): string => {
  const problem = bindingProblem(value)
  const parsed = parseBinding(value)
  if (problem !== undefined || parsed === undefined) {
    context.addIssue({
      code: 'custom',
      message: problem ?? `"${value}" is not a key binding.`,
    })
    return z.NEVER
  }
  return parsed.text
})

const actionIdSchema = z.string().refine(isActionId, {
  message: 'There is no such action.',
})

const bindingListSchema = z
  .array(bindingSchema)
  .max(MAX_BINDINGS_PER_ACTION)
  .transform((list): string[] => [...new Set(list)])

/** The shape of the defaults file and of a user's saved changes: the keys of each action, by action id. */
const fileShapeSchema = z
  .object({
    version: z.literal(KEYBINDINGS_VERSION),
    bindings: z.record(actionIdSchema, bindingListSchema),
  })
  .strict()

function hasPrototypeKey(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  const bindings: unknown = Reflect.get(input, 'bindings')
  if (typeof bindings !== 'object' || bindings === null) return false
  return Object.hasOwn(bindings, '__proto__')
}

export const keybindingsFileSchema = z
  .unknown()
  .refine((input) => !hasPrototypeKey(input), {
    message: 'There is no such action.',
  })
  .pipe(fileShapeSchema)

export type KeybindingsFile = z.infer<typeof keybindingsFileSchema>

export type EffectiveBindings = Record<string, string[]>

export interface BindingConflict {
  binding: string
  actionIds: string[]
}

export function parseKeybindingsFile(input: unknown): KeybindingsFile {
  return keybindingsFileSchema.parse(input)
}

function ownKeys(file: KeybindingsFile): string[] {
  return Object.keys(file.bindings)
}

function listFor(file: KeybindingsFile, id: string): string[] | undefined {
  return Object.hasOwn(file.bindings, id) ? file.bindings[id] : undefined
}

function strictBindings(
  defaults: KeybindingsFile,
  overrides: KeybindingsFile,
): EffectiveBindings {
  const result: EffectiveBindings = {}
  for (const { id } of ACTIONS) {
    result[id] = listFor(overrides, id) ?? listFor(defaults, id) ?? []
  }
  return result
}

/** The keys in force: a user's list replaces the default for that action, and a default key the user gave to another action is dropped. */
export function effectiveBindings(
  defaults: KeybindingsFile,
  overrides: KeybindingsFile,
): EffectiveBindings {
  const claimed = new Set<string>()
  for (const id of ownKeys(overrides)) {
    for (const binding of listFor(overrides, id) ?? []) claimed.add(binding)
  }
  const result: EffectiveBindings = {}
  for (const { id } of ACTIONS) {
    const own = listFor(overrides, id)
    if (own !== undefined) {
      result[id] = own
      continue
    }
    const fallback = listFor(defaults, id) ?? []
    result[id] = fallback.filter((binding) => !claimed.has(binding))
  }
  return result
}

/** Keys that would belong to more than one action if the overrides were saved as they are. */
export function bindingConflicts(
  defaults: KeybindingsFile,
  overrides: KeybindingsFile,
): BindingConflict[] {
  const holders = new Map<string, string[]>()
  const strict = strictBindings(defaults, overrides)
  for (const { id } of ACTIONS) {
    for (const binding of strict[id] ?? []) {
      holders.set(binding, [...(holders.get(binding) ?? []), id])
    }
  }
  const conflicts: BindingConflict[] = []
  for (const [binding, actionIds] of holders) {
    if (actionIds.length > 1) conflicts.push({ binding, actionIds })
  }
  return conflicts
}

const storedShapeSchema = z
  .object({
    version: z.literal(KEYBINDINGS_VERSION),
    bindings: z.record(z.string(), z.array(z.string())),
  })
  .strict()

/**
 * Reads a file that was valid when it was saved. The actions and the refused
 * keys change with the app, so an entry that is no longer valid (an action that
 * was removed, a key now refused) is dropped and that action falls back to its
 * default, instead of making all of a User's keys unreadable. A file that is
 * not a key bindings file at all still throws.
 */
export function readStoredKeybindings(input: unknown): KeybindingsFile {
  const shape = storedShapeSchema.parse(input)
  const bindings: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(shape.bindings)) {
    if (!isActionId(id)) continue
    const parsed = bindingListSchema.safeParse(list)
    if (parsed.success) bindings[id] = parsed.data
  }
  return { version: KEYBINDINGS_VERSION, bindings }
}
