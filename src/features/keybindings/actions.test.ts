import { describe, expect, it } from 'vitest'

import { AI_TOOL_IDS } from '@/features/ai/ai-tools'
import {
  ACTIONS,
  actionById,
  isActionId,
  toolActionId,
} from '@/features/keybindings/actions'
import { toolGroups } from '@/features/tools/tool-catalogue'

describe('the actions', () => {
  it('each have an id of their own, a label and a group', () => {
    const ids = new Set<string>()
    for (const action of ACTIONS) {
      expect(action.id).toMatch(/^[a-z]+(\.[A-Za-z0-9]+)+$/)
      expect(action.label.trim()).not.toBe('')
      expect(action.group.trim()).not.toBe('')
      ids.add(action.id)
    }
    expect(ids.size).toBe(ACTIONS.length)
  })

  it('include one for every tool that can be added to a document', () => {
    const summaries = AI_TOOL_IDS.map((id) => ({ id }) as never)
    for (const group of toolGroups(summaries)) {
      for (const tool of group.tools) {
        const id = toolActionId(tool.kind, tool.value)
        expect(isActionId(id), id).toBe(true)
        expect(actionById(id)?.label).toContain(tool.label)
      }
    }
  })

  it('find an action by id, and say which ids are not actions', () => {
    expect(actionById('edit.undo')?.label).toBe('Undo')
    expect(actionById('nope')).toBeUndefined()
    expect(isActionId('edit.undo')).toBe(true)
    expect(isActionId('edit.nope')).toBe(false)
    expect(isActionId('__proto__')).toBe(false)
    expect(isActionId('constructor')).toBe(false)
  })

  it('say which actions repeat while the key is held', () => {
    expect(actionById('view.panLeft')?.repeats).toBe(true)
    expect(actionById('view.zoomIn')?.repeats).toBe(true)
    expect(actionById('edit.undo')?.repeats).toBe(false)
    expect(actionById('file.openImage')?.repeats).toBe(false)
  })
})
