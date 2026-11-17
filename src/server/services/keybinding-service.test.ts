import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConflictError, ValidationError } from '../errors.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

function file(bindings: Record<string, string[]>): unknown {
  return { version: 1, bindings }
}

describe('KeybindingService', () => {
  it('gives a User with no changes the defaults', async () => {
    const view = await t.app.keybindings.get(t.ann)
    expect(view.overrides.bindings).toEqual({})
    expect(view.updatedAt).toBeNull()
    expect(view.effective['edit.undo']).toEqual(['mod+z'])
  })

  it('saves a change and gives it back, for that User only', async () => {
    const saved = await t.app.keybindings.save(
      t.ann,
      file({ 'edit.redo': ['alt+r'] }),
    )
    expect(saved.effective['edit.redo']).toEqual(['alt+r'])
    expect(saved.updatedAt).not.toBeNull()
    expect((await t.app.keybindings.get(t.ann)).effective['edit.redo']).toEqual(
      ['alt+r'],
    )
    expect((await t.app.keybindings.get(t.bob)).effective['edit.redo']).toEqual(
      ['mod+shift+z', 'mod+y'],
    )
  })

  it('keeps only what differs from the defaults', async () => {
    const saved = await t.app.keybindings.save(
      t.ann,
      file({
        'edit.undo': ['mod+z'],
        'edit.redo': ['mod+y', 'mod+shift+z'],
        'view.fit': ['alt+z'],
      }),
    )
    expect(saved.overrides.bindings).toEqual({ 'view.fit': ['alt+z'] })
  })

  it('removes the record when nothing differs any more', async () => {
    await t.app.keybindings.save(t.ann, file({ 'view.fit': ['alt+z'] }))
    const saved = await t.app.keybindings.save(t.ann, file({}))
    expect(saved.updatedAt).toBeNull()
    expect(await t.app.database('keybindings').count({ n: '*' })).toEqual([
      { n: 0 },
    ])
  })

  it('refuses a file that is not valid, and keeps what was saved', async () => {
    await t.app.keybindings.save(t.ann, file({ 'view.fit': ['alt+z'] }))
    for (const bad of [
      file({ 'edit.nope': ['a'] }),
      file({ 'edit.undo': ['mod+w'] }),
      file({ 'edit.undo': ['a', 'b', 'c', 'd', 'e'] }),
      { version: 2, bindings: {} },
      'text',
      null,
    ]) {
      await expect(t.app.keybindings.save(t.ann, bad)).rejects.toBeInstanceOf(
        ValidationError,
      )
    }
    expect((await t.app.keybindings.get(t.ann)).overrides.bindings).toEqual({
      'view.fit': ['alt+z'],
    })
  })

  it('names the action that already has a key it is asked to give away', async () => {
    await expect(
      t.app.keybindings.save(t.ann, file({ 'step.group': ['mod+z'] })),
    ).rejects.toThrow(/Undo/)
    await expect(
      t.app.keybindings.save(t.ann, file({ 'step.group': ['mod+z'] })),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('accepts a swap saved as one file', async () => {
    const saved = await t.app.keybindings.save(
      t.ann,
      file({ 'step.group': ['mod+z'], 'edit.undo': [] }),
    )
    expect(saved.effective['step.group']).toEqual(['mod+z'])
    expect(saved.effective['edit.undo']).toEqual([])
  })

  it('sets one action and leaves the rest as they were', async () => {
    await t.app.keybindings.set(t.ann, 'view.fit', ['alt+z'])
    const view = await t.app.keybindings.set(t.ann, 'edit.redo', [])
    expect(view.overrides.bindings).toEqual({
      'view.fit': ['alt+z'],
      'edit.redo': [],
    })
    await expect(
      t.app.keybindings.set(t.ann, 'edit.nope', ['a']),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('keeps both changes when two are made at once', async () => {
    await Promise.all([
      t.app.keybindings.set(t.ann, 'view.fit', ['alt+z']),
      t.app.keybindings.set(t.ann, 'view.actualSize', ['alt+a']),
      t.app.keybindings.set(t.ann, 'edit.redo', []),
    ])
    expect((await t.app.keybindings.get(t.ann)).overrides.bindings).toEqual({
      'view.fit': ['alt+z'],
      'view.actualSize': ['alt+a'],
      'edit.redo': [],
    })
  })

  it('goes on with the next change after one is refused', async () => {
    const refused = t.app.keybindings.set(t.ann, 'view.fit', ['mod+w'])
    const kept = t.app.keybindings.set(t.ann, 'view.fit', ['alt+z'])
    await expect(refused).rejects.toBeInstanceOf(ValidationError)
    expect((await kept).effective['view.fit']).toEqual(['alt+z'])
  })

  it('resets one action, or all of them', async () => {
    await t.app.keybindings.set(t.ann, 'view.fit', ['alt+z'])
    await t.app.keybindings.set(t.ann, 'edit.redo', [])
    const one = await t.app.keybindings.reset(t.ann, 'edit.redo')
    expect(one.overrides.bindings).toEqual({ 'view.fit': ['alt+z'] })
    const all = await t.app.keybindings.reset(t.ann)
    expect(all.overrides.bindings).toEqual({})
    await expect(
      t.app.keybindings.reset(t.ann, 'edit.nope'),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('tells that User’s open tabs, and nobody else’s, when keys change', async () => {
    await t.app.keybindings.set(t.ann, 'view.fit', ['alt+z'])
    await t.app.keybindings.reset(t.ann)
    expect(
      t.changes.eventsFor(t.ann.userId).map((event) => event.type),
    ).toEqual(['keybindings.changed', 'keybindings.changed'])
    expect(t.changes.eventsFor(t.bob.userId)).toEqual([])
  })
})
