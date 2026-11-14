// @vitest-environment node
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { displayPath } from './display-path.ts'

const ROOT = path.resolve('/project')

describe('displayPath', () => {
  it('shows files inside the base folder relative to it', () => {
    expect(displayPath(path.join(ROOT, 'out', 'a.jpg'), ROOT)).toBe(
      path.join('out', 'a.jpg'),
    )
  })

  it('shows files outside the base folder as absolute paths', () => {
    const file = path.resolve('/tmp/out/a.jpg')
    expect(displayPath(file, ROOT)).toBe(file)
  })

  it('does not treat a sibling folder with a shared prefix as inside', () => {
    const file = path.resolve('/project-other/a.jpg')
    expect(displayPath(file, ROOT)).toBe(file)
  })

  it('shows the base folder itself as "."', () => {
    expect(displayPath(ROOT, ROOT)).toBe('.')
  })
})
