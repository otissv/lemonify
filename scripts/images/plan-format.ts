import { displayPath } from '../../src/lib/images/display-path.ts'
import type { PlannedWrite, WritePlan } from '../../src/lib/images/dry-run.ts'

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function describeSource(source: PlannedWrite['source']): string {
  if (source === null) return ''
  const files = Array.isArray(source) ? source : [source]
  const shown: string[] = []
  for (const file of files) shown.push(displayPath(file))
  return ` from ${shown.join(', ')}`
}

function describeWrite(write: PlannedWrite, detail: string): string {
  const notes: string[] = []
  if (detail !== '') notes.push(detail)
  if (write.kind === 'inPlace') notes.push('rewritten in place')
  else if (write.exists) notes.push('replaces an existing file')
  const suffix = notes.length === 0 ? '' : ` (${notes.join(', ')})`
  if (write.kind === 'inPlace') return `${displayPath(write.file)}${suffix}`
  return `${displayPath(write.file)}${describeSource(write.source)}${suffix}`
}

/** Human-readable dry-run output: one line per file to write, then totals. */
export function formatWritePlan<TWrite extends PlannedWrite>(
  plan: WritePlan<TWrite>,
  detail: (write: TWrite) => string = () => '',
): string {
  const lines: string[] = []
  let existing = 0
  for (const write of plan.writes) {
    lines.push(describeWrite(write, detail(write)))
    if (write.exists) existing += 1
  }
  const replaced = existing === 0 ? '' : `, ${existing} already exist`
  lines.push(
    `Would write ${plural(plan.writes.length, 'file')}, read ${plan.reads.length}${replaced}. Nothing was written.`,
  )
  return lines.join('\n')
}
