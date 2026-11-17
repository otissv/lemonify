import type { z } from 'zod'

import { actionById } from '@/features/keybindings/actions'
import { DEFAULT_KEYBINDINGS } from '@/features/keybindings/defaults'
import {
  KEYBINDINGS_VERSION,
  bindingConflicts,
  keybindingsFileSchema,
} from '@/features/keybindings/keybindings-file'
import type { KeybindingsFile } from '@/features/keybindings/keybindings-file'
import {
  NO_OVERRIDES,
  keybindingsView,
} from '@/features/keybindings/keybindings-view'
import type { KeybindingsView } from '@/features/keybindings/keybindings-view'

import type { KeybindingDao } from '../dao/keybinding-dao.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock } from '../domain/clock.ts'
import type { Actor } from '../domain/actor.ts'
import { ConflictError, ValidationError } from '../errors.ts'
import type { ChangePublisher } from '../realtime/change-publisher.ts'

type KeybindingServiceDependencies = {
  keybindings: KeybindingDao
  clock: Clock
  /** Tells the person's open tabs that their keys changed. */
  changes: ChangePublisher
}

function describeProblem(error: z.ZodError): string {
  const [issue] = error.issues
  if (issue === undefined) return 'The key bindings are not valid.'
  if (issue.code === 'invalid_key') {
    return `There is no action "${issue.path.slice(1).join(' ')}".`
  }
  const where = issue.path.slice(1).join(' ')
  return where === '' ? issue.message : `${where}: ${issue.message}`
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((binding) => b.includes(binding))
}

function labelOf(id: string): string {
  return actionById(id)?.label ?? id
}

/**
 * The keys each User has changed from the defaults, kept on the server so they
 * follow the User to every browser and to the command line. The defaults come
 * from `default-bindings.json`; only differences are stored, so a default that
 * changes later reaches everyone who did not change that action.
 */
export class KeybindingService {
  readonly #deps: KeybindingServiceDependencies
  /** The change each User has waiting or running, so two changes to one User's keys (two tabs) never read the same starting point and lose one. */
  readonly #queues = new Map<string, Promise<void>>()

  constructor(deps: KeybindingServiceDependencies) {
    this.#deps = deps
  }

  async get(actor: Actor): Promise<KeybindingsView> {
    const record = await this.#deps.keybindings.findByOwner(actor.userId)
    return keybindingsView(
      record?.overrides ?? NO_OVERRIDES,
      record?.updatedAt ?? null,
    )
  }

  /** Replaces everything the User changed, as one file that is checked as a whole. */
  save(actor: Actor, input: unknown): Promise<KeybindingsView> {
    return this.#inTurn(actor, () => this.#saveNow(actor, input))
  }

  /** Gives one action these keys; an empty list leaves it with none. */
  set(
    actor: Actor,
    actionId: string,
    bindings: string[],
  ): Promise<KeybindingsView> {
    return this.#inTurn(actor, async () => {
      const { overrides } = await this.get(actor)
      return this.#saveNow(actor, {
        version: KEYBINDINGS_VERSION,
        bindings: { ...overrides.bindings, [actionId]: bindings },
      })
    })
  }

  /** Puts one action back to its default keys, or every action when none is named. */
  reset(actor: Actor, actionId?: string): Promise<KeybindingsView> {
    return this.#inTurn(actor, async () => {
      if (actionId === undefined) return this.#store(actor, NO_OVERRIDES)
      if (actionById(actionId) === undefined) {
        throw new ValidationError(`There is no action "${actionId}".`)
      }
      const { overrides } = await this.get(actor)
      const { [actionId]: _removed, ...rest } = overrides.bindings
      return this.#store(actor, {
        version: KEYBINDINGS_VERSION,
        bindings: rest,
      })
    })
  }

  #inTurn<T>(actor: Actor, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(actor.userId) ?? Promise.resolve()
    const result = previous.then(task)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(actor.userId, tail)
    void tail.then(() => {
      if (this.#queues.get(actor.userId) === tail) {
        this.#queues.delete(actor.userId)
      }
    })
    return result
  }

  async #saveNow(actor: Actor, input: unknown): Promise<KeybindingsView> {
    const parsed = keybindingsFileSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(describeProblem(parsed.error), {
        cause: parsed.error,
      })
    }
    const overrides = withoutDefaults(parsed.data)
    this.#refuseConflicts(overrides)
    return this.#store(actor, overrides)
  }

  #refuseConflicts(overrides: KeybindingsFile): void {
    const [conflict] = bindingConflicts(DEFAULT_KEYBINDINGS, overrides)
    if (conflict === undefined) return
    const names = conflict.actionIds.map(labelOf).join(' and ')
    throw new ConflictError(
      `"${conflict.binding}" would belong to ${names}. Give it up from one of them first.`,
    )
  }

  async #store(
    actor: Actor,
    overrides: KeybindingsFile,
  ): Promise<KeybindingsView> {
    const { keybindings, clock, changes } = this.#deps
    if (Object.keys(overrides.bindings).length === 0) {
      await keybindings.deleteByOwner(actor.userId)
      changes.publish(actor.userId, { type: 'keybindings.changed' })
      return keybindingsView(NO_OVERRIDES, null)
    }
    const updatedAt = isoNow(clock)
    await keybindings.save({ ownerId: actor.userId, overrides, updatedAt })
    changes.publish(actor.userId, { type: 'keybindings.changed' })
    return keybindingsView(overrides, updatedAt)
  }
}

function withoutDefaults(file: KeybindingsFile): KeybindingsFile {
  const bindings: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(file.bindings)) {
    const fallback = DEFAULT_KEYBINDINGS.bindings[id] ?? []
    if (!sameKeys(list, fallback)) bindings[id] = list
  }
  return { version: KEYBINDINGS_VERSION, bindings }
}
