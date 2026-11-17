import { describe, expect, it } from 'vitest'

import {
  pipelineOperandSourceIds,
  remapPipelineSources,
  stepOperandSourceIds,
} from '@/features/pipeline/image-operands'
import {
  createGroupStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'

describe('stepOperandSourceIds', () => {
  it('reads the operand of a boolean step', () => {
    expect(
      stepOperandSourceIds(
        createSharpStep('boolean', { operand: 'src-1', operator: 'and' }),
      ),
    ).toEqual(['src-1'])
  })

  it('reads one or several images of a join channel step', () => {
    expect(
      stepOperandSourceIds(createSharpStep('joinChannel', { images: 'src-1' })),
    ).toEqual(['src-1'])
    expect(
      stepOperandSourceIds(
        createSharpStep('joinChannel', { images: ['src-1', 'src-2'] }),
      ),
    ).toEqual(['src-1', 'src-2'])
  })

  it('reads the image layers of a composite step and ignores generated layers', () => {
    expect(
      stepOperandSourceIds(
        createSharpStep('composite', {
          images: [
            { input: 'src-1', top: 0 },
            { input: { create: { width: 1, height: 1 } } },
            { input: 'src-2' },
          ],
        }),
      ),
    ).toEqual(['src-1', 'src-2'])
  })

  it('reads nothing from steps that use no other image', () => {
    expect(stepOperandSourceIds(createSharpStep('blur', { sigma: 2 }))).toEqual(
      [],
    )
    expect(stepOperandSourceIds(createSharpStep('boolean', {}))).toEqual([])
  })
})

describe('pipelineOperandSourceIds', () => {
  it('lists each Source once, in order of first use', () => {
    const steps = [
      createSharpStep('boolean', { operand: 'b', operator: 'and' }),
      createSharpStep('joinChannel', { images: ['a', 'b'] }),
      createSharpStep('blur', { sigma: 1 }),
    ]
    expect(pipelineOperandSourceIds({ steps })).toEqual(['b', 'a'])
  })
})

describe('remapPipelineSources', () => {
  const MAP = new Map([
    ['a', 'A'],
    ['b', 'B'],
  ])

  it('points Open image steps at the new ids', () => {
    const open = createLayerStep('a')

    const remapped = remapPipelineSources({ steps: [open] }, MAP)

    expect(remapped.steps[0]).toMatchObject({ id: open.id, sourceId: 'A' })
  })

  it('renames a boolean operand and joined channels', () => {
    const boolean = createSharpStep('boolean', {
      operand: 'a',
      operator: 'and',
    })
    const join = createSharpStep('joinChannel', { images: ['a', 'b'] })
    const single = createSharpStep('joinChannel', { images: 'b' })

    const { steps } = remapPipelineSources(
      { steps: [boolean, join, single] },
      MAP,
    )

    expect(steps.map((step) => stepOperandSourceIds(step))).toEqual([
      ['A'],
      ['A', 'B'],
      ['B'],
    ])
  })

  it('leaves other steps and other options alone', () => {
    const blur = createSharpStep('blur', { sigma: 2 })

    expect(remapPipelineSources({ steps: [blur] }, MAP).steps[0]).toEqual(blur)
  })

  it('says which image is missing from the map', () => {
    expect(() =>
      remapPipelineSources({ steps: [createLayerStep('zzz')] }, MAP),
    ).toThrow(/zzz/)
  })
})

describe('operands of steps in groups', () => {
  const inside = createLayerStep('src-1')
  const other = createSharpStep('boolean', {
    operand: 'src-2',
    operator: 'and',
  })
  const pipeline = {
    steps: [createLayerStep('src-0'), createGroupStep([inside, other])],
  }

  it('finds the images of steps inside a group, even a group that is off', () => {
    expect(pipelineOperandSourceIds(pipeline)).toEqual([
      'src-0',
      'src-1',
      'src-2',
    ])
    const off = {
      steps: [{ ...createGroupStep([inside]), enabled: false }],
    }
    expect(pipelineOperandSourceIds(off)).toEqual(['src-1'])
  })

  it('renames the images of steps inside a group, and keeps the group', () => {
    const map = new Map([
      ['src-0', 'a'],
      ['src-1', 'b'],
      ['src-2', 'c'],
    ])

    const remapped = remapPipelineSources(pipeline, map)

    expect(pipelineOperandSourceIds(remapped)).toEqual(['a', 'b', 'c'])
    expect(remapped.steps[1]).toMatchObject({
      kind: 'group',
      id: pipeline.steps[1]?.id,
    })
  })

  it('says which image is missing from the map when it is inside a group', () => {
    expect(() =>
      remapPipelineSources(pipeline, new Map([['src-0', 'a']])),
    ).toThrow(/src-1/)
  })
})
