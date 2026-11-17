import { expect, test } from '@playwright/test'

import {
  LAYER_ANCHORS,
  LAYER_BLENDS,
  LAYER_FITS,
} from '../src/features/pipeline/layer.ts'
import { EDITING_OP_NAMES } from '../src/features/pipeline/pipeline.ts'
import { blendableOps } from '../src/features/pipeline/step-blend.ts'
import type { ToolCase } from './case-types.ts'
import { CASES } from './cases/index.ts'

function toolsUsed(cases: ReadonlyArray<ToolCase>): Set<string> {
  const ops = new Set<string>()
  for (const { steps } of cases) {
    for (const step of steps) if (step.kind === 'tool') ops.add(step.op)
  }
  return ops
}

function layerSettingValues(key: string): Set<unknown> {
  const values = new Set<unknown>()
  for (const { steps } of CASES) {
    for (const step of steps) {
      if (step.kind === 'image-layer') values.add(step.settings[key])
    }
  }
  return values
}

test.describe('what the snapshots cover', () => {
  test('every case has its own name', () => {
    const ids = CASES.map(({ id }) => id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })

  test('every editing tool has a case', () => {
    const used = toolsUsed(CASES)
    expect(EDITING_OP_NAMES.filter((op) => !used.has(op))).toEqual([])
  })

  test('every tool that can be blended is blended in a case', () => {
    const blended = toolsUsed(
      CASES.filter(({ steps }) =>
        steps.some((step) => step.kind === 'tool' && step.blend !== undefined),
      ),
    )
    expect(blendableOps().filter((op) => !blended.has(op))).toEqual([])
  })

  test('every blend mode is used by a layer and by a blended tool', () => {
    const layerBlends = layerSettingValues('blend')
    expect(LAYER_BLENDS.filter((mode) => !layerBlends.has(mode))).toEqual([])
    const toolBlends = new Set<string>()
    for (const { steps } of CASES) {
      for (const step of steps) {
        if (step.kind === 'tool' && step.blend) toolBlends.add(step.blend.mode)
      }
    }
    expect(LAYER_BLENDS.filter((mode) => !toolBlends.has(mode))).toEqual([])
  })

  test('every layer fit and anchor is used', () => {
    const fits = layerSettingValues('fit')
    const anchors = layerSettingValues('anchor')
    expect(LAYER_FITS.filter((fit) => !fits.has(fit))).toEqual([])
    expect(LAYER_ANCHORS.filter((anchor) => !anchors.has(anchor))).toEqual([])
  })
})
