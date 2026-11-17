import { createServerFn } from '@tanstack/react-start'
import { keybindingsFileSchema } from '@/features/keybindings/keybindings-file'
import type { KeybindingsView } from '@/features/keybindings/keybindings-view'
import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

export const getKeybindings = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<KeybindingsView> => {
    const { app, actor } = await appFor(context)
    return app.keybindings.get(actor)
  })

/** Replaces everything the User changed; the file is checked here and again by the service. */
export const saveKeybindings = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(keybindingsFileSchema)
  .handler(async ({ context, data }): Promise<KeybindingsView> => {
    const { app, actor } = await appFor(context)
    return app.keybindings.save(actor, data)
  })
