import { describe, expect, it } from 'vitest'

import { imagesOpenedBefore } from '@/features/pipeline/opened-images'
import { createSharpStep, createSourceStep } from '@/features/pipeline/pipeline'

const summary = (id: string) => ({
  id,
  fileName: `${id}.png`,
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
})

describe('imagesOpenedBefore', () => {
  const base = createSourceStep('a')
  const mask = createSourceStep('b')
  const again = createSourceStep('b')
  const composite = createSharpStep('composite')
  const later = createSourceStep('c')
  const pipeline = { steps: [base, mask, again, composite, later] }
  const sources = ['a', 'b', 'c'].map(summary)

  it('lists the images opened before a step, each once, in order', () => {
    expect(
      imagesOpenedBefore(pipeline, composite.id, sources).map(({ id }) => id),
    ).toEqual(['a', 'b'])
  })

  it('lists none for a step before every Open image step', () => {
    expect(
      imagesOpenedBefore({ steps: [composite, base] }, composite.id, sources),
    ).toEqual([])
  })

  it('leaves out an image the document does not know yet', () => {
    expect(
      imagesOpenedBefore(pipeline, composite.id, [summary('a')]).map(
        ({ id }) => id,
      ),
    ).toEqual(['a'])
  })
})
