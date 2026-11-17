import { useEffect, useState } from 'react'

import { errorMessage } from '@/lib/error-message'

/**
 * Reads a document or workflow from the server into its store the first time
 * it is asked for, and says why it could not be read. `load` must be stable.
 */
export function useLoadPipeline(
  id: string,
  present: boolean,
  load: (id: string) => Promise<void>,
  failure: string,
): string | undefined {
  const [failed, setFailed] = useState<{ id: string; message: string }>()

  useEffect(() => {
    if (present) return
    let current = true
    load(id).catch((error: unknown) => {
      if (current) setFailed({ id, message: errorMessage(error, failure) })
    })
    return () => {
      current = false
    }
  }, [id, present, load, failure])

  return failed?.id === id ? failed.message : undefined
}
