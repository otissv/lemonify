import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearUnusedResults } from '@/features/render/render-functions'
import type { ResultView } from '@/features/results/result'
import {
  deleteResult,
  getResultUsage,
  listResults,
} from '@/features/results/result-functions'
import { deleteSource, listSources } from '@/features/sources/source-functions'
import { RunCanvasMode } from '@/features/workflows/workflow'
import {
  cancelWorkflowRun,
  deleteWorkflowRun,
  listWorkflowRuns,
  runWorkflow,
} from '@/features/workflows/workflow-functions'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'
import { SourcesStatus, useLibraryStore } from '@/store/library-store'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))
vi.mock('@/features/results/result-functions', () => ({
  listResults: vi.fn(),
  deleteResult: vi.fn(),
  getResultUsage: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  clearUnusedResults: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflowRuns: vi.fn(),
  runWorkflow: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  deleteWorkflowRun: vi.fn(),
}))

const SOURCE = {
  id: 's1',
  fileName: 'cat.png',
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

const RESULT: ResultView = {
  id: 'r1',
  kind: 'export',
  fileName: 'one.webp',
  mediaType: 'image/webp',
  bytes: 10,
  documentId: 'd1',
  stepId: null,
  workflowRunId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const RUN = { id: 'run-1', state: RunState.Running } as RunView

const USAGE = { usedBytes: 10, maxBytes: 100 }

beforeEach(() => {
  resetStores()
  vi.mocked(getResultUsage).mockResolvedValue(USAGE)
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('the images', () => {
  it('are read once at a time and kept', async () => {
    vi.mocked(listSources).mockResolvedValue([SOURCE])

    await useLibraryStore.getState().load()

    expect(useLibraryStore.getState()).toMatchObject({
      sources: [SOURCE],
      status: SourcesStatus.Ready,
      error: null,
    })
  })

  it('say why they could not be read', async () => {
    vi.mocked(listSources).mockRejectedValue(new Error('Offline.'))

    await useLibraryStore.getState().load()

    expect(useLibraryStore.getState()).toMatchObject({
      status: SourcesStatus.Failed,
      error: 'Offline.',
    })
  })

  it('lose one that is deleted', async () => {
    vi.mocked(listSources).mockResolvedValue([SOURCE])
    vi.mocked(deleteSource).mockResolvedValue(undefined)
    await useLibraryStore.getState().load()

    await useLibraryStore.getState().remove('s1')

    expect(deleteSource).toHaveBeenCalledWith({ data: { id: 's1' } })
    expect(useLibraryStore.getState().sources).toEqual([])
  })
})

describe('the results of a document', () => {
  it('are read with the space used', async () => {
    vi.mocked(listResults).mockResolvedValue([RESULT])

    await useLibraryStore.getState().loadResults('d1')

    expect(listResults).toHaveBeenCalledWith({ data: { documentId: 'd1' } })
    expect(useLibraryStore.getState().results.d1).toEqual([RESULT])
    expect(useLibraryStore.getState().usage).toEqual(USAGE)
  })

  it('are read again for every document that has asked, and the version rises', async () => {
    vi.mocked(listResults).mockResolvedValue([RESULT])
    await useLibraryStore.getState().loadResults('d1')
    await useLibraryStore.getState().loadResults('d2')
    vi.mocked(listResults).mockClear()
    vi.mocked(listResults).mockResolvedValue([])

    await useLibraryStore.getState().refreshResults()

    expect(listResults).toHaveBeenCalledTimes(2)
    expect(useLibraryStore.getState().results.d1).toEqual([])
    expect(useLibraryStore.getState().resultsVersion).toBe(1)
  })

  it('go on when one list cannot be read again', async () => {
    vi.mocked(listResults).mockResolvedValue([RESULT])
    await useLibraryStore.getState().loadResults('d1')
    vi.mocked(listResults).mockRejectedValue(new Error('Offline.'))

    await expect(
      useLibraryStore.getState().refreshResults(),
    ).resolves.toBeUndefined()
    expect(useLibraryStore.getState().results.d1).toEqual([RESULT])
  })

  it('are read again after one is deleted', async () => {
    vi.mocked(listResults).mockResolvedValue([RESULT])
    vi.mocked(deleteResult).mockResolvedValue(undefined)
    await useLibraryStore.getState().loadResults('d1')
    vi.mocked(listResults).mockResolvedValue([])

    await useLibraryStore.getState().removeResult('r1')

    expect(deleteResult).toHaveBeenCalledWith({ data: { id: 'r1' } })
    expect(useLibraryStore.getState().results.d1).toEqual([])
  })

  it('say how many unused ones were cleared', async () => {
    vi.mocked(clearUnusedResults).mockResolvedValue({ removed: 2 })
    vi.mocked(listResults).mockResolvedValue([])

    const removed = await useLibraryStore.getState().clearUnusedResults('d1')

    expect(removed).toBe(2)
    expect(clearUnusedResults).toHaveBeenCalledWith({
      data: { documentId: 'd1' },
    })
  })

  it('are not read when the server cannot be reached, and the reason reaches the caller', async () => {
    vi.mocked(listResults).mockRejectedValue(new Error('Offline.'))

    await expect(useLibraryStore.getState().loadResults('d1')).rejects.toThrow(
      'Offline.',
    )
    expect(useLibraryStore.getState().results.d1).toBeUndefined()
  })
})

describe('the runs of a workflow', () => {
  it('are read for each workflow apart', async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue([RUN])

    await useLibraryStore.getState().loadRuns('w1')

    expect(listWorkflowRuns).toHaveBeenCalledWith({
      data: { workflowId: 'w1' },
    })
    expect(useLibraryStore.getState().runs.w1).toEqual([RUN])
    expect(useLibraryStore.getState().runs.w2).toBeUndefined()
  })

  it('start on the chosen canvas and are read again', async () => {
    vi.mocked(runWorkflow).mockResolvedValue(RUN)
    vi.mocked(listWorkflowRuns).mockResolvedValue([RUN])

    await useLibraryStore.getState().startRun('w1', RunCanvasMode.FirstImage)

    expect(runWorkflow).toHaveBeenCalledWith({
      data: { id: 'w1', canvas: RunCanvasMode.FirstImage },
    })
    expect(useLibraryStore.getState().runs.w1).toEqual([RUN])
    expect(useLibraryStore.getState().runErrors.w1).toBeUndefined()
  })

  it('say why a run could not start, until the next thing done', async () => {
    vi.mocked(runWorkflow).mockRejectedValue(new Error('No images.'))
    vi.mocked(listWorkflowRuns).mockResolvedValue([])

    await useLibraryStore.getState().startRun('w1', RunCanvasMode.Workflow)
    expect(useLibraryStore.getState().runErrors.w1).toBe('No images.')

    vi.mocked(runWorkflow).mockResolvedValue(RUN)
    await useLibraryStore.getState().startRun('w1', RunCanvasMode.Workflow)
    expect(useLibraryStore.getState().runErrors.w1).toBeUndefined()
  })

  it('are cancelled and deleted by id, then read again', async () => {
    vi.mocked(cancelWorkflowRun).mockResolvedValue(RUN)
    vi.mocked(deleteWorkflowRun).mockResolvedValue(undefined)
    vi.mocked(listWorkflowRuns).mockResolvedValue([])

    await useLibraryStore.getState().cancelRun('w1', 'run-1')
    await useLibraryStore.getState().removeRun('w1', 'run-1')

    expect(cancelWorkflowRun).toHaveBeenCalledWith({ data: { id: 'run-1' } })
    expect(deleteWorkflowRun).toHaveBeenCalledWith({ data: { id: 'run-1' } })
    expect(listWorkflowRuns).toHaveBeenCalledTimes(2)
  })

  it('say when the runs cannot be read', async () => {
    vi.mocked(listWorkflowRuns).mockRejectedValue(new Error('Offline.'))

    await useLibraryStore.getState().loadRuns('w1')

    expect(useLibraryStore.getState().runErrors.w1).toBe('Offline.')
  })
})

describe('forgetting a document or workflow', () => {
  it('drops its results and runs and nothing else', async () => {
    vi.mocked(listResults).mockResolvedValue([RESULT])
    vi.mocked(listWorkflowRuns).mockResolvedValue([RUN])
    await useLibraryStore.getState().loadResults('d1')
    await useLibraryStore.getState().loadResults('d2')
    await useLibraryStore.getState().loadRuns('d1')

    useLibraryStore.getState().forgetLibrary('d1')

    const state = useLibraryStore.getState()
    expect(state.results.d1).toBeUndefined()
    expect(state.runs.d1).toBeUndefined()
    expect(state.results.d2).toEqual([RESULT])
  })
})
