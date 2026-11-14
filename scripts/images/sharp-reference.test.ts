// @vitest-environment node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { renderSharpReference } from '../../src/lib/images/sharp/reference.ts'
import {
  SHARP_REFERENCE_FILE,
  formatSharpReference,
} from './sharp-reference.ts'

describe('doc/cli-sharp-reference.md', () => {
  it('matches the schemas; regenerate it with scripts/images/gen-sharp-reference.ts', async () => {
    const file = path.resolve(SHARP_REFERENCE_FILE)
    const committed = await readFile(file, 'utf8')
    expect(committed).toBe(
      await formatSharpReference(renderSharpReference(), file),
    )
  })
})
