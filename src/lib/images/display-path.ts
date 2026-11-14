import path from 'node:path'

/** A path for CLI output: relative when inside `base`, absolute otherwise, so it never becomes a chain of `../`. */
export function displayPath(
  file: string,
  base: string = process.cwd(),
): string {
  const absolute = path.resolve(file)
  const relative = path.relative(base, absolute)
  if (relative === '') return '.'
  const outside =
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  return outside ? absolute : relative
}
