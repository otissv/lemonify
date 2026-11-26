import { useCallback, useState } from 'react'

import { addUsedLayer } from '@/features/create-from/add-used-layer'
import { ChoiceField } from '@/features/create-from/choice-field'
import { CreateFromShell } from '@/features/create-from/create-from-shell'
import type { UsedLayerDialogProps } from '@/features/create-from/document-layer-dialog'
import {
  NO_IMAGE,
  useImageChoices,
} from '@/features/create-from/use-image-choices'
import { useItemChoices } from '@/features/create-from/use-item-choices'
import { createWorkflowLayerStep } from '@/features/pipeline/layer-kinds'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { useUiStore } from '@/store/ui-store'

const LOAD_FAILED = 'Your workflows could not be loaded.'
const NO_WORKFLOWS = 'You have no other workflows yet.'

/** Adds a layer that draws one of the User's workflows on an image, as the workflow is now, and as it changes. */
export function WorkflowLayerDialog({
  itemId,
  afterStepId,
}: UsedLayerDialogProps): React.JSX.Element {
  const setCreateFrom = useUiStore((state) => state.setCreateFrom)
  const workflows = useItemChoices({
    load: listWorkflows,
    exclude: itemId,
    loadFailed: LOAD_FAILED,
    none: NO_WORKFLOWS,
  })
  const images = useImageChoices()
  const [sourceId, setSourceId] = useState(NO_IMAGE)
  const workflowId = workflows.chosen

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) setCreateFrom(undefined)
    },
    [setCreateFrom],
  )

  const handleSubmit = useCallback((): void => {
    if (workflowId === '') return
    const step = createWorkflowLayerStep(
      workflowId,
      sourceId === NO_IMAGE ? undefined : sourceId,
    )
    addUsedLayer(itemId, step, afterStepId)
    setCreateFrom(undefined)
  }, [afterStepId, itemId, setCreateFrom, sourceId, workflowId])

  return (
    <CreateFromShell
      title="Add workflow layer"
      description="Adds a layer that draws the workflow on the image you choose, at the size its canvas gives. It changes when the workflow does."
      submitLabel="Add"
      problem={workflows.problem}
      busy={workflows.loading || workflowId === ''}
      onOpenChange={handleOpenChange}
      onSubmit={handleSubmit}
    >
      <ChoiceField
        label="Workflow"
        value={workflowId}
        choices={workflows.choices}
        disabled={workflows.loading}
        onChange={workflows.choose}
      />
      <ChoiceField
        label="Image for its input slot"
        value={sourceId}
        choices={images}
        disabled={false}
        onChange={setSourceId}
      />
    </CreateFromShell>
  )
}
