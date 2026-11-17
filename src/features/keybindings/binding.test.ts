import { describe, expect, it } from 'vitest'

import {
  ariaKeyShortcuts,
  bindingFromEvent,
  bindingProblem,
  eventMatches,
  formatBinding,
  parseBinding,
} from '@/features/keybindings/binding'

function event(
  code: string,
  modifiers: Partial<{
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
  }> = {},
) {
  return {
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  }
}

describe('parseBinding', () => {
  it('reads a key with modifiers and writes it in one order', () => {
    expect(parseBinding('Shift+Mod+Z')).toEqual({
      text: 'mod+shift+z',
      mod: true,
      alt: false,
      shift: true,
      code: 'KeyZ',
    })
    expect(parseBinding(' alt+mod+shift+1 ')?.text).toBe('mod+alt+shift+1')
  })

  it('reads letters, digits, function keys and named keys', () => {
    for (const text of [
      'a',
      '0',
      'f1',
      'f12',
      'delete',
      'arrowleft',
      'equal',
      'minus',
      'bracketleft',
      'numpadadd',
      'home',
    ]) {
      expect(parseBinding(text)?.text).toBe(text)
    }
  })

  it('refuses what is not a binding', () => {
    for (const text of [
      '',
      '+',
      'mod',
      'mod+',
      'mod+mod+z',
      'z+mod',
      'ctrl+z',
      'meta+z',
      'ab',
      'f13',
      'mod+shift',
      'shift+shift+a',
      'mod+space+a',
      'Ctrl-Z',
    ]) {
      expect(parseBinding(text)).toBeUndefined()
    }
  })
})

describe('bindingProblem', () => {
  it('accepts ordinary bindings', () => {
    for (const text of [
      'mod+z',
      'g',
      'shift+g',
      'alt+shift+b',
      'delete',
      'f2',
    ]) {
      expect(bindingProblem(text)).toBeUndefined()
    }
  })

  it('names a binding that is not one', () => {
    expect(bindingProblem('ctrl+z')).toMatch(/not a key binding/)
  })

  it('refuses combinations the browser keeps', () => {
    for (const text of [
      'mod+t',
      'mod+w',
      'mod+n',
      'mod+shift+t',
      'mod+r',
      'mod+l',
      'mod+1',
      'mod+9',
      'mod+tab',
      'mod+0',
      'mod+equal',
      'mod+minus',
      'f5',
      'f11',
      'f12',
      'alt+arrowleft',
      'mod+c',
      'mod+v',
      'mod+x',
      'mod+a',
      'mod+s',
      'mod+p',
      'mod+f',
      'mod+shift+i',
    ]) {
      expect(bindingProblem(text), text).toMatch(/browser/)
    }
  })

  it('refuses keys that already do something on their own', () => {
    for (const text of [
      'enter',
      'space',
      'tab',
      'escape',
      'shift+tab',
      'shift+enter',
    ]) {
      expect(bindingProblem(text), text).toMatch(/already/)
    }
    expect(bindingProblem('mod+enter')).toBeUndefined()
  })
})

describe('eventMatches', () => {
  const binding = parseBinding('mod+shift+z')
  if (binding === undefined) throw new Error('expected a binding')

  it('takes mod as Ctrl on other systems and as Cmd on a Mac, and never both', () => {
    const ctrl = event('KeyZ', { ctrlKey: true, shiftKey: true })
    const meta = event('KeyZ', { metaKey: true, shiftKey: true })
    const both = event('KeyZ', { ctrlKey: true, metaKey: true, shiftKey: true })

    expect(eventMatches(ctrl, binding, false)).toBe(true)
    expect(eventMatches(meta, binding, false)).toBe(false)
    expect(eventMatches(meta, binding, true)).toBe(true)
    expect(eventMatches(ctrl, binding, true)).toBe(false)
    expect(eventMatches(both, binding, false)).toBe(false)
  })

  it('needs exactly the modifiers the binding names', () => {
    expect(eventMatches(event('KeyZ', { ctrlKey: true }), binding, false)).toBe(
      false,
    )
    expect(
      eventMatches(
        event('KeyZ', { ctrlKey: true, shiftKey: true, altKey: true }),
        binding,
        false,
      ),
    ).toBe(false)
    const plain = parseBinding('g')
    if (plain === undefined) throw new Error('expected a binding')
    expect(eventMatches(event('KeyG'), plain, false)).toBe(true)
    expect(eventMatches(event('KeyG', { shiftKey: true }), plain, false)).toBe(
      false,
    )
    expect(eventMatches(event('KeyG', { ctrlKey: true }), plain, false)).toBe(
      false,
    )
  })

  it('goes by the physical key, so another layout still works', () => {
    const plain = parseBinding('g')
    if (plain === undefined) throw new Error('expected a binding')
    expect(eventMatches(event('KeyG'), plain, false)).toBe(true)
    expect(eventMatches(event('KeyH'), plain, false)).toBe(false)
  })
})

describe('bindingFromEvent', () => {
  it('writes the key that was pressed as a binding', () => {
    expect(
      bindingFromEvent(event('KeyZ', { ctrlKey: true, shiftKey: true }), false),
    ).toBe('mod+shift+z')
    expect(bindingFromEvent(event('KeyZ', { metaKey: true }), true)).toBe(
      'mod+z',
    )
    expect(bindingFromEvent(event('Digit5', { altKey: true }), false)).toBe(
      'alt+5',
    )
    expect(bindingFromEvent(event('Delete'), false)).toBe('delete')
  })

  it('has nothing to say for a modifier on its own or a key it cannot name', () => {
    expect(
      bindingFromEvent(event('ShiftLeft', { shiftKey: true }), false),
    ).toBeUndefined()
    expect(
      bindingFromEvent(event('ControlLeft', { ctrlKey: true }), false),
    ).toBeUndefined()
    expect(bindingFromEvent(event('IntlRo'), false)).toBeUndefined()
  })

  it('ignores the wrong system’s modifier', () => {
    expect(
      bindingFromEvent(event('KeyZ', { metaKey: true }), false),
    ).toBeUndefined()
    expect(
      bindingFromEvent(event('KeyZ', { ctrlKey: true }), true),
    ).toBeUndefined()
  })
})

describe('formatBinding', () => {
  it('shows a binding the way the system writes it', () => {
    expect(formatBinding('mod+shift+z', false)).toBe('Ctrl+Shift+Z')
    expect(formatBinding('mod+shift+z', true)).toBe('⌘⇧Z')
    expect(formatBinding('alt+arrowleft', false)).toBe('Alt+←')
    expect(formatBinding('delete', false)).toBe('Delete')
    expect(formatBinding('equal', false)).toBe('=')
    expect(formatBinding('mod+alt+1', true)).toBe('⌘⌥1')
  })
})

describe('keys the browser keeps', () => {
  it.each([
    'alt+e',
    'alt+f',
    'mod+bracketleft',
    'mod+shift+bracketright',
    'mod+w',
  ])('refuses %s', (text) => {
    expect(bindingProblem(text)).toMatch(/kept by the browser/)
  })
})

describe('ariaKeyShortcuts', () => {
  it('writes a binding the way aria-keyshortcuts does, for the system', () => {
    expect(ariaKeyShortcuts('mod+shift+z', false)).toBe('Control+Shift+Z')
    expect(ariaKeyShortcuts('mod+shift+z', true)).toBe('Meta+Shift+Z')
    expect(ariaKeyShortcuts('arrowleft', false)).toBe('ArrowLeft')
    expect(ariaKeyShortcuts('alt+0', false)).toBe('Alt+0')
    expect(ariaKeyShortcuts('shift+slash', false)).toBe('Shift+/')
    expect(ariaKeyShortcuts('numpadadd', false)).toBe('Plus')
    expect(ariaKeyShortcuts('delete', false)).toBe('Delete')
    expect(ariaKeyShortcuts('nope+', false)).toBeUndefined()
  })
})
