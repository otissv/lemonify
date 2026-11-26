import { describe, expect, it } from 'vitest'

import { sidebarTabTarget } from '@/features/app/sidebar-tab-nav'
import { SidebarTab } from '@/store/ui-store'

const DOCS = [
  { id: 'd-old', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'd-new', updatedAt: '2026-01-02T00:00:00.000Z' },
]
const WORKFLOWS = [{ id: 'w1', updatedAt: '2026-01-01T00:00:00.000Z' }]

describe('sidebarTabTarget', () => {
  it('prefers the last visit of that kind', () => {
    expect(
      sidebarTabTarget(SidebarTab.Workflow, ['d-new', 'w1'], DOCS, WORKFLOWS),
    ).toEqual({ kind: 'workflow', id: 'w1' })
    expect(
      sidebarTabTarget(SidebarTab.Editor, ['w1', 'd-old'], DOCS, WORKFLOWS),
    ).toEqual({ kind: 'document', id: 'd-old' })
  })

  it('opens the newest item when nothing of that kind was visited', () => {
    expect(
      sidebarTabTarget(SidebarTab.Editor, ['w1'], DOCS, WORKFLOWS),
    ).toEqual({ kind: 'document', id: 'd-new' })
  })

  it('goes home when there is nothing to open', () => {
    expect(sidebarTabTarget(SidebarTab.Workflow, [], DOCS, [])).toEqual({
      kind: 'home',
    })
  })
})
