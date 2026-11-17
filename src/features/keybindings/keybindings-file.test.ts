import { describe, expect, it } from 'vitest'

import {
  MAX_BINDINGS_PER_ACTION,
  bindingConflicts,
  effectiveBindings,
  keybindingsFileSchema,
  parseKeybindingsFile,
  readStoredKeybindings,
  type KeybindingsFile,
} from '@/features/keybindings/keybindings-file'

function file(bindings: Record<string, string[]>): KeybindingsFile {
  return { version: 1, bindings }
}

describe('the key bindings file', () => {
  it('accepts a valid file and writes each binding in its canonical form', () => {
    const parsed = parseKeybindingsFile({
      version: 1,
      bindings: { 'edit.redo': ['shift+mod+Z', 'MOD+y', 'mod+y'] },
    })
    expect(parsed.bindings['edit.redo']).toEqual(['mod+shift+z', 'mod+y'])
  })

  it('accepts an empty list, which means the action has no key', () => {
    expect(parseKeybindingsFile(file({ 'edit.undo': [] })).bindings).toEqual({
      'edit.undo': [],
    })
  })

  it.each([
    ['a wrong version', { version: 2, bindings: {} }],
    ['no version', { bindings: {} }],
    ['an unknown action', file({ 'edit.nope': ['mod+z'] })],
    [
      'a prototype key',
      JSON.parse('{"version":1,"bindings":{"__proto__":["a"]}}'),
    ],
    [
      'a binding that is not a string',
      { version: 1, bindings: { 'edit.undo': [1] } },
    ],
    ['a binding that is not valid', file({ 'edit.undo': ['mod+'] })],
    ['a key the browser keeps', file({ 'edit.undo': ['mod+w'] })],
    ['an extra field', { version: 1, bindings: {}, extra: true }],
    [
      'too many bindings for one action',
      file({
        'edit.undo': ['a', 'b', 'c', 'd', 'e'].slice(
          0,
          MAX_BINDINGS_PER_ACTION + 1,
        ),
      }),
    ],
    [
      'a list that is not a list',
      { version: 1, bindings: { 'edit.undo': 'a' } },
    ],
    ['text', 'nope'],
    ['null', null],
  ])('refuses %s', (_name, input) => {
    expect(keybindingsFileSchema.safeParse(input).success).toBe(false)
  })
})

describe('the effective bindings', () => {
  const defaults = file({
    'edit.undo': ['mod+z'],
    'edit.redo': ['mod+shift+z', 'mod+y'],
    'view.fit': ['digit0'.replace('digit', '')],
  })

  it('use the defaults when the user has changed nothing', () => {
    const result = effectiveBindings(defaults, file({}))
    expect(result['edit.undo']).toEqual(['mod+z'])
    expect(result['edit.redo']).toEqual(['mod+shift+z', 'mod+y'])
    expect(result['help.shortcuts']).toEqual([])
  })

  it('let an override replace the whole list for its action', () => {
    const result = effectiveBindings(defaults, file({ 'edit.redo': ['alt+r'] }))
    expect(result['edit.redo']).toEqual(['alt+r'])
    expect(result['edit.undo']).toEqual(['mod+z'])
  })

  it('leave an action with no key when the override is empty', () => {
    expect(
      effectiveBindings(defaults, file({ 'edit.undo': [] }))['edit.undo'],
    ).toEqual([])
  })

  it('drop a default key that the user gave to another action', () => {
    const result = effectiveBindings(
      defaults,
      file({ 'step.group': ['mod+z'] }),
    )
    expect(result['step.group']).toEqual(['mod+z'])
    expect(result['edit.undo']).toEqual([])
  })

  it('give every action an entry', () => {
    const result = effectiveBindings(file({}), file({}))
    expect(Object.keys(result)).toContain('tool.sharp.blur')
    expect(Object.keys(result)).toContain('edit.undo')
  })
})

describe('the conflicts', () => {
  const defaults = file({ 'edit.undo': ['mod+z'], 'view.fit': ['0'] })

  it('find nothing when no key is used twice', () => {
    expect(
      bindingConflicts(defaults, file({ 'step.group': ['alt+g'] })),
    ).toEqual([])
  })

  it('name each action that shares a key with an override', () => {
    expect(
      bindingConflicts(defaults, file({ 'step.group': ['mod+z'] })),
    ).toEqual([{ binding: 'mod+z', actionIds: ['edit.undo', 'step.group'] }])
  })

  it('find two overrides that share a key', () => {
    expect(
      bindingConflicts(
        file({}),
        file({ 'step.group': ['alt+g'], 'step.ungroup': ['alt+g'] }),
      ),
    ).toEqual([{ binding: 'alt+g', actionIds: ['step.group', 'step.ungroup'] }])
  })

  it('accept a swap, where the old holder is given up in the same file', () => {
    expect(
      bindingConflicts(
        defaults,
        file({ 'step.group': ['mod+z'], 'edit.undo': [] }),
      ),
    ).toEqual([])
  })
})

describe('reading a stored file', () => {
  it('keeps what is still valid and drops what no longer is', () => {
    const read = readStoredKeybindings({
      version: 1,
      bindings: {
        'view.fit': ['Alt+Z'],
        'edit.gone': ['alt+q'],
        'edit.undo': ['mod+w'],
        'edit.redo': ['alt+r', 'nonsense+'],
      },
    })
    expect(read.bindings).toEqual({ 'view.fit': ['alt+z'] })
  })

  it('still refuses a file that is not a key bindings file at all', () => {
    for (const bad of [
      null,
      'x',
      { version: 2, bindings: {} },
      { version: 1 },
      { version: 1, bindings: { a: 'b' } },
    ]) {
      expect(() => readStoredKeybindings(bad)).toThrow()
    }
  })

  it('ignores a prototype key', () => {
    const read = readStoredKeybindings(
      JSON.parse('{"version":1,"bindings":{"__proto__":["a"]}}'),
    )
    expect(read.bindings).toEqual({})
  })
})
