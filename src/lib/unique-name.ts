function normalise(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** `base`, or `base 2`, `base 3` and so on: the first that no name in `taken` already is (ignoring case), within `max` characters. */
export function uniqueName(
  base: string,
  taken: ReadonlyArray<{ name: string }>,
  max: number,
): string {
  const used = new Set<string>()
  for (const { name } of taken) used.add(normalise(name))
  const trimmed = base.trim().slice(0, max).trim()
  if (!used.has(normalise(trimmed))) return trimmed
  for (let number = 2; ; number += 1) {
    const suffix = ` ${number}`
    const candidate = `${trimmed.slice(0, max - suffix.length).trim()}${suffix}`
    if (!used.has(normalise(candidate))) return candidate
  }
}
