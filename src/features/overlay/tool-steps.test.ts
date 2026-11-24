import { describe, expect, it } from 'vitest'

import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import { toolStepIds } from '@/features/overlay/tool-steps'
import { pipelineOf } from '@/test/pipelines'

describe('toolStepIds', () => {
  it('lists the steps a tool draws on, in groups too, and no others', () => {
    const top = createSharpStep('extract')
    const inner = createSharpStep('extract')
    const blur = createSharpStep('blur')
    const pipeline = pipelineOf(blur, top, createGroupStep([blur, inner]))
    expect(toolStepIds(pipeline)).toEqual([top.id, inner.id])
  })

  it('lists a step that starts at the size of the picture it acts on, such as resize', () => {
    const resize = createSharpStep('resize')
    expect(toolStepIds(pipelineOf(resize))).toEqual([resize.id])
  })

  it('is empty when there are none', () => {
    expect(toolStepIds(pipelineOf(createSharpStep('blur')))).toEqual([])
  })
})
