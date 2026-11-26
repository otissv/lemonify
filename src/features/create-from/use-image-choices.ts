import { useEffect, useMemo } from 'react'

import type { Choice } from '@/features/create-from/choice-field'
import { SourcesStatus, useLibraryStore } from '@/store/library-store'

/** The value of the choice that leaves the image out. */
export const NO_IMAGE = ''

/** The User's images to choose one from, after a first choice that leaves it empty; reads them when they have not been. */
export function useImageChoices(): ReadonlyArray<Choice> {
  const sources = useLibraryStore((state) => state.sources)
  const status = useLibraryStore((state) => state.status)
  const loadSources = useLibraryStore((state) => state.load)

  useEffect(() => {
    if (status === SourcesStatus.Idle) void loadSources()
  }, [status, loadSources])

  return useMemo<ReadonlyArray<Choice>>(() => {
    const choices: Choice[] = [
      { value: NO_IMAGE, label: 'None: leave it empty' },
    ]
    for (const { id, fileName } of sources) {
      choices.push({ value: id, label: fileName })
    }
    return choices
  }, [sources])
}
