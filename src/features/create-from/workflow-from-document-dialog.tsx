import { useCallback, useState } from 'react'

import { CreateFromShell } from '@/features/create-from/create-from-shell'
import { ImageChoiceField } from '@/features/create-from/image-choice-field'
import { NameField } from '@/features/create-from/name-field'
import { useCreateFrom } from '@/features/create-from/use-create-from'
import type {
  Created,
  LoadedSource,
} from '@/features/create-from/use-create-from'
import { getDocument } from '@/features/documents/document-functions'
import { ImageChoice } from '@/features/workflows/create-from'
import { createWorkflowFromDocumentFn } from '@/features/workflows/create-from-functions'
import {
  MAX_WORKFLOW_NAME_LENGTH,
  WorkflowNameSchema,
} from '@/features/workflows/workflow'
import { listWorkflows } from '@/features/workflows/workflow-functions'

const CREATE_FAILED = 'The workflow could not be made.'

interface WorkflowFromDocumentDialogProps {
  documentId: string
  /** A group or embedded document layer of the document to start from. */
  stepId?: string
}

/** Makes a new workflow from a document, or from one of its groups or embedded document layers, asking what to do with its images. */
export function WorkflowFromDocumentDialog({
  documentId,
  stepId,
}: WorkflowFromDocumentDialogProps): React.JSX.Element {
  const [images, setImages] = useState<ImageChoice>(ImageChoice.RemoveInput)
  const load = useCallback(async (): Promise<LoadedSource<undefined>> => {
    const [document, workflows] = await Promise.all([
      getDocument({ data: { id: documentId } }),
      listWorkflows(),
    ])
    return {
      source: undefined,
      pipeline: document.pipeline,
      name: document.name,
      taken: workflows,
    }
  }, [documentId])
  const form = useCreateFrom(load, stepId, 'document', MAX_WORKFLOW_NAME_LENGTH)
  const { name, setProblem, submit } = form

  const handleSubmit = useCallback((): void => {
    const parsed = WorkflowNameSchema.safeParse(name)
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Enter a name.')
      return
    }
    submit(async (): Promise<Created> => {
      const created = await createWorkflowFromDocumentFn({
        data: {
          documentId,
          ...(stepId === undefined ? {} : { stepId }),
          images,
          name: parsed.data,
        },
      })
      return { to: '/workflows/$id', id: created.id }
    }, CREATE_FAILED)
  }, [documentId, images, name, setProblem, stepId, submit])

  return (
    <CreateFromShell
      title={`New workflow from ${form.noun}`}
      description="A copy of its steps on its canvas, which you can then run on many images."
      problem={form.problem}
      busy={form.busy}
      onOpenChange={form.handleOpenChange}
      onSubmit={handleSubmit}
    >
      <NameField value={name} disabled={form.busy} onChange={form.setName} />
      <ImageChoiceField
        value={images}
        disabled={form.busy}
        onChange={setImages}
      />
    </CreateFromShell>
  )
}
