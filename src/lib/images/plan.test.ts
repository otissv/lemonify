import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { mirroredPath, planWidths, variantPath } from './plan.ts'

const TARGETS = [480, 768, 1280, 1920]

describe('planWidths', () => {
  it('keeps every target width the source can fill', () => {
    expect(planWidths(3840, TARGETS)).toEqual([480, 768, 1280, 1920])
  })

  it('keeps the largest target when the source matches it exactly', () => {
    expect(planWidths(1920, TARGETS)).toEqual([480, 768, 1280, 1920])
  })

  it('never upscales and adds the source width as the top variant', () => {
    expect(planWidths(1080, TARGETS)).toEqual([480, 768, 1080])
  })

  it('does not duplicate a source width that equals a target', () => {
    expect(planWidths(768, TARGETS)).toEqual([480, 768])
  })

  it('returns only the source width below the smallest target', () => {
    expect(planWidths(320, TARGETS)).toEqual([320])
  })

  it('uses the width list it is given', () => {
    expect(planWidths(1000, [640, 1280])).toEqual([640, 1000])
  })
})

describe('variantPath', () => {
  const sourceRoot = path.resolve('/photos')
  const destination = path.resolve('/out')

  it('names a variant <name>-<width><extension> in the destination', () => {
    expect(
      variantPath({
        sourceFile: path.join(sourceRoot, 'beach.jpg'),
        sourceRoot,
        destination,
        width: 640,
        extension: '.avif',
      }),
    ).toBe(path.join(destination, 'beach-640.avif'))
  })

  it('keeps the subfolder structure below the source root', () => {
    expect(
      variantPath({
        sourceFile: path.join(sourceRoot, '2026', 'summer', 'beach.png'),
        sourceRoot,
        destination,
        width: 1280,
        extension: '.webp',
      }),
    ).toBe(path.join(destination, '2026', 'summer', 'beach-1280.webp'))
  })

  it('keeps dots inside the file name', () => {
    expect(
      variantPath({
        sourceFile: path.join(sourceRoot, 'team.photo.v2.jpeg'),
        sourceRoot,
        destination,
        width: 480,
        extension: '.jpeg',
      }),
    ).toBe(path.join(destination, 'team.photo.v2-480.jpeg'))
  })
})

describe('mirroredPath', () => {
  it('maps a source file to the same relative path in the destination', () => {
    const sourceRoot = path.resolve('/photos')
    expect(
      mirroredPath(
        path.join(sourceRoot, 'a', 'b.jpg'),
        sourceRoot,
        path.resolve('/out'),
      ),
    ).toBe(path.join(path.resolve('/out'), 'a', 'b.jpg'))
  })
})
