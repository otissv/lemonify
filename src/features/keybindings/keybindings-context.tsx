import { getRouteApi } from '@tanstack/react-router'
import { createContext, useContext } from 'react'

import type { EffectiveBindings } from '@/features/keybindings/keybindings-file'
import { defaultKeybindingsView } from '@/features/keybindings/keybindings-view'

const rootRoute = getRouteApi('__root__')

const KeybindingsContext = createContext<EffectiveBindings>(
  defaultKeybindingsView().effective,
)

/** Gives everything below it the keys in force for the signed-in User, as the server last said. Outside it, the defaults apply, so a control drawn on its own still shows a key. */
export function KeybindingsProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { keybindings } = rootRoute.useLoaderData()
  return (
    <KeybindingsContext.Provider value={keybindings.effective}>
      {children}
    </KeybindingsContext.Provider>
  )
}

export function useEffectiveBindings(): EffectiveBindings {
  return useContext(KeybindingsContext)
}
