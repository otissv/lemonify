import { describe, expect, it } from 'vitest'

import {
  droppedStep,
  isStepDragFromElsewhere,
  setStepDrag,
} from '@/features/documents/step-drag'

function dragData(): Pick<DataTransfer, 'types' | 'getData' | 'setData'> {
  const data = new Map<string, string>()
  return {
    get types() {
      return [...data.keys()]
    },
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => {
      data.set(type, value)
    },
  }
}

const STEP = { documentId: 'DOC-A', stepId: 'step-1' }

describe('step drags', () => {
  it('gives back the step that was dragged', () => {
    const data = dragData()
    setStepDrag(data, STEP)

    expect(droppedStep(data)).toEqual(STEP)
  })

  it('can be dropped on any document but the one the step is from', () => {
    const data = dragData()
    setStepDrag(data, STEP)

    expect(isStepDragFromElsewhere(data, 'doc-b')).toBe(true)
    expect(isStepDragFromElsewhere(data, 'doc-a')).toBe(false)
    expect(isStepDragFromElsewhere(data, 'DOC-A')).toBe(false)
  })

  it('is not a step drag when something else is dragged', () => {
    const data = dragData()
    data.setData('text/plain', 'hello')
    data.setData('application/x-lemonify-document', 'doc-a')

    expect(isStepDragFromElsewhere(data, 'doc-b')).toBe(false)
    expect(droppedStep(data)).toBeUndefined()
  })

  it('ignores a drag that claims to be a step but is not readable', () => {
    for (const text of ['not json', '{"documentId":1}', '[]']) {
      const data = dragData()
      data.setData('application/x-lemonify-step', text)
      expect(droppedStep(data)).toBeUndefined()
    }
  })
})
