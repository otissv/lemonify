import { lazy } from 'react'
import type { LazyExoticComponent } from 'react'

import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { PipelineStep, SharpStep } from '@/features/pipeline/pipeline'

/** How the server makes a tool's own picture. A tool names one; the stacked card and the canvas ask the server for it the same way for every tool. */
export enum ToolPictureSource {
  /** The picture the step acts on: the steps ahead of it. */
  BeforeStep = 'before-step',
}

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
  /** Which picture is the tool's own, the one it draws on. The Output is always the picture through the step. */
  picture: ToolPictureSource
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
    picture: ToolPictureSource.BeforeStep,
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
