import type { OpField } from '@/features/workflows/sharp-op-fields'
import type { SharpNode } from '@/features/workflows/workflow-graph'

export type JsonValue = SharpNode['options'][string]

/** What every control of a Sharp option gets: the field, its value, and how to change it. */
export interface ControlProps {
  field: OpField
  value: JsonValue | undefined
  /** The step's other options, for controls whose shape depends on them. */
  options: SharpNode['options']
  problem: string | undefined
  onChange: (name: string, value: JsonValue | undefined) => void
  id: string
  describedBy: string | undefined
}
