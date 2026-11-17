import { useEffect } from 'react'

import { RunState } from '@/server/dao/workflow-dao'
import { useLibraryStore } from '@/store/library-store'

export const RUN_POLL_MS = 1000

/** Reads a workflow's runs into the library when it is shown, and again every second while any of them is still going. */
export function useRunPolling(workflowId: string): void {
  const loadRuns = useLibraryStore((state) => state.loadRuns)
  const running = useLibraryStore((state) =>
    (state.runs[workflowId] ?? []).some(
      ({ state: runState }) => runState === RunState.Running,
    ),
  )

  useEffect(() => {
    void loadRuns(workflowId)
  }, [loadRuns, workflowId])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void loadRuns(workflowId), RUN_POLL_MS)
    return () => clearInterval(timer)
  }, [running, loadRuns, workflowId])
}
