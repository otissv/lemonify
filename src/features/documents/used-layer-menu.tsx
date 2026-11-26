import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { convertLayer } from '@/features/create-from/convert-layer'
import { StepMenu } from '@/features/documents/step-menu'
import type { LayerNames, UsedItem } from '@/features/pipeline/layer-kinds'
import { useOpenUsedItem } from '@/features/tools/used-item'

interface UsedLayerMenuProps {
  /** The open document or workflow the layer is in. */
  itemId: string
  stepId: string
  /** The step's name, for the button that opens the menu. */
  label: string
  /** What the layer uses. */
  item: UsedItem
  names: LayerNames
}

function usedName(item: UsedItem, names: LayerNames): string | undefined {
  return item.kind === 'document'
    ? names.document(item.documentId)
    : names.workflow(item.workflowId)
}

interface OpenItemProps {
  item: UsedItem
  name: string
}

function OpenItem({ item, name }: OpenItemProps): React.JSX.Element {
  const handleOpen = useOpenUsedItem(item)
  return <DropdownMenuItem onSelect={handleOpen}>Open {name}</DropdownMenuItem>
}

/** The ⋯ menu of a document layer's or workflow layer's row: open what it uses, or make it an embedded copy. */
export function UsedLayerMenu({
  itemId,
  stepId,
  label,
  item,
  names,
}: UsedLayerMenuProps): React.JSX.Element {
  const name = usedName(item, names)

  function handleConvert(): void {
    void convertLayer(itemId, stepId)
  }

  return (
    <StepMenu label={label}>
      {name !== undefined && <OpenItem item={item} name={name} />}
      <DropdownMenuItem onSelect={handleConvert}>
        Convert to embedded document layer
      </DropdownMenuItem>
    </StepMenu>
  )
}
