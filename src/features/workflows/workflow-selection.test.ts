import { describe, expect, it } from 'vitest'

import {
  CANVAS_NODE_ID,
  INPUTS_NODE_ID,
  OUTPUT_NODE_ID,
} from '@/features/workflows/workflow-graph-layout'
import {
  CANVAS_SELECTION,
  INPUTS_SELECTION,
  NO_SELECTION,
  OUTPUT_SELECTION,
  previewNodeIdForSelection,
  previewNodeIdForUi,
  stepSelection,
} from '@/features/workflows/workflow-selection'

describe('previewNodeIdForSelection', () => {
  it('uses the output when nothing is selected', () => {
    expect(previewNodeIdForSelection(NO_SELECTION)).toBe(OUTPUT_NODE_ID)
  })

  it('maps focus and step selections to diagram node ids', () => {
    expect(previewNodeIdForSelection(CANVAS_SELECTION)).toBe(CANVAS_NODE_ID)
    expect(previewNodeIdForSelection(INPUTS_SELECTION)).toBe(INPUTS_NODE_ID)
    expect(previewNodeIdForSelection(OUTPUT_SELECTION)).toBe(OUTPUT_NODE_ID)
    expect(previewNodeIdForSelection(stepSelection('step-1'))).toBe('step-1')
  })
})

describe('previewNodeIdForUi', () => {
  it('matches previewNodeIdForSelection using primitives from the store', () => {
    expect(previewNodeIdForUi(undefined, undefined)).toBe(OUTPUT_NODE_ID)
    expect(previewNodeIdForUi('canvas', undefined)).toBe(CANVAS_NODE_ID)
    expect(previewNodeIdForUi(undefined, 'step-1')).toBe('step-1')
    expect(previewNodeIdForUi('inputs', 'step-1')).toBe(INPUTS_NODE_ID)
  })
})
