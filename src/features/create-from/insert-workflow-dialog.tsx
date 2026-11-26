import { useCallback, useState } from 'react'

import { ChoiceField } from '@/features/create-from/choice-field'
import { CreateFromShell } from '@/features/create-from/create-from-shell'
import {
  NO_IMAGE,
  useImageChoices,
} from '@/features/create-from/use-image-choices'
import { useItemChoices } from '@/features/create-from/use-item-choices'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { workflowAsEmbeddedFn } from '@/features/workflows/create-from-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { errorMessage } from '@/lib/error-message'
import { useUiStore } from '@/store/ui-store'

const LOAD_FAILED = 'Your workflows could not be loaded.'
const INSERT_FAILED = 'The workflow could not be added.'
const NO_WORKFLOWS = 'You have no workflows yet.'

interface InsertWorkflowDialogProps {
  documentId: string
  /** The step it goes after; the end of the document when none. */
  afterStepId?: string
}

/** Adds a copy of one of the person's workflows to the document as an embedded document layer, with an image in its input slot. */
export function InsertWorkflowDialog({
  documentId,
  afterStepId,
}: InsertWorkflowDialogProps): React.JSX.Element {
  const setCreateFrom = useUiStore((state) => state.setCreateFrom)
  const selectStep = useUiStore((state) => state.selectStep)
  const workflows = useItemChoices({
    load: listWorkflows,
    loadFailed: LOAD_FAILED,
    none: NO_WORKFLOWS,
  })
  const images = useImageChoices()
  const [sourceId, setSourceId] = useState(NO_IMAGE)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const workflowId = workflows.chosen
  const busy = sending || workflows.loading || workflowId === ''

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) setCreateFrom(undefined)
    },
    [setCreateFrom],
  )

  const handleSubmit = useCallback((): void => {
    if (workflowId === '') return
    setSending(true)
    setProblem(undefined)
    void (async () => {
      try {
        const step = await workflowAsEmbeddedFn({
          data: {
            workflowId,
            ...(sourceId === NO_IMAGE ? {} : { sourceId }),
          },
        })
        addStepAfter(documentId, step, afterStepId)
        selectStep(documentId, step.id)
        setCreateFrom(undefined)
      } catch (caught) {
        setProblem(errorMessage(caught, INSERT_FAILED))
      } finally {
        setSending(false)
      }
    })()
  }, [afterStepId, documentId, selectStep, setCreateFrom, sourceId, workflowId])

  return (
    <CreateFromShell
      title="Insert workflow"
      description="Adds a copy of the workflow as an embedded document layer, which you can then change on its own."
      submitLabel="Insert"
      problem={problem ?? workflows.problem}
      busy={busy}
      onOpenChange={handleOpenChange}
      onSubmit={handleSubmit}
    >
      <ChoiceField
        label="Workflow"
        value={workflowId}
        choices={workflows.choices}
        disabled={sending || workflows.loading}
        onChange={workflows.choose}
      />
      <ChoiceField
        label="Image for its input slot"
        value={sourceId}
        choices={images}
        disabled={sending}
        onChange={setSourceId}
      />
    </CreateFromShell>
  )
}
