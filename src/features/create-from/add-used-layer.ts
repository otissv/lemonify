import { afterSelected } from '@/features/create-from/create-from-request'
import type { UsedLayerChoice } from '@/features/create-from/create-from-request'
import type { LayerStep } from '@/features/pipeline/layer-kinds'
import { shownWorkflow } from '@/features/pipeline/pipeline-session'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { applyEdit } from '@/features/pipeline/pipeline-sync'
import { addStepChange } from '@/features/workflows/workflow-edit'
import { stepSelection } from '@/features/workflows/workflow-selection'
import {
  documentSession,
  usePipelineStore,
  workflowSession,
} from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'

/**
 * Adds a layer to the open document or workflow `itemId` after `afterStepId`
 * (at the end when none), where each adds steps from its Tools, and selects it.
 * Nothing happens when the item is not open.
 */
export function addUsedLayer(
  itemId: string,
  step: LayerStep,
  afterStepId?: string,
): void {
  const pipelines = usePipelineStore.getState()
  const ui = useUiStore.getState()
  const workflow = workflowSession(pipelines, itemId)
  if (workflow !== undefined) {
    const change = addStepChange(
      shownWorkflow(workflow),
      step,
      afterStepId ?? null,
    )
    void applyEdit(itemId, change)
    ui.selectInWorkflow(itemId, stepSelection(step.id))
    return
  }
  if (documentSession(pipelines, itemId) === undefined) return
  addStepAfter(itemId, step, afterStepId)
  ui.selectStep(itemId, step.id)
}

/** Opens the picker for a document or workflow layer, to add it to `itemId` after its selected step. */
export function askForUsedLayer(itemId: string, layer: UsedLayerChoice): void {
  const ui = useUiStore.getState()
  ui.setCreateFrom({
    kind: 'add-used-layer',
    itemId,
    layer,
    ...afterSelected(ui.selectedSteps[itemId]),
  })
}
