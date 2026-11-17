import {
  lastVisitOfKind,
  type VisitTrail,
  type VisitedItem,
} from '@/features/documents/visit-trail'
import { SidebarTab } from '@/store/ui-store'

export type SidebarTabTarget =
  | { kind: 'home' }
  | { kind: 'document'; id: string }
  | { kind: 'workflow'; id: string }

interface ListedItem {
  id: string
  updatedAt: string
}

/** Where switching to a sidebar tab should open: the last visit of that kind, or the newest item. */
export function sidebarTabTarget(
  tab: SidebarTab,
  trail: VisitTrail,
  documents: ReadonlyArray<ListedItem>,
  workflows: ReadonlyArray<ListedItem>,
): SidebarTabTarget {
  const kind = tab === SidebarTab.Editor ? 'document' : 'workflow'
  const existing: VisitedItem[] = [
    ...documents.map(({ id }) => ({ id, kind: 'document' as const })),
    ...workflows.map(({ id }) => ({ id, kind: 'workflow' as const })),
  ]
  const fromTrail = lastVisitOfKind(trail, kind, existing)
  if (fromTrail !== undefined) {
    return { kind: fromTrail.kind, id: fromTrail.id }
  }
  const list = kind === 'document' ? documents : workflows
  const newest = [...list].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )[0]
  if (newest !== undefined) return { kind, id: newest.id }
  return { kind: 'home' }
}