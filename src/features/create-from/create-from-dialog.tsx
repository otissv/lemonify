import { DocumentFromWorkflowDialog } from '@/features/create-from/document-from-workflow-dialog'
import { DocumentLayerDialog } from '@/features/create-from/document-layer-dialog'
import { WorkflowLayerDialog } from '@/features/create-from/workflow-layer-dialog'
import { InsertWorkflowDialog } from '@/features/create-from/insert-workflow-dialog'
import { WorkflowFromDocumentDialog } from '@/features/create-from/workflow-from-document-dialog'
import { useUiStore } from '@/store/ui-store'

/** The dialog for the new item being made from the one on screen, while one is asked for. */
export function CreateFromDialog(): React.JSX.Element | null {
  const request = useUiStore((state) => state.createFrom)
  if (request === undefined) return null
  if (request.kind === 'workflow-from-document') {
    return (
      <WorkflowFromDocumentDialog
        key={`${request.documentId}:${request.stepId ?? ''}`}
        documentId={request.documentId}
        stepId={request.stepId}
      />
    )
  }
  if (request.kind === 'add-used-layer') {
    const key = `${request.layer}:${request.itemId}:${request.afterStepId ?? ''}`
    return request.layer === 'document' ? (
      <DocumentLayerDialog
        key={key}
        itemId={request.itemId}
        afterStepId={request.afterStepId}
      />
    ) : (
      <WorkflowLayerDialog
        key={key}
        itemId={request.itemId}
        afterStepId={request.afterStepId}
      />
    )
  }
  if (request.kind === 'insert-workflow') {
    return (
      <InsertWorkflowDialog
        key={`${request.documentId}:${request.afterStepId ?? ''}`}
        documentId={request.documentId}
        afterStepId={request.afterStepId}
      />
    )
  }
  return (
    <DocumentFromWorkflowDialog
      key={`${request.workflowId}:${request.stepId ?? ''}`}
      workflowId={request.workflowId}
      stepId={request.stepId}
      inputImage={request.inputImage}
    />
  )
}
