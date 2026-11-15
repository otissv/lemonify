import { describe, expect, it } from 'vitest'

import {
  extensionOfFormat,
  mediaTypeOfFormat,
  fileNameForFormat,
} from './image-formats.ts'

describe('image formats', () => {
  it('names the extension and media type of a format', () => {
    expect(extensionOfFormat('jpeg')).toBe('.jpg')
    expect(mediaTypeOfFormat('jpeg')).toBe('image/jpeg')
    expect(extensionOfFormat('webp')).toBe('.webp')
    expect(mediaTypeOfFormat('raw')).toBe('application/octet-stream')
  })

  it('falls back for a format it does not know', () => {
    expect(extensionOfFormat('svg')).toBe('.svg')
    expect(mediaTypeOfFormat('svg')).toBe('application/octet-stream')
  })

  it('swaps an image extension of a name and keeps other dots', () => {
    expect(fileNameForFormat('holiday.jpeg', 'png')).toBe('holiday.png')
    expect(fileNameForFormat('no-extension', 'webp')).toBe('no-extension.webp')
    expect(fileNameForFormat('.hidden', 'png')).toBe('.hidden.png')
    expect(fileNameForFormat('my.photo', 'jpeg')).toBe('my.photo.jpg')
    expect(fileNameForFormat('Holiday.JPG', 'jpeg')).toBe('Holiday.jpg')
  })
})
