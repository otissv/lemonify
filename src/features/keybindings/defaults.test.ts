import { describe, expect, it } from 'vitest'

import { ACTIONS } from '@/features/keybindings/actions'
import { bindingProblem } from '@/features/keybindings/binding'
import { DEFAULT_KEYBINDINGS } from '@/features/keybindings/defaults'
import { bindingConflicts } from '@/features/keybindings/keybindings-file'

describe('the default key bindings', () => {
  it('name only actions that exist', () => {
    const ids = new Set(ACTIONS.map((action) => action.id))
    for (const id of Object.keys(DEFAULT_KEYBINDINGS.bindings)) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('give no key to two actions', () => {
    expect(
      bindingConflicts(DEFAULT_KEYBINDINGS, { version: 1, bindings: {} }),
    ).toEqual([])
  })

  it('use no key the browser keeps', () => {
    for (const list of Object.values(DEFAULT_KEYBINDINGS.bindings)) {
      for (const binding of list)
        expect(bindingProblem(binding), binding).toBeUndefined()
    }
  })

  it('are already written in their canonical form', () => {
    const raw = JSON.stringify(DEFAULT_KEYBINDINGS)
    expect(JSON.parse(raw)).toEqual(DEFAULT_KEYBINDINGS)
  })

  it('bind New document to a key', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['file.newDocument']).toEqual(['alt+n'])
  })

  it('bind undo, redo and the tools the app had keys for before', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['edit.undo']).toEqual(['mod+z'])
    expect(DEFAULT_KEYBINDINGS.bindings['edit.redo']).toContain('mod+shift+z')
  })
})
