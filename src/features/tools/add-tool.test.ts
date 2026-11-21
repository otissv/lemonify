import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { addTool } from '@/features/tools/add-tool'
import { resetStores } from '@/store/reset-stores'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

vi.mock('@/features/pipeline/pipeline-actions', () => ({
  addStepAfter: vi.fn(),
}))

beforeEach(() => {
  resetStores()
  vi.mocked(addStepAfter).mockReset()
})

describe('addTool', () => {
  it('adds a Sharp step with the values the website fills in', () => {
    expect(
      addTool('doc', { kind: 'sharp', value: 'scale' }, []),
    ).toBeUndefined()

    expect(addStepAfter).toHaveBeenCalledWith(
      'doc',
      expect.objectContaining({ op: 'scale', options: { percent: 100 } }),
      undefined,
    )
  })

  it("gives a step that needs another image the document's own image", () => {
    const view = documentView()
    loadDocumentIntoEditor(view)

    addTool(DOCUMENT_ID, { kind: 'sharp', value: 'boolean' }, [])

    expect(addStepAfter).toHaveBeenCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({
        op: 'boolean',
        options: { operator: 'and', operand: view.source.id },
      }),
      undefined,
    )
  })
})
