import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { useActionContext } from '@/features/keybindings/use-action-context'
import { useKeyBindings } from '@/features/keybindings/use-key-bindings'

interface KeyBindingsProps {
  documentId?: string
  catalogues?: AiCatalogues
}

/** Listens for the User's key bindings on this page. A document's page mounts it with the document and the AI catalogues; the other pages with neither. Only one is mounted at a time. */
export function KeyBindings({
  documentId,
  catalogues,
}: KeyBindingsProps): null {
  useKeyBindings(useActionContext(documentId, catalogues))
  return null
}
