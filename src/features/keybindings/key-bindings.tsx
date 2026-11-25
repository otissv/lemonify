import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { Page } from '@/features/keybindings/actions'
import { useActionContext } from '@/features/keybindings/use-action-context'
import { useKeyBindings } from '@/features/keybindings/use-key-bindings'

interface KeyBindingsProps {
  /** The kind of page, which decides the keys that do something on it. */
  page: Page
  documentId?: string
  catalogues?: AiCatalogues
}

/** Listens for the User's key bindings on this page. A document's or workflow's page mounts it with its id and the AI catalogues; the other pages with neither. Only one is mounted at a time. */
export function KeyBindings({
  page,
  documentId,
  catalogues,
}: KeyBindingsProps): null {
  useKeyBindings(useActionContext(page, documentId, catalogues))
  return null
}
