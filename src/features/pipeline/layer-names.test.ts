import { describe, expect, it } from 'vitest'

import { layerNames } from '@/features/pipeline/layer-names'

describe('the names a layer row shows', () => {
  const names = layerNames({
    documents: [{ id: 'd1', name: 'Badge' }],
    workflows: [{ id: 'w1', name: 'Brand' }],
    sources: [{ id: 's1', fileName: 'logo.png' }],
  })

  it('finds a document, a workflow and an image by id', () => {
    expect(names.document('d1')).toBe('Badge')
    expect(names.workflow('w1')).toBe('Brand')
    expect(names.image('s1')).toBe('logo.png')
  })

  it('has no name for what the User does not have', () => {
    expect(names.document('w1')).toBeUndefined()
    expect(names.workflow('d1')).toBeUndefined()
    expect(names.image('missing')).toBeUndefined()
  })
})
