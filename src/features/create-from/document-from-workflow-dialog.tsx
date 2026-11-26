import { useCallback, useState } from 'react'

import { CreateFromShell } from '@/features/create-from/create-from-shell'
import { NameField } from '@/features/create-from/name-field'
import { SizeFields } from '@/features/create-from/size-fields'
import { useCreateFrom } from '@/features/create-from/use-create-from'
import type {
  Created,
  LoadedSource,
} from '@/features/create-from/use-create-from'
import { MAX_DOCUMENT_NAME_LENGTH } from '@/features/documents/document'
import { listDocuments } from '@/features/documents/document-functions'
import { pictureSizeSchema } from '@/features/pipeline/canvas'
import type { PictureSize } from '@/features/pipeline/canvas'
import { shownInputImage } from '@/features/workflows/create-from'
import { createDocumentFromWorkflowFn } from '@/features/workflows/create-from-functions'
import { CanvasSize } from '@/features/workflows/workflow'
import { getWorkflow } from '@/features/workflows/workflow-functions'
import type { WorkflowView } from '@/server/services/workflow-service'

const CREATE_FAILED = 'The document could not be made.'
const DEFAULT_SIZE: PictureSize = { width: 1920, height: 1080 }

interface DocumentFromWorkflowDialogProps {
  workflowId: string
  /** A group or embedded document layer of the workflow to start from. */
  stepId?: string
  /** The image for the input slot, or null for none; the workflow's own input image when left out. */
  inputImage?: string | null
}

/** Whether the workflow leaves the new document's size to the person: it takes each input image's size and shows none. */
function needsSize(
  workflow: WorkflowView | undefined,
  inputImage: string | null | undefined,
): boolean {
  if (workflow === undefined) return false
  if (workflow.canvasSize !== CanvasSize.MatchInput) return false
  const shown =
    inputImage === undefined ? shownInputImage(workflow) : inputImage
  return shown === undefined || shown === null
}

/** Makes a new document from a workflow, with the workflow's input image in its first image layer. */
export function DocumentFromWorkflowDialog({
  workflowId,
  stepId,
  inputImage,
}: DocumentFromWorkflowDialogProps): React.JSX.Element {
  const [size, setSize] = useState<PictureSize>(DEFAULT_SIZE)
  const load = useCallback(async (): Promise<LoadedSource<WorkflowView>> => {
    const [workflow, documents] = await Promise.all([
      getWorkflow({ data: { id: workflowId } }),
      listDocuments(),
    ])
    return {
      source: workflow,
      pipeline: workflow.pipeline,
      name: workflow.name,
      taken: documents,
    }
  }, [workflowId])
  const form = useCreateFrom(load, stepId, 'workflow', MAX_DOCUMENT_NAME_LENGTH)
  const { name, setProblem, submit, source } = form
  const asksSize = needsSize(source, inputImage)

  const handleSubmit = useCallback((): void => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setProblem('Enter a name.')
      return
    }
    const checked = pictureSizeSchema.safeParse(size)
    if (asksSize && !checked.success) {
      setProblem(checked.error.issues[0]?.message ?? 'Enter a size.')
      return
    }
    submit(async (): Promise<Created> => {
      const created = await createDocumentFromWorkflowFn({
        data: {
          workflowId,
          ...(stepId === undefined ? {} : { stepId }),
          ...(inputImage === undefined ? {} : { inputImage }),
          ...(asksSize ? { size } : {}),
          name: trimmed,
        },
      })
      return { to: '/documents/$id', id: created.id }
    }, CREATE_FAILED)
  }, [asksSize, inputImage, name, setProblem, size, stepId, submit, workflowId])

  return (
    <CreateFromShell
      title={`New document from ${form.noun}`}
      description="A copy of its steps, with its input image in the first image layer, to edit on its own."
      problem={form.problem}
      busy={form.busy}
      onOpenChange={form.handleOpenChange}
      onSubmit={handleSubmit}
    >
      <NameField value={name} disabled={form.busy} onChange={form.setName} />
      {asksSize && (
        <SizeFields size={size} disabled={form.busy} onChange={setSize} />
      )}
    </CreateFromShell>
  )
}
