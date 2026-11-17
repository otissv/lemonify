import { create } from 'zustand'
import { z } from 'zod'

import type { SourceSummary } from '@/features/documents/document'
import { clearUnusedResults } from '@/features/render/render-functions'
import type { ResultUsage, ResultView } from '@/features/results/result'
import {
  deleteResult,
  getResultUsage,
  listResults,
} from '@/features/results/result-functions'
import { deleteSource, listSources } from '@/features/sources/source-functions'
import type { RunCanvasMode } from '@/features/workflows/workflow'
import {
  cancelWorkflowRun,
  deleteWorkflowRun,
  listWorkflowRuns,
  runWorkflow,
} from '@/features/workflows/workflow-functions'
import { errorMessage } from '@/lib/error-message'
import type { RunView } from '@/server/services/workflow-service'

export enum SourcesStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

const UPLOAD_ENDPOINT = '/api/sources'
const LOAD_FAILED = 'Your images could not be loaded.'
const UPLOAD_FAILED = 'The image could not be uploaded.'
const RUN_FAILED = 'The run could not be started.'
const RUNS_FAILED = 'That could not be done.'

const UploadResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      mediaType: z.string(),
      bytes: z.number(),
      width: z.number(),
      height: z.number(),
    }),
  ),
  error: z.string(),
})

type Keyed<T> = Readonly<Record<string, T | undefined>>

interface LibraryStateData {
  /** The User's uploaded images, shared by every control that chooses one. */
  sources: ReadonlyArray<SourceSummary>
  status: SourcesStatus
  error: string | null
  /** The AI results and exports kept for each document that has asked, by document id. */
  results: Keyed<ReadonlyArray<ResultView>>
  usage: ResultUsage | undefined
  /** Raised each time the results are read again, so what depends on them (the small step pictures) is asked for again. */
  resultsVersion: number
  /** The runs of each workflow that has asked, newest first, by workflow id. */
  runs: Keyed<ReadonlyArray<RunView>>
  /** Why the last thing done to a workflow's runs failed, by workflow id. */
  runErrors: Keyed<string>
}

interface LibraryStateActions {
  load: () => Promise<void>
  /** Uploading is `POST /api/sources` with the raw bytes; the same image uploaded twice is the same Source, so it is added to the list only once. */
  upload: (file: File) => Promise<SourceSummary>
  /** Deletes an image nothing uses, and takes it out of the list. */
  remove: (id: string) => Promise<void>
  /** Reads the results of a document, and the space used. Throws when the server cannot be reached. */
  loadResults: (documentId: string) => Promise<void>
  /** Says the results changed, and reads again every list of results that has been read. */
  refreshResults: () => Promise<void>
  removeResult: (id: string) => Promise<void>
  /** Clears the AI results a document no longer uses; how many were removed. */
  clearUnusedResults: (documentId: string) => Promise<number>
  loadRuns: (workflowId: string) => Promise<void>
  startRun: (workflowId: string, canvas: RunCanvasMode) => Promise<void>
  cancelRun: (workflowId: string, runId: string) => Promise<void>
  removeRun: (workflowId: string, runId: string) => Promise<void>
  /** Drops the results and runs held for a document or workflow that was deleted. */
  forgetLibrary: (id: string) => void
}

export type LibraryState = LibraryStateData & LibraryStateActions

export const INITIAL_LIBRARY_STATE: Readonly<LibraryStateData> = {
  sources: [],
  status: SourcesStatus.Idle,
  error: null,
  results: {},
  usage: undefined,
  resultsVersion: 0,
  runs: {},
  runErrors: {},
}

function without<T>(
  record: Keyed<T>,
  id: string,
): Record<string, T | undefined> {
  const { [id]: _removed, ...rest } = record
  return rest
}

export const useLibraryStore = create<LibraryState>()((set, get) => {
  async function act(
    workflowId: string,
    action: () => Promise<unknown>,
    fallback: string,
  ): Promise<void> {
    set(({ runErrors }) => ({ runErrors: without(runErrors, workflowId) }))
    try {
      await action()
    } catch (caught) {
      set(({ runErrors }) => ({
        runErrors: {
          ...runErrors,
          [workflowId]: errorMessage(caught, fallback),
        },
      }))
    }
    await get().loadRuns(workflowId)
  }

  return {
    ...INITIAL_LIBRARY_STATE,
    load: async () => {
      if (get().status === SourcesStatus.Loading) return
      set({ status: SourcesStatus.Loading, error: null })
      try {
        set({ sources: await listSources(), status: SourcesStatus.Ready })
      } catch (caught) {
        set({
          status: SourcesStatus.Failed,
          error: errorMessage(caught, LOAD_FAILED),
        })
      }
    },
    upload: async (file) => {
      const response = await fetch(UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      })
      const parsed = UploadResponseSchema.safeParse(await response.json())
      const source = parsed.success ? parsed.data.data.at(0) : undefined
      if (!response.ok || source === undefined) {
        throw new Error(
          parsed.success && parsed.data.error
            ? parsed.data.error
            : UPLOAD_FAILED,
        )
      }
      set(({ sources }) => ({
        sources: sources.some(({ id }) => id === source.id)
          ? sources
          : [source, ...sources],
      }))
      return source
    },
    remove: async (id) => {
      await deleteSource({ data: { id } })
      set(({ sources }) => ({
        sources: sources.filter((source) => source.id !== id),
      }))
    },
    loadResults: async (documentId) => {
      const [found, usage] = await Promise.all([
        listResults({ data: { documentId } }),
        getResultUsage(),
      ])
      set(({ results }) => ({
        results: { ...results, [documentId]: found },
        usage,
      }))
    },
    refreshResults: async () => {
      set(({ resultsVersion }) => ({ resultsVersion: resultsVersion + 1 }))
      await Promise.all(
        Object.keys(get().results).map((documentId) =>
          get()
            .loadResults(documentId)
            .catch(() => undefined),
        ),
      )
    },
    removeResult: async (id) => {
      await deleteResult({ data: { id } })
      await get().refreshResults()
    },
    clearUnusedResults: async (documentId) => {
      const { removed } = await clearUnusedResults({ data: { documentId } })
      await get().refreshResults()
      return removed
    },
    loadRuns: async (workflowId) => {
      try {
        const runs = await listWorkflowRuns({ data: { workflowId } })
        set((state) => ({ runs: { ...state.runs, [workflowId]: runs } }))
      } catch (caught) {
        set(({ runErrors }) => ({
          runErrors: {
            ...runErrors,
            [workflowId]: errorMessage(caught, RUNS_FAILED),
          },
        }))
      }
    },
    startRun: (workflowId, canvas) =>
      act(
        workflowId,
        () => runWorkflow({ data: { id: workflowId, canvas } }),
        RUN_FAILED,
      ),
    cancelRun: (workflowId, runId) =>
      act(
        workflowId,
        () => cancelWorkflowRun({ data: { id: runId } }),
        RUNS_FAILED,
      ),
    removeRun: (workflowId, runId) =>
      act(
        workflowId,
        () => deleteWorkflowRun({ data: { id: runId } }),
        RUNS_FAILED,
      ),
    forgetLibrary: (id) => {
      set((state) => ({
        results: without(state.results, id),
        runs: without(state.runs, id),
        runErrors: without(state.runErrors, id),
      }))
    },
  }
})

/** The file name of a Source, or a placeholder while the list is loading or the Source is gone. */
export function sourceFileName(
  sources: ReadonlyArray<SourceSummary>,
  id: string,
): string {
  return sources.find((source) => source.id === id)?.fileName ?? 'Unknown image'
}
