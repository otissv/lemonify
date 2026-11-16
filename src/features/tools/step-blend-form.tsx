import { BlendModeSelect, OpacitySlider } from '@/features/tools/blend-controls'
import type { StepBlend } from '@/features/pipeline/step-blend'

interface StepBlendFormProps {
  blend: StepBlend
  onChange: (blend: StepBlend) => void
}

/** How the result of a step is blended with the picture as it was before the step. The defaults, normal and 100%, leave the result as it is. */
export function StepBlendForm({
  blend,
  onChange,
}: StepBlendFormProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="step-blend-heading"
      className="flex flex-col gap-4 border-t p-4"
    >
      <h3 id="step-blend-heading" className="text-title-sm">
        Blend
      </h3>
      <BlendModeSelect
        value={blend.mode}
        onChange={(mode) => {
          onChange({ ...blend, mode })
        }}
      />
      <OpacitySlider
        value={blend.opacity}
        onChange={(opacity) => {
          onChange({ ...blend, opacity })
        }}
      />
    </section>
  )
}
