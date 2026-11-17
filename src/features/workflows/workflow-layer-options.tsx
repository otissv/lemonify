import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { layerSettingsOf } from '@/features/pipeline/layer'
import type { LayerSettings } from '@/features/pipeline/layer'
import type { GroupStep } from '@/features/pipeline/pipeline'
import { layerKind } from '@/features/pipeline/layer-kinds'
import type { LayerStep } from '@/features/pipeline/layer-kinds'
import { useStepDraft } from '@/features/pipeline/use-step-draft'
import { LayerSettingsForm } from '@/features/tools/layer-settings-form'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import { INPUT_SLOT_SUMMARY } from '@/features/workflows/workflow-steps'

type ChangeHandler = (change: DocumentChange) => void

interface PlacementProps {
  step: LayerStep | GroupStep
  onChange: ChangeHandler
}

/** Where and how a layer or a sub-document is placed on the canvas. */
function Placement({ step, onChange }: PlacementProps): React.JSX.Element {
  const stepId = step.id
  const { draft, change, flush } = useStepDraft<LayerSettings>(
    layerSettingsOf(step),
    (settings) => {
      onChange({ type: 'set-layer', stepId, settings })
    },
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the form's fields, so this only saves the pending edit when focus leaves them
    <div onBlur={flush}>
      <LayerSettingsForm settings={draft} onChange={change} />
    </div>
  )
}

interface ImageLayerOptionsProps {
  step: LayerStep
  /** The file name of an image. */
  imageName: (sourceId: string) => string
  onChange: ChangeHandler
}

/** An image layer in a workflow: the place each input image goes, or a fixed image such as a logo, then where it is placed. */
export function WorkflowLayerOptions({
  step,
  imageName,
  onChange,
}: ImageLayerOptionsProps): React.JSX.Element {
  const [sourceId] = layerKind(step).sourceIds(step)

  function handlePick(pickedId: string): void {
    onChange({ type: 'set-image', stepId: step.id, sourceId: pickedId })
  }

  function handleClear(): void {
    onChange({ type: 'set-image', stepId: step.id, sourceId: null })
  }

  return (
    <>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-body-md text-muted-foreground">
          {sourceId === undefined
            ? `${INPUT_SLOT_SUMMARY}: the workflow draws each of its input images in the first layer like this one, and the others draw nothing. Choose an image to draw the same one every time instead.`
            : `This layer always draws ${imageName(sourceId)}.`}
        </p>
        <ImagePicker
          label="image"
          uploadLabel={
            sourceId === undefined ? 'Use a fixed image…' : 'Replace image…'
          }
          onPick={handlePick}
        />
        {sourceId !== undefined && (
          <Button variant="secondary" size="sm" onClick={handleClear}>
            Use the input image
          </Button>
        )}
      </div>
      <Placement step={step} onChange={onChange} />
    </>
  )
}

interface GroupOptionsProps {
  step: GroupStep
  onChange: ChangeHandler
}

/** A group in a workflow: whether it draws on a picture of its own, and where that picture is placed. */
export function WorkflowGroupOptions({
  step,
  onChange,
}: GroupOptionsProps): React.JSX.Element {
  function handleSubDocument(subDocument: boolean): void {
    onChange({ type: 'set-sub-document', stepId: step.id, subDocument })
  }

  return (
    <>
      <div className="flex items-center gap-2 p-4">
        <Switch
          id={`${step.id}-sub-document`}
          checked={step.subDocument}
          onCheckedChange={handleSubDocument}
        />
        <Label htmlFor={`${step.id}-sub-document`}>Own picture</Label>
      </div>
      {step.subDocument && <Placement step={step} onChange={onChange} />}
    </>
  )
}
