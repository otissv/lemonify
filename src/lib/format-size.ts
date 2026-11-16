const KILOBYTE = 1024
const UNITS = ['B', 'KB', 'MB', 'GB']

/** A file size in the largest unit that keeps it above 1, to one decimal: "749.4 KB". */
export function formatSize(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= KILOBYTE && unit < UNITS.length - 1) {
    value /= KILOBYTE
    unit += 1
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10
  return `${rounded} ${UNITS[unit]}`
}
