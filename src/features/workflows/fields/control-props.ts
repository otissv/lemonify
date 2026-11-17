import type { OpField } from '@/features/workflows/sharp-op-fields'
import type { SharpStep } from '@/features/pipeline/pipeline'

export type JsonValue = SharpStep['options'][string]

/** What every control of a Sharp option gets: the field, its value, and how to change it. */
export interface ControlProps {
  field: OpField
  value: JsonValue | undefined
  /** The step's other options, for controls whose shape depends on them. */
  options: SharpStep['options']
  problem: string | undefined
  onChange: (name: string, value: JsonValue | undefined) => void
  id: string
  describedBy: string | undefined
}
