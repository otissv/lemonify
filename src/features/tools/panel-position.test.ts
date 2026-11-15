import { describe, expect, it } from 'vitest'

import {
  KEYBOARD_STEP,
  KEYBOARD_STEP_LARGE,
  clampPosition,
  nudgePosition,
} from '@/features/tools/panel-position'

const PANEL = { width: 300, height: 400 }
const CONTAINER = { width: 1000, height: 800 }

describe('clampPosition', () => {
  it('keeps a position that already fits', () => {
    expect(clampPosition({ x: 100, y: 50 }, PANEL, CONTAINER)).toEqual({
      x: 100,
      y: 50,
    })
  })

  it('keeps the panel inside the container', () => {
    expect(clampPosition({ x: -20, y: 900 }, PANEL, CONTAINER)).toEqual({
      x: 0,
      y: 400,
    })
    expect(clampPosition({ x: 2000, y: -5 }, PANEL, CONTAINER)).toEqual({
      x: 700,
      y: 0,
    })
  })

  it('pins a panel larger than its container to the top left', () => {
    expect(
      clampPosition({ x: 50, y: 50 }, PANEL, { width: 200, height: 200 }),
    ).toEqual({ x: 0, y: 0 })
  })
})

describe('nudgePosition', () => {
  it.each([
    ['ArrowLeft', { x: 100 - KEYBOARD_STEP, y: 100 }],
    ['ArrowRight', { x: 100 + KEYBOARD_STEP, y: 100 }],
    ['ArrowUp', { x: 100, y: 100 - KEYBOARD_STEP }],
    ['ArrowDown', { x: 100, y: 100 + KEYBOARD_STEP }],
  ])('moves with %s', (key, expected) => {
    expect(nudgePosition({ x: 100, y: 100 }, key, false)).toEqual(expected)
  })

  it('moves further with Shift held', () => {
    expect(nudgePosition({ x: 100, y: 100 }, 'ArrowRight', true)).toEqual({
      x: 100 + KEYBOARD_STEP_LARGE,
      y: 100,
    })
  })

  it('returns null for other keys', () => {
    expect(nudgePosition({ x: 100, y: 100 }, 'Enter', false)).toBeNull()
  })
})
