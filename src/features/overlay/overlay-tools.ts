import { lazy } from 'react'
import type { LazyExoticComponent } from 'react'

import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { PipelineStep, SharpStep } from '@/features/pipeline/pipeline'

/** What every tool that draws on the picture is given. */
export interface OverlayToolProps {
  documentId: string
  step: SharpStep
}

/**
 * A tool that is drawn on the picture while its step is selected, such as the
 * box of extract. The overlay layer owns where the picture is, how big it is
 * and when the tool is shown; the tool owns its controls and what they change.
 */
export interface OverlayTool {
  /** The Sharp operation whose step it draws on. */
  op: string
  /** How to use the tool, in a sentence or two, shown with the step's options. */
  hint: string
  /** Whether the tool draws a box that the guides (thirds, grid, spiral…) can be drawn in. */
  guides: boolean
  Component: LazyExoticComponent<
    (props: OverlayToolProps) => React.JSX.Element | null
  >
}

/**
 * The tools that draw on the picture. Adding one is a file for its controls
 * and an entry here; each is loaded when first shown.
 */
export const OVERLAY_TOOLS: ReadonlyArray<OverlayTool> = [
  {
    op: 'extract',
    guides: true,
    hint: 'Drag the box on the picture to set the region, or type the numbers. Shift keeps its proportions, Alt resizes it from the middle, Escape cancels a drag.',
    Component: lazy(() =>
      import('@/features/overlay/extract-overlay').then((module) => ({
        default: module.ExtractOverlay,
      })),
    ),
  },
]

const BY_OP = new Map(OVERLAY_TOOLS.map((tool) => [tool.op, tool]))

/** The tool that draws on the picture for a step, or undefined when none does. */
export function overlayToolFor(step: PipelineStep): OverlayTool | undefined {
  if (step.kind !== PipelineStepKind.Sharp) return undefined
  return BY_OP.get(step.op)
}
