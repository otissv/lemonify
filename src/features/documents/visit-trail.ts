/** The documents and workflows opened in this browser tab, oldest first; the last is the one on screen. */
export type VisitTrail = ReadonlyArray<string>

export type VisitedKind = 'document' | 'workflow'

/** A document or workflow that exists, with which it is, so closing one can go to the other kind. */
export type VisitedItem = { id: string; kind: VisitedKind }

export function visitInTrail(trail: VisitTrail, id: string): VisitTrail {
  if (trail.at(-1) === id) return trail
  return [...trail.filter((visited) => visited !== id), id]
}

export function closeInTrail(trail: VisitTrail, id: string): VisitTrail {
  return trail.filter((visited) => visited !== id)
}

/**
 * Where closing a page goes: the document or workflow opened most recently
 * before it that still exists, or undefined when there is none (the welcome page).
 */
export function previousVisit(
  trail: VisitTrail,
  closing: string,
  existing: ReadonlyArray<VisitedItem>,
): VisitedItem | undefined {
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    const id = trail[index]
    if (id === undefined || id === closing) continue
    const found = existing.find((item) => item.id === id)
    if (found !== undefined) return found
  }
  return undefined
}
