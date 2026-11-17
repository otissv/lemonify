import { useCallback, useEffect, useState } from 'react'

import type { RunCanvasMode } from '@/features/workflows/workflow'
import type { ResultView } from '@/features/results/result'
import { listResults } from '@/features/results/result-functions'
import {
  cancelWorkflowRun,
  deleteWorkflowRun,
  listWorkflowRuns,
  runWorkflow,
} from '@/features/workflows/workflow-functions'
import { errorMessage } from '@/lib/error-message'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'

export const RUN_POLL_MS = 1000

const RUN_FAILED = 'The run could not be started.'
const ACTION_FAILED = 'That could not be done.'

export interface WorkflowRuns {
  runs: ReadonlyArray<RunView>
  error: string | null
  /** Starts a run on the chosen canvas; the caller saves the workflow first. */
  start: (canvas: RunCanvasMode) => Promise<void>
  cancel: (runId: string) => Promise<void>
  remove: (runId: string) => Promise<void>
  /** The images a run made, for download. */
  images: (runId: string) => Promise<ReadonlyArray<ResultView>>
}

/** A workflow's runs, refreshed every second while any of them is still going. */
export function useWorkflowRuns(workflowId: string): WorkflowRuns {
  const [runs, setRuns] = useState<ReadonlyArray<RunView>>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRuns(await listWorkflowRuns({ data: { workflowId } }))
    } catch (caught) {
      setError(errorMessage(caught, ACTION_FAILED))
    }
  }, [workflowId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const running = runs.some(({ state }) => state === RunState.Running)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void refresh(), RUN_POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])

  const act = useCallback(
    async (action: () => Promise<unknown>, fallback: string): Promise<void> => {
      setError(null)
      try {
        await action()
      } catch (caught) {
        setError(errorMessage(caught, fallback))
      }
      await refresh()
    },
    [refresh],
  )

  const start = useCallback(
    (canvas: RunCanvasMode) =>
      act(() => runWorkflow({ data: { id: workflowId, canvas } }), RUN_FAILED),
    [act, workflowId],
  )
  const cancel = useCallback(
    (runId: string) =>
      act(() => cancelWorkflowRun({ data: { id: runId } }), ACTION_FAILED),
    [act],
  )
  const remove = useCallback(
    (runId: string) =>
      act(() => deleteWorkflowRun({ data: { id: runId } }), ACTION_FAILED),
    [act],
  )
  const images = useCallback(
    (runId: string) => listResults({ data: { workflowRunId: runId } }),
    [],
  )

  return { runs, error, start, cancel, remove, images }
}
