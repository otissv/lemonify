import { describe, expect, it } from 'vitest'

import {
  actionForKeyEvent,
  buildBindingIndex,
  isIgnoredTarget,
} from '@/features/keybindings/key-dispatch'
import type { DispatchEvent } from '@/features/keybindings/key-dispatch'

const INDEX = buildBindingIndex({
  'edit.undo': ['mod+z'],
  'edit.redo': ['mod+shift+z', 'mod+y'],
  'view.fit': ['0'],
  'view.panLeft': ['arrowleft'],
  'view.panLeftFar': ['shift+arrowleft'],
  'step.group': [],
})

function key(code: string, extra: Partial<DispatchEvent> = {}): DispatchEvent {
  return {
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: document.body,
    ...extra,
  }
}

describe('the action for a key press', () => {
  it('finds the action whose binding matches, with mod as Ctrl or Cmd by system', () => {
    expect(
      actionForKeyEvent(key('KeyZ', { ctrlKey: true }), INDEX, false)?.id,
    ).toBe('edit.undo')
    expect(
      actionForKeyEvent(key('KeyZ', { metaKey: true }), INDEX, true)?.id,
    ).toBe('edit.undo')
    expect(
      actionForKeyEvent(key('KeyZ', { metaKey: true }), INDEX, false),
    ).toBeUndefined()
    expect(
      actionForKeyEvent(
        key('KeyZ', { ctrlKey: true, shiftKey: true }),
        INDEX,
        false,
      )?.id,
    ).toBe('edit.redo')
  })

  it('tells shifted and plain keys apart', () => {
    expect(actionForKeyEvent(key('ArrowLeft'), INDEX, false)?.id).toBe(
      'view.panLeft',
    )
    expect(
      actionForKeyEvent(key('ArrowLeft', { shiftKey: true }), INDEX, false)?.id,
    ).toBe('view.panLeftFar')
  })

  it('finds nothing for a key with no binding, or an action left with no key', () => {
    expect(actionForKeyEvent(key('KeyQ'), INDEX, false)).toBeUndefined()
    expect(
      actionForKeyEvent(key('KeyG', { altKey: true }), INDEX, false),
    ).toBeUndefined()
  })

  it('leaves alone a key press something else already handled, or in the middle of composing text', () => {
    expect(
      actionForKeyEvent(
        key('Digit0', { defaultPrevented: true }),
        INDEX,
        false,
      ),
    ).toBeUndefined()
    expect(
      actionForKeyEvent(key('Digit0', { isComposing: true }), INDEX, false),
    ).toBeUndefined()
  })

  it('repeats only the actions that are meant to repeat', () => {
    expect(
      actionForKeyEvent(key('ArrowLeft', { repeat: true }), INDEX, false)?.id,
    ).toBe('view.panLeft')
    expect(
      actionForKeyEvent(key('Digit0', { repeat: true }), INDEX, false),
    ).toBeUndefined()
    expect(
      actionForKeyEvent(
        key('KeyZ', { ctrlKey: true, repeat: true }),
        INDEX,
        false,
      ),
    ).toBeUndefined()
  })

  it('leaves alone key presses in a field, a menu or a dialog', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const item = document.createElement('div')
    menu.append(item)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    dialog.append(inner)
    document.body.append(editable, menu, dialog)

    for (const target of [input, area, editable, item, inner]) {
      expect(isIgnoredTarget(target), target.outerHTML).toBe(true)
      expect(
        actionForKeyEvent(key('Digit0', { target }), INDEX, false),
      ).toBeUndefined()
    }
    for (const target of [
      document.body,
      null,
      document.createElement('button'),
    ]) {
      expect(isIgnoredTarget(target)).toBe(false)
    }
    editable.remove()
    menu.remove()
    dialog.remove()
  })

  it('ignores a binding that cannot be read rather than failing', () => {
    const index = buildBindingIndex({
      'edit.undo': ['mod+'],
      'view.fit': ['0'],
    })
    expect(actionForKeyEvent(key('Digit0'), index, false)?.id).toBe('view.fit')
  })
})
