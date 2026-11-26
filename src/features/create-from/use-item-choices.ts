import { useEffect, useState } from 'react'

import type { Choice } from '@/features/create-from/choice-field'
import { errorMessage } from '@/lib/error-message'

export interface ItemChoices {
  choices: ReadonlyArray<Choice>
  chosen: string
  choose: (id: string) => void
  /** While the list is read. */
  loading: boolean
  /** Why there is nothing to choose: the list could not be read, or it is empty. */
  problem: string | undefined
}

interface ItemChoicesOptions {
  load: () => Promise<ReadonlyArray<{ id: string; name: string }>>
  /** Left out of the list: the item the new step goes in. */
  exclude?: string
  loadFailed: string
  none: string
}

/** The User's documents or workflows to choose one from, read once, the first chosen. */
export function useItemChoices({
  load,
  exclude,
  loadFailed,
  none,
}: ItemChoicesOptions): ItemChoices {
  const [choices, setChoices] = useState<ReadonlyArray<Choice>>([])
  const [chosen, choose] = useState('')
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const listed = await load()
        if (!live) return
        const offered: Choice[] = []
        for (const { id, name } of listed) {
          if (id !== exclude) offered.push({ value: id, label: name })
        }
        setChoices(offered)
        choose((current) => current || (offered[0]?.value ?? ''))
        if (offered.length === 0) setProblem(none)
      } catch (caught) {
        if (live) setProblem(errorMessage(caught, loadFailed))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [load, exclude, loadFailed, none])

  return { choices, chosen, choose, loading, problem }
}
