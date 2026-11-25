import { describe, expect, it } from 'vitest'

import { AI_TOOL_IDS } from '@/features/ai/ai-tools'
import {
  ACTIONS,
  Page,
  actionById,
  isActionId,
  toolActionId,
} from '@/features/keybindings/actions'
import { DEFAULT_KEYBINDINGS } from '@/features/keybindings/defaults'
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

  it('each name the pages they apply on', () => {
    for (const action of ACTIONS) {
      expect(action.contexts.length, action.id).toBeGreaterThan(0)
    }
    const everywhere = [Page.Home, Page.Document, Page.Workflow]
    const editing = [Page.Document, Page.Workflow]
    expect(actionById('help.shortcuts')?.contexts).toEqual(everywhere)
    expect(actionById('file.newDocument')?.contexts).toEqual(everywhere)
    expect(actionById('view.sidebar')?.contexts).toEqual(everywhere)
    expect(actionById('edit.undo')?.contexts).toEqual(editing)
    expect(actionById('step.delete')?.contexts).toEqual(editing)
    expect(actionById('view.zoomIn')?.contexts).toEqual(editing)
    expect(actionById('panel.tools')?.contexts).toEqual(editing)
    expect(actionById('file.close')?.contexts).toEqual(editing)
    expect(actionById(toolActionId('sharp', 'blur'))?.contexts).toEqual(editing)
    expect(actionById('edit.insertImage')?.contexts).toEqual([Page.Document])
    expect(actionById('edit.showOriginal')?.contexts).toEqual([Page.Document])
    expect(actionById('file.exportImage')?.contexts).toEqual([Page.Document])
    expect(actionById('panel.navigator')?.contexts).toEqual([Page.Document])
    expect(actionById('view.stepPreview')?.contexts).toEqual([Page.Workflow])
  })

  it('include setting the canvas size, on documents and workflows', () => {
    const setCanvas = actionById('edit.setCanvas')
    expect(setCanvas?.label).toBe('Canvas size')
    expect(setCanvas?.group).toBe('Edit')
    expect(setCanvas?.contexts).toEqual([Page.Document, Page.Workflow])
    expect(DEFAULT_KEYBINDINGS.bindings['edit.setCanvas']).toEqual(['alt+c'])
  })

  it('say which actions repeat while the key is held', () => {
    expect(actionById('view.panLeft')?.repeats).toBe(true)
    expect(actionById('view.zoomIn')?.repeats).toBe(true)
    expect(actionById('edit.undo')?.repeats).toBe(false)
    expect(actionById('file.openImage')?.repeats).toBe(false)
  })
})
