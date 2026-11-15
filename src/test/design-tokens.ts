import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DESIGN = readFileSync(
  resolve(import.meta.dirname, '../../DESIGN.md'),
  'utf8',
)

export enum DesignSection {
  Colors = '## Tokens — Colors',
  TypeScale = '### Type Scale',
  Spacing = '### Spacing Scale',
  Radius = '### Border Radius',
}

const VALUE_COLUMN = 2

export interface DesignToken {
  token: string
  value: string
}

function sectionOf(heading: DesignSection): string {
  const start = DESIGN.indexOf(heading)
  if (start === -1) throw new Error(`DESIGN.md has no "${heading}" section`)
  const rest = DESIGN.slice(start + heading.length)
  const end = rest.search(/\n#{2,3} /)
  return end === -1 ? rest : rest.slice(0, end)
}

export function designTokens(section: DesignSection): Array<DesignToken> {
  const tokens: Array<DesignToken> = []
  for (const line of sectionOf(section).split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim())
    const token = cells.find((cell) => /^`--[\w-]+`$/.test(cell))
    if (!token) continue
    tokens.push({
      token: token.slice(1, -1),
      value: (cells[VALUE_COLUMN] ?? '').replaceAll('`', ''),
    })
  }
  return tokens
}

/** The body rows of the first table in a section, one array of trimmed cells per row. */
export function designTableRows(section: DesignSection): Array<Array<string>> {
  const rows: Array<Array<string>> = []
  for (const line of sectionOf(section).split('\n')) {
    if (!line.startsWith('|') || /^\|[\s|:-]+\|$/.test(line)) continue
    rows.push(
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
  }
  return rows.slice(1)
}

export function designTokenKeys(
  section: DesignSection,
  prefix: string,
): Array<string> {
  const keys: Array<string> = []
  for (const { token } of designTokens(section)) {
    keys.push(token.slice(prefix.length))
  }
  return keys
}
