import type { SelectModifiers } from '@/features/documents/step-row'

interface PickInput {
  /** The ids of the steps that sit together with the clicked one (the top level, or one group), in display order. */
  siblings: ReadonlyArray<string>
  marked: ReadonlyArray<string>
  /** The step selected before the click. */
  anchor: string | undefined
  clicked: string
  modifiers: SelectModifiers
}

/** The steps picked together after a click: just the clicked one, or with the toggle key added to or taken out of those already picked, or with the range key all from the selected step to the clicked one. Only siblings can be picked together, since only they can be grouped. */
export function pickSteps({
  siblings,
  marked,
  anchor,
  clicked,
  modifiers,
}: PickInput): string[] {
  if (modifiers.range && anchor !== undefined) {
    const from = siblings.indexOf(anchor)
    const to = siblings.indexOf(clicked)
    if (from !== -1 && to !== -1) {
      return siblings.slice(Math.min(from, to), Math.max(from, to) + 1)
    }
  }
  if (modifiers.toggle) {
    const kept = marked.filter((id) => siblings.includes(id) && id !== clicked)
    return marked.includes(clicked) ? kept : [...kept, clicked]
  }
  return [clicked]
}
