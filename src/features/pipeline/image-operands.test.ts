import { describe, expect, it } from 'vitest'

import {
  pipelineOperandSourceIds,
  stepOperandSourceIds,
} from '@/features/pipeline/image-operands'
import { createSharpStep } from '@/features/pipeline/pipeline'

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
