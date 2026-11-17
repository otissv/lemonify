import type { DocumentSummary } from '@/features/documents/document'
import { listDocuments } from '@/features/documents/document-functions'
import { getKeybindings } from '@/features/keybindings/keybinding-functions'
import { defaultKeybindingsView } from '@/features/keybindings/keybindings-view'
import type { KeybindingsView } from '@/features/keybindings/keybindings-view'
import type { WorkflowView } from '@/server/services/workflow-service'
import { listWorkflows } from '@/features/workflows/workflow-functions'

export interface AppData {
  documents: Array<DocumentSummary>
  workflows: Array<WorkflowView>
  keybindings: KeybindingsView
}

/** What a signed-out visitor sees: nothing of their own, and the default keys. */
export function emptyAppData(): AppData {
  return {
    documents: [],
    workflows: [],
    keybindings: defaultKeybindingsView(),
  }
}

/** What the server holds for the signed-in User: their documents, workflows and key bindings. */
export async function loadAppData(): Promise<AppData> {
  const [documents, workflows, keybindings] = await Promise.all([
    listDocuments(),
    listWorkflows(),
    getKeybindings(),
  ])
  return { documents, workflows, keybindings }
}
