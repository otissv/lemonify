#!/usr/bin/env node
/**
 * The `lemonify-images` bin declared in package.json, so the CLI can be
 * linked onto the PATH (`pnpm link --global`) and run from any folder.
 * It runs the TypeScript entry point with Node's built-in type stripping,
 * silencing only that feature's experimental warning, as the `images`
 * package script does with `--disable-warning`.
 */
const TYPE_STRIPPING_WARNING = 'Type Stripping is an experimental feature'
const emitWarning = process.emitWarning.bind(process)

process.emitWarning = (warning, ...rest) => {
  const message = typeof warning === 'string' ? warning : warning.message
  if (message.startsWith(TYPE_STRIPPING_WARNING)) return
  emitWarning(warning, ...rest)
}

await import('./index.ts')
