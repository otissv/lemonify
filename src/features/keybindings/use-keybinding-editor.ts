import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'

import { saveKeybindings } from '@/features/keybindings/keybinding-functions'
import type { KeybindingsFile } from '@/features/keybindings/keybindings-file'
import type { KeybindingsView } from '@/features/keybindings/keybindings-view'
import { errorMessage } from '@/lib/error-message'

const rootRoute = getRouteApi('__root__')
const SAVE_FAILED = 'The key bindings could not be saved.'

export interface KeybindingEditor {
  view: KeybindingsView
  /** Why the last save was refused, until the next one. */
  error: string | undefined
  saving: boolean
  /** Saves the whole set of changes. Resolves to whether it was saved. */
  save: (file: KeybindingsFile) => Promise<boolean>
  clearError: () => void
  reportProblem: (message: string) => void
}

/** The User's key bindings as the server holds them, and the one way to change them: save the whole file, then read the page's data again. */
export function useKeybindingEditor(): KeybindingEditor {
  const { keybindings } = rootRoute.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  const save = useCallback(
    async (file: KeybindingsFile): Promise<boolean> => {
      setSaving(true)
      setError(undefined)
      try {
        await saveKeybindings({ data: file })
        await router.invalidate()
        return true
      } catch (caught) {
        setError(errorMessage(caught, SAVE_FAILED))
        return false
      } finally {
        setSaving(false)
      }
    },
    [router],
  )

  const clearError = useCallback((): void => {
    setError(undefined)
  }, [])

  return {
    view: keybindings,
    error,
    saving,
    save,
    clearError,
    reportProblem: setError,
  }
}
