import { useEffect, useRef, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'

/** How long typing settles before it becomes an undo entry, so a run of typing is one entry. */
export const STEP_COMMIT_DELAY_MS = 400

export interface StepDraft<T> {
  draft: T
  change: (next: T) => void
  /** Commits a change that is waiting; call when the user leaves the field. */
  flush: () => void
  /** Replaces the whole value and commits it at once, as one change, such as a reset. */
  replace: (next: T) => void
}

/**
 * Holds what is being edited in a form and commits it as one change shortly
 * after the last edit, when a field loses focus, and when the form closes.
 * A change made elsewhere (undo, redo) replaces the draft.
 */
export function useStepDraft<T>(
  committed: T,
  commit: (value: T) => void,
): StepDraft<T> {
  const [draft, setDraft] = useState(committed)
  const sent = useRef(JSON.stringify(committed))
  const send = useDebouncedCallback((value: T) => {
    sent.current = JSON.stringify(value)
    commit(value)
  }, STEP_COMMIT_DELAY_MS)

  const committedJson = JSON.stringify(committed)
  useEffect(() => {
    if (committedJson === sent.current || send.isPending()) return
    sent.current = committedJson
    setDraft(committed)
  }, [committed, committedJson, send])

  useEffect(
    () => () => {
      send.flush()
    },
    [send],
  )

  function change(next: T): void {
    setDraft(next)
    send(next)
  }

  function flush(): void {
    send.flush()
  }

  function replace(next: T): void {
    setDraft(next)
    send(next)
    send.flush()
  }

  return { draft, change, flush, replace }
}
