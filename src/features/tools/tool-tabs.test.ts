import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_TOOLS,
  WORKFLOW_TOOLS,
  shownTool,
} from '@/features/tools/tool-tabs'
import { Tool } from '@/store/ui-store'

describe('the tabs of each panel', () => {
  it('give a workflow nothing that is only about a document', () => {
    for (const tool of [
      Tool.Export,
      Tool.Results,
      Tool.Document,
      Tool.Navigator,
    ]) {
      expect(WORKFLOW_TOOLS).not.toContain(tool)
    }
  })

  it('share Tools and Options, which are all a workflow has; its runs are beside the diagram', () => {
    expect(DOCUMENT_TOOLS.slice(0, 2)).toEqual([Tool.Tools, Tool.Options])
    expect(WORKFLOW_TOOLS).toEqual([Tool.Tools, Tool.Options])
  })
})

describe('shownTool', () => {
  it('is the active tool when the panel has it', () => {
    expect(shownTool(DOCUMENT_TOOLS, Tool.Export, false)).toBe(Tool.Export)
  })

  it('falls back to Tools for a tab the panel does not have, such as one left over from the other page', () => {
    expect(shownTool(WORKFLOW_TOOLS, Tool.Navigator, true)).toBe(Tool.Tools)
    expect(shownTool(WORKFLOW_TOOLS, Tool.Export, true)).toBe(Tool.Tools)
  })

  it('falls back to Tools for Options when nothing is selected', () => {
    expect(shownTool(WORKFLOW_TOOLS, Tool.Options, false)).toBe(Tool.Tools)
    expect(shownTool(WORKFLOW_TOOLS, Tool.Options, true)).toBe(Tool.Options)
  })
})
