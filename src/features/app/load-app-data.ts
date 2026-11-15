import type { DocumentSummary } from '@/features/documents/document'
import { listDocuments } from '@/features/documents/document-functions'
import type { WorkflowView } from '@/server/services/workflow-service'
import { listWorkflows } from '@/features/workflows/workflow-functions'

export interface AppData {
  documents: Array<DocumentSummary>
  workflows: Array<WorkflowView>
}

/** What the server holds for the signed-in User: their documents and workflows. */
export async function loadAppData(): Promise<AppData> {
  const [documents, workflows] = await Promise.all([
    listDocuments(),
    listWorkflows(),
  ])
  return { documents, workflows }
}
