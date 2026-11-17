import { beforeEach, describe, expect, it } from 'vitest'

import { forgetItem } from '@/store/forget-item'
import { useLibraryStore } from '@/store/library-store'
import { usePipelineStore } from '@/store/pipeline-store'
import { resetStores } from '@/store/reset-stores'
import { useUiStore } from '@/store/ui-store'
import { documentView } from '@/test/document-fixtures'
import { workflowView } from '@/test/workflow-fixtures'

beforeEach(() => {
  resetStores()
})

describe('forgetItem', () => {
  it('leaves no store holding anything for a deleted workflow, and keeps the others', () => {
    usePipelineStore.getState().confirmWorkflow(workflowView('w1'), true)
    usePipelineStore.getState().confirmDocument(documentView([], 'd1'), true)
    useUiStore.getState().selectStep('w1', 's')
    useUiStore.getState().visitItem('w1')
    useLibraryStore.setState({ runs: { w1: [] }, results: { w1: [] } })

    forgetItem('w1')

    expect(usePipelineStore.getState().sessions.w1).toBeUndefined()
    expect(useUiStore.getState().selectedSteps.w1).toBeUndefined()
    expect(useUiStore.getState().visitTrail).toEqual([])
    expect(useLibraryStore.getState().runs.w1).toBeUndefined()
    expect(useLibraryStore.getState().results.w1).toBeUndefined()
    expect(usePipelineStore.getState().sessions.d1).toBeDefined()
  })
})
