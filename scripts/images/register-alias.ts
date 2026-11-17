/**
 * Lets Node load the app's own TypeScript, which imports with `@/` (a path
 * under `src/`, as `tsconfig.json` and Vite say). Loaded with `--import`
 * before the CLI starts.
 */
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ALIAS = '@/'
const EXACT_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.json'])
const SOURCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src',
)

function candidatesFor(specifier: string): string[] {
  const base = path.join(SOURCE_ROOT, specifier.slice(ALIAS.length))
  if (EXACT_EXTENSIONS.has(path.extname(base))) return [base]
  return [`${base}.ts`, path.join(base, 'index.ts')]
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(ALIAS)) return nextResolve(specifier, context)
    const found = candidatesFor(specifier).find((file) => existsSync(file))
    if (found === undefined) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(found).href, context)
  },
})
