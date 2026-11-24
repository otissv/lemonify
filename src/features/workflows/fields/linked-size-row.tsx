import { LinkedPair } from '@/components/ui/linked-pair'
import { ProportionLock } from '@/components/ui/proportion-lock'
import type { JsonValue } from '@/features/workflows/fields/control-props'
import { SharpOptionField } from '@/features/workflows/sharp-option-field'
import { OpFieldKind } from '@/features/workflows/sharp-op-fields'
import type { OpField } from '@/features/workflows/sharp-op-fields'
import type { SharpStep } from '@/features/pipeline/pipeline'
import { PairSide } from '@/lib/kept-proportion'
import { useKeptProportion } from '@/lib/use-kept-proportion'

/** The values of several options at once; undefined clears one. */
export type OptionsPatch = Readonly<Record<string, JsonValue | undefined>>

interface LinkedSizeRowProps {
  first: OpField
  second: OpField
  options: SharpStep['options']
  problems: Readonly<Record<string, string | undefined>>
  onChange: (patch: OptionsPatch) => void
}

/** Two options that make one size, such as width and height, with the chain between them that keeps their proportion while it is locked. */
export function LinkedSizeRow({
  first,
  second,
  options,
  problems,
  onChange,
}: LinkedSizeRowProps): React.JSX.Element {
  const kept = useKeptProportion(options[first.name], options[second.name], {
    integers:
      first.kind === OpFieldKind.Integer && second.kind === OpFieldKind.Integer,
  })

  function handleFieldChange(name: string, value: JsonValue | undefined): void {
    const side = name === first.name ? PairSide.First : PairSide.Second
    const [firstValue, secondValue] = kept.change(side, value)
    onChange({ [first.name]: firstValue, [second.name]: secondValue })
  }

  return (
    <LinkedPair data-slot="field-row">
      <SharpOptionField
        field={first}
        value={options[first.name]}
        options={options}
        problem={problems[first.name]}
        onChange={handleFieldChange}
      />
      <ProportionLock
        label="Keep proportions"
        locked={kept.locked}
        onLockedChange={kept.setLocked}
        className="mt-6"
      />
      <SharpOptionField
        field={second}
        value={options[second.name]}
        options={options}
        problem={problems[second.name]}
        onChange={handleFieldChange}
      />
    </LinkedPair>
  )
}
