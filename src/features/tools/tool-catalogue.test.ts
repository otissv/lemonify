import { describe, expect, it } from 'vitest'

import { AiOutput, AiToolId, WorkerPool } from '@/features/ai/ai-tools'
import { searchTools, toolGroups } from '@/features/tools/tool-catalogue'

const TOOL_GROUPS = toolGroups([
  {
    id: AiToolId.Upscale,
    label: 'Upscale',
    pool: WorkerPool.Gpu,
    output: AiOutput.Image,
  },
])

function names(
  groups: ReadonlyArray<{ tools: ReadonlyArray<{ label: string }> }>,
): Array<string> {
  return groups.flatMap(({ tools }) => tools.map(({ label }) => label))
}

describe('tool catalogue', () => {
  it('groups the tools as AI, Geometry, Filters and Colour, with no image tool: images are opened, inserted and replaced from the File menu', () => {
    expect(TOOL_GROUPS.map(({ label }) => label)).toEqual([
      'AI',
      'Geometry',
      'Filters',
      'Colour',
    ])
  })

  it('has every editing tool, 9 geometry, 18 filter and 9 colour, plus Upscale', () => {
    const counts = TOOL_GROUPS.map(({ tools }) => tools.length)

    expect(counts).toEqual([1, 9, 18, 9])
  })

  it('leaves out Composite, which layers do in a document', () => {
    expect(names(TOOL_GROUPS)).not.toContain('Composite')
  })

  it('leaves out the Output group, which Export covers', () => {
    const all = names(TOOL_GROUPS)

    expect(all).not.toContain('Jpeg')
    expect(all).not.toContain('Tile')
  })

  it('includes the tools that need a second image or a matrix', () => {
    const all = names(TOOL_GROUPS)

    for (const label of [
      'Join channel',
      'Boolean',
      'Affine',
      'Recomb',
      'Convolve',
    ])
      expect(all).toContain(label)
  })

  describe('searchTools', () => {
    it('keeps everything for an empty search', () => {
      expect(searchTools(TOOL_GROUPS, '  ')).toEqual(TOOL_GROUPS)
    })

    it('finds tools by part of a name, ignoring case and spaces', () => {
      expect(names(searchTools(TOOL_GROUPS, 'AUTO or'))).toEqual([
        'Auto orient',
      ])
    })

    it('has no AI group when the server offers no AI tools', () => {
      expect(toolGroups([]).map(({ label }) => label)).toEqual([
        'Geometry',
        'Filters',
        'Colour',
      ])
    })

    it('finds a tool by its op name', () => {
      expect(names(searchTools(TOOL_GROUPS, 'autoOrient'))).toEqual([
        'Auto orient',
      ])
    })

    it('leaves out groups with no match', () => {
      const found = searchTools(TOOL_GROUPS, 'blur')

      expect(found.map(({ label }) => label)).toEqual(['Filters'])
      expect(names(found)).toEqual(['Blur'])
    })

    it('finds nothing for a name no tool has', () => {
      expect(searchTools(TOOL_GROUPS, 'zzz')).toEqual([])
    })
  })
})
