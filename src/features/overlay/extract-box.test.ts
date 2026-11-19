import { describe, expect, it } from 'vitest'

import { extractBox, withExtractBox } from '@/features/overlay/extract-box'

const BOUNDS = { width: 1000, height: 500 }

describe('extractBox', () => {
  it('is the region the step takes', () => {
    expect(
      extractBox({ left: 10, top: 20, width: 300, height: 200 }, BOUNDS),
    ).toEqual({ left: 10, top: 20, width: 300, height: 200 })
  })

  it('is the whole picture while the step has no region yet', () => {
    expect(extractBox({}, BOUNDS)).toEqual({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
    })
    expect(extractBox({ left: 10 }, BOUNDS)).toEqual({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
    })
  })

  it('is the whole picture when a value is not a usable number', () => {
    expect(
      extractBox({ left: -1, top: 0, width: 10, height: 10 }, BOUNDS),
    ).toEqual({ left: 0, top: 0, width: 1000, height: 500 })
    expect(
      extractBox({ left: 0, top: 0, width: 0, height: 10 }, BOUNDS),
    ).toEqual({ left: 0, top: 0, width: 1000, height: 500 })
    expect(
      extractBox({ left: 0.5, top: 0, width: 10, height: 10 }, BOUNDS),
    ).toEqual({ left: 0, top: 0, width: 1000, height: 500 })
    expect(
      extractBox({ left: '0', top: 0, width: 10, height: 10 }, BOUNDS),
    ).toEqual({ left: 0, top: 0, width: 1000, height: 500 })
  })

  it('is cut to the picture when the region was set for a bigger one', () => {
    expect(
      extractBox({ left: 900, top: 0, width: 300, height: 100 }, BOUNDS),
    ).toEqual({ left: 900, top: 0, width: 100, height: 100 })
  })
})

describe('withExtractBox', () => {
  it('sets the four values and keeps everything else', () => {
    expect(
      withExtractBox(
        { left: 1, top: 1, width: 1, height: 1, other: 'kept' },
        { left: 5, top: 6, width: 7, height: 8 },
      ),
    ).toEqual({ left: 5, top: 6, width: 7, height: 8, other: 'kept' })
  })
})
