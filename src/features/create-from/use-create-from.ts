import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import type { Pipeline } from '@/features/pipeline/pipeline'
import { sourceName } from '@/features/workflows/create-from'
import { sourceNoun } from '@/features/create-from/create-from-request'
import { errorMessage } from '@/lib/error-message'
import { uniqueName } from '@/lib/unique-name'
import { useUiStore } from '@/store/ui-store'

const LOAD_FAILED = 'What to make it from could not be loaded.'

/** What a dialog needs from its source to suggest a name and title itself. */
export type LoadedSource<Source> = {
  source: Source
  pipeline: Pipeline
  name: string
  /** The names already used by the kind of item being made. */
  taken: ReadonlyArray<{ name: string }>
}

/** Where the new item opens. */
export type Created = { to: '/workflows/$id' | '/documents/$id'; id: string }

type CreateFrom<Source> = {
  source: Source | undefined
  /** "group", "embedded document layer", or the word for the whole source. */
  noun: string
  name: string
  setName: (name: string) => void
  problem: string | undefined
  setProblem: (problem: string | undefined) => void
  busy: boolean
  close: () => void
  handleOpenChange: (open: boolean) => void
  /** Makes the item, then closes the dialog and opens it; a failure stays in the dialog. */
  submit: (make: () => Promise<Created>, failed: string) => void
}

/**
 * Loads what a create-from dialog makes its item from, suggests the source's
 * name made unique (unless one was typed first), and sends the form.
 */
export function useCreateFrom<Source>(
  load: () => Promise<LoadedSource<Source>>,
  stepId: string | undefined,
  whole: string,
  maxName: number,
): CreateFrom<Source> {
  const setCreateFrom = useUiStore((state) => state.setCreateFrom)
  const router = useRouter()
  const navigate = useNavigate()
  const [source, setSource] = useState<Source | undefined>(undefined)
  const [noun, setNoun] = useState(whole)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const loaded = await load()
        if (!live) return
        const base = sourceName(loaded.pipeline, stepId, loaded.name)
        const suggested = uniqueName(base, loaded.taken, maxName)
        setSource(loaded.source)
        setNoun(sourceNoun(loaded.pipeline, stepId, whole))
        setName((typed) => (typed === '' ? suggested : typed))
      } catch (caught) {
        if (live) setProblem(errorMessage(caught, LOAD_FAILED))
      } finally {
        if (live) setBusy(false)
      }
    })()
    return () => {
      live = false
    }
  }, [load, stepId, whole, maxName])

  const close = useCallback((): void => {
    setCreateFrom(undefined)
  }, [setCreateFrom])

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) close()
    },
    [close],
  )

  const submit = useCallback(
    (make: () => Promise<Created>, failed: string): void => {
      setBusy(true)
      setProblem(undefined)
      void (async () => {
        try {
          const created = await make()
          close()
          await router.invalidate()
          await navigate({ to: created.to, params: { id: created.id } })
        } catch (caught) {
          setProblem(errorMessage(caught, failed))
        } finally {
          setBusy(false)
        }
      })()
    },
    [close, navigate, router],
  )

  return {
    source,
    noun,
    name,
    setName,
    problem,
    setProblem,
    busy,
    close,
    handleOpenChange,
    submit,
  }
}
