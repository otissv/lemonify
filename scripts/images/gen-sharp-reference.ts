/**
 * Regenerates doc/cli-sharp-reference.md from the sharp job schemas.
 * Run after changing an op, option or job field:
 * `node --disable-warning=ExperimentalWarning scripts/images/gen-sharp-reference.ts`
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { renderSharpReference } from '../../src/lib/images/sharp/reference.ts'
import { SHARP_REFERENCE_FILE } from './sharp-reference.ts'

const file = path.resolve(SHARP_REFERENCE_FILE)
await writeFile(file, renderSharpReference())
console.log(`Wrote ${SHARP_REFERENCE_FILE}`)
