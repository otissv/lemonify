import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'

import type { Workflow } from '@/features/workflows/workflow'
import {
  getWorkflow,
  updateWorkflow,
} from '@/features/workflows/workflow-functions'
import { errorMessage } from '@/lib/error-message'

export const AUTOSAVE_DELAY_MS = 400

const LOAD_FAILED = 'The workflow could not be loaded.'
const SAVE_FAILED = 'The workflow could not be saved.'

export enum EditorStatus {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export enum SaveStatus {
  Saved = 'saved',
  Saving = 'saving',
  Failed = 'failed',
}

export interface WorkflowEditor {
  status: EditorStatus
  loadError: string | null
  workflow: Workflow | null
  save: SaveStatus
  saveError: string | null
  /** Applies a change to the workflow on screen and saves it shortly after. */
  update: (change: (current: Workflow) => Workflow) => void
  /** Saves now and waits until nothing is left to save. */
  settle: () => Promise<void>
  /** Throws away what is on screen and loads the saved workflow again. */
  reload: () => Promise<void>
}

/**
 * Loads one workflow and keeps what the User changes saved. Saves are one at
 * a time and carry the revision of the last save, so another tab's edit is
 * refused rather than overwritten: the save fails and `reload` fetches theirs.
 */
export function useWorkflowEditor(id: string): WorkflowEditor {
  const [status, setStatus] = useState(EditorStatus.Loading)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [save, setSave] = useState(SaveStatus.Saved)
  const [saveError, setSaveError] = useState<string | null>(null)
  const latest = useRef<Workflow | null>(null)
  const revision = useRef(0)
  const dirty = useRef(false)
  const inFlight = useRef<Promise<void>>(Promise.resolve())

  const load = useCallback(async (): Promise<void> => {
    setStatus(EditorStatus.Loading)
    try {
      const loaded = await getWorkflow({ data: { id } })
      const { name, nodes, edges } = loaded
      const next = { id: loaded.id, name, nodes, edges }
      latest.current = next
      revision.current = loaded.revision
      dirty.current = false
      setWorkflow(next)
      setSave(SaveStatus.Saved)
      setSaveError(null)
      setLoadError(null)
      setStatus(EditorStatus.Ready)
    } catch (caught) {
      setLoadError(errorMessage(caught, LOAD_FAILED))
      setStatus(EditorStatus.Failed)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const saveLatest = useCallback((): Promise<void> => {
    const run = async (): Promise<void> => {
      const current = latest.current
      if (current === null || !dirty.current) return
      dirty.current = false
      setSave(SaveStatus.Saving)
      try {
        const saved = await updateWorkflow({
          data: {
            id: current.id,
            revision: revision.current,
            name: current.name,
            graph: { nodes: current.nodes, edges: current.edges },
          },
        })
        revision.current = saved.revision
        setSave(dirty.current ? SaveStatus.Saving : SaveStatus.Saved)
        setSaveError(null)
      } catch (caught) {
        dirty.current = false
        setSave(SaveStatus.Failed)
        setSaveError(errorMessage(caught, SAVE_FAILED))
      }
    }
    inFlight.current = inFlight.current.then(run)
    return inFlight.current
  }, [])

  const debouncedSave = useDebouncedCallback(saveLatest, AUTOSAVE_DELAY_MS)

  const update = useCallback(
    (change: (current: Workflow) => Workflow): void => {
      const current = latest.current
      if (current === null) return
      const next = change(current)
      if (next === current) return
      latest.current = next
      dirty.current = true
      setWorkflow(next)
      setSave(SaveStatus.Saving)
      void debouncedSave()
    },
    [debouncedSave],
  )

  const settle = useCallback(async (): Promise<void> => {
    debouncedSave.cancel()
    await saveLatest()
  }, [debouncedSave, saveLatest])

  const reload = useCallback(async (): Promise<void> => {
    debouncedSave.cancel()
    await inFlight.current
    await load()
  }, [debouncedSave, load])

  useEffect(() => () => void debouncedSave.flush(), [debouncedSave])

  return {
    status,
    loadError,
    workflow,
    save,
    saveError,
    update,
    settle,
    reload,
  }
}
