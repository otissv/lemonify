import { describe, expect, it } from 'vitest'

import {
  assignBinding,
  clearBindings,
  resetBindings,
} from '@/features/keybindings/keybinding-edit'
import type { KeybindingsFile } from '@/features/keybindings/keybindings-file'

const NONE: KeybindingsFile = { version: 1, bindings: {} }
const EFFECTIVE = {
  'edit.undo': ['mod+z'],
  'edit.redo': ['mod+shift+z', 'mod+y'],
  'view.fit': ['0'],
  'step.group': [],
}

describe('assignBinding', () => {
  it('gives an action one key in place of its own', () => {
    const result = assignBinding(
      EFFECTIVE,
      NONE,
      'edit.redo',
      'Alt+R',
      'replace',
    )
    expect(result).toEqual({
      kind: 'ok',
      overrides: { version: 1, bindings: { 'edit.redo': ['alt+r'] } },
    })
  })

  it('adds a key to the keys an action has', () => {
    const result = assignBinding(EFFECTIVE, NONE, 'edit.redo', 'alt+r', 'add')
    expect(result).toEqual({
      kind: 'ok',
      overrides: {
        version: 1,
        bindings: { 'edit.redo': ['mod+shift+z', 'mod+y', 'alt+r'] },
      },
    })
  })

  it('changes nothing when an action already has the key it is given', () => {
    const result = assignBinding(EFFECTIVE, NONE, 'edit.redo', 'mod+y', 'add')
    expect(result).toEqual({ kind: 'ok', overrides: NONE })
  })

  it('keeps what else the User changed', () => {
    const overrides: KeybindingsFile = {
      version: 1,
      bindings: { 'view.fit': [] },
    }
    const result = assignBinding(
      EFFECTIVE,
      overrides,
      'step.group',
      'alt+g',
      'replace',
    )
    expect(result).toEqual({
      kind: 'ok',
      overrides: {
        version: 1,
        bindings: { 'view.fit': [], 'step.group': ['alt+g'] },
      },
    })
  })

  it('refuses a key that is not valid or that the browser keeps, saying why', () => {
    const wrong = assignBinding(
      EFFECTIVE,
      NONE,
      'step.group',
      'mod+w',
      'replace',
    )
    expect(wrong.kind).toBe('problem')
    const unreadable = assignBinding(
      EFFECTIVE,
      NONE,
      'step.group',
      '??',
      'replace',
    )
    expect(unreadable.kind).toBe('problem')
  })

  it('refuses a fifth key', () => {
    const full = { ...EFFECTIVE, 'step.group': ['a', 'b', 'c', 'd'] }
    const result = assignBinding(full, NONE, 'step.group', 'e', 'add')
    expect(result.kind).toBe('problem')
  })

  it('names the action that has the key, and offers to take it from there', () => {
    const result = assignBinding(
      EFFECTIVE,
      NONE,
      'step.group',
      'mod+z',
      'replace',
    )
    expect(result).toEqual({
      kind: 'conflict',
      binding: 'mod+z',
      holderId: 'edit.undo',
      reassign: {
        version: 1,
        bindings: { 'step.group': ['mod+z'], 'edit.undo': [] },
      },
    })
  })

  it('leaves the other keys of the action it takes the key from', () => {
    const result = assignBinding(
      EFFECTIVE,
      NONE,
      'step.group',
      'mod+y',
      'replace',
    )
    expect(
      result.kind === 'conflict' && result.reassign.bindings['edit.redo'],
    ).toEqual(['mod+shift+z'])
  })
})

describe('clearBindings and resetBindings', () => {
  it('leave an action with no key, and put it back', () => {
    const cleared = clearBindings(NONE, 'edit.undo')
    expect(cleared.bindings).toEqual({ 'edit.undo': [] })
    expect(resetBindings(cleared, 'edit.undo')).toEqual(NONE)
  })

  it('reset every action when none is named', () => {
    const changed: KeybindingsFile = {
      version: 1,
      bindings: { 'edit.undo': [], 'view.fit': ['alt+z'] },
    }
    expect(resetBindings(changed)).toEqual(NONE)
  })

  it('keep the other changes when one action is reset', () => {
    const changed: KeybindingsFile = {
      version: 1,
      bindings: { 'edit.undo': [], 'view.fit': ['alt+z'] },
    }
    expect(resetBindings(changed, 'edit.undo').bindings).toEqual({
      'view.fit': ['alt+z'],
    })
  })
})
