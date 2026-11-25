import { z } from 'zod'

import { ACTIONS } from '../../../src/features/keybindings/actions.ts'
import { formatBinding } from '../../../src/features/keybindings/binding.ts'
import type { KeybindingsView } from '../../../src/features/keybindings/keybindings-view.ts'
import { defineAppCommand } from '../app-command.ts'

const actionId = z.string().min(1)
const FILE_FLAG = 'JSON: inline, @file.json, or - for stdin'

function keyList(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
}

/** Every action with the pages it applies on, so a script can tell which keys work where. */
function actionList(): Array<{
  id: string
  label: string
  group: string
  contexts: ReadonlyArray<string>
}> {
  return ACTIONS.map(({ id, label, group, contexts }) => ({
    id,
    label,
    group,
    contexts,
  }))
}

function describe(view: KeybindingsView): string {
  const lines: string[] = []
  for (const { id, label, contexts } of ACTIONS) {
    const keys = view.effective[id] ?? []
    const shown =
      keys.length === 0
        ? '(none)'
        : keys.map((key) => formatBinding(key, false)).join(', ')
    const changed = Object.hasOwn(view.overrides.bindings, id) ? '  *' : ''
    lines.push(`${id}  ${label}  [${contexts.join(', ')}]  ${shown}${changed}`)
  }
  lines.push(
    '',
    '[...] the pages the action applies on: home, document, workflow.',
    '* changed by you; `keys reset` puts the defaults back.',
  )
  return lines.join('\n')
}

export const keysListCommand = defineAppCommand({
  name: 'keys list',
  summary: 'List the key bindings in force',
  synopsis: '',
  help: `Lists every action with the pages it applies on (home, document,
workflow) and the keys it has now: the defaults, with what you changed on
top. A key does nothing on a page its action does not apply on, and no two
actions share a key. A * marks an action you changed. With --json, prints
the actions, the changes, the keys in force and when they were saved.

Keys are written as modifiers and a key joined by +, such as mod+shift+z.
mod is Ctrl, or Cmd on a Mac.`,
  shape: {},
  async run({ app, actor }) {
    return {
      actions: actionList(),
      keybindings: await app.keybindings.get(actor),
    }
  },
  format: ({ keybindings }) => describe(keybindings),
})

export const keysSetCommand = defineAppCommand({
  name: 'keys set',
  summary: 'Give an action its own keys',
  synopsis: '<actionId> <keys>',
  help: `Replaces the keys of one action. <keys> are bindings separated by commas, such
as "alt+r,mod+shift+r". A key another action already has is refused and
that action is named; give it up first with \`keys unset\`. Keys the browser
keeps for itself, such as mod+w, are refused.`,
  shape: { actionId, keys: z.string().min(1) },
  positionals: ['actionId', 'keys'],
  async run({ app, actor, options }) {
    const keybindings = await app.keybindings.set(
      actor,
      options.actionId,
      keyList(options.keys),
    )
    return { keybindings }
  },
  format: ({ keybindings }) => describe(keybindings),
})

export const keysUnsetCommand = defineAppCommand({
  name: 'keys unset',
  summary: 'Leave an action with no keys',
  synopsis: '<actionId>',
  help: 'Takes every key off one action, even a default one, so its keys can be given to another. `keys reset` puts the defaults back.',
  shape: { actionId },
  positionals: ['actionId'],
  async run({ app, actor, options }) {
    const keybindings = await app.keybindings.set(actor, options.actionId, [])
    return { keybindings }
  },
  format: ({ keybindings }) => describe(keybindings),
})

export const keysResetCommand = defineAppCommand({
  name: 'keys reset',
  summary: 'Go back to the default keys',
  synopsis: '[<actionId>]',
  help: 'Puts one action back to its default keys, or every action when no id is given.',
  shape: { actionId: actionId.optional() },
  positionals: ['actionId'],
  async run({ app, actor, options }) {
    const keybindings = await app.keybindings.reset(actor, options.actionId)
    return { keybindings }
  },
  format: ({ keybindings }) => describe(keybindings),
})

export const keysExportCommand = defineAppCommand({
  name: 'keys export',
  summary: 'Print your changes as a file',
  synopsis: '',
  help: `Prints what you changed from the defaults, as JSON that \`keys import\` takes
back: {"version":1,"bindings":{"<actionId>":["<key>", ...]}}. An empty list
means the action has no key.`,
  shape: {},
  async run({ app, actor }) {
    return (await app.keybindings.get(actor)).overrides
  },
})

export const keysImportCommand = defineAppCommand({
  name: 'keys import',
  summary: 'Replace your changes with a file',
  synopsis: '--bindings <json>',
  help: `Replaces everything you changed with the file, checked as a whole: an unknown
action, a key that is not valid or that the browser keeps, or a key given to
two actions refuses the file and changes nothing.

Options:
  --bindings <json>    The file (${FILE_FLAG})`,
  shape: {
    bindings: z.unknown().refine((value) => value !== undefined, {
      message: 'Give --bindings <json>.',
    }),
  },
  flags: { bindings: { type: 'string', json: true } },
  async run({ app, actor, options }) {
    const keybindings = await app.keybindings.save(actor, options.bindings)
    return { keybindings }
  },
  format: ({ keybindings }) => describe(keybindings),
})
