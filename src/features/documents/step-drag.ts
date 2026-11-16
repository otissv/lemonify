import { z } from 'zod'

const STEP_TYPE = 'application/x-lemonify-step'
/** Followed by the id of the document the step is from, so a drop target can tell without reading the drag, which it cannot until the drop. */
const FROM_TYPE_PREFIX = 'application/x-lemonify-step-from-'

const DraggedStepSchema = z.object({
  documentId: z.string().min(1),
  stepId: z.string().min(1),
})

export type DraggedStep = z.infer<typeof DraggedStepSchema>

type DragData = Pick<DataTransfer, 'types' | 'getData' | 'setData'>

/** Marks the drag as a step of a document, for the documents it can be dropped on. */
export function setStepDrag(data: DragData, step: DraggedStep): void {
  data.setData(STEP_TYPE, JSON.stringify(step))
  data.setData(`${FROM_TYPE_PREFIX}${step.documentId.toLowerCase()}`, '')
}

/** Whether the drag is a step of some other document than `documentId`, which can take a copy of it. */
export function isStepDragFromElsewhere(
  data: Pick<DragData, 'types'>,
  documentId: string,
): boolean {
  const types = Array.from(data.types)
  return (
    types.includes(STEP_TYPE) &&
    !types.includes(`${FROM_TYPE_PREFIX}${documentId.toLowerCase()}`)
  )
}

/** The step being dropped, or nothing when the drop is not one. */
export function droppedStep(
  data: Pick<DragData, 'getData'>,
): DraggedStep | undefined {
  const text = data.getData(STEP_TYPE)
  if (text === '') return undefined
  try {
    const parsed = DraggedStepSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
