import { LAYER_BLENDS } from '../../src/features/pipeline/layer.ts'
import { blendableOps } from '../../src/features/pipeline/step-blend.ts'
import { testCase, tool } from '../case-types.ts'
import type { JsonRecord, ToolCase } from '../case-types.ts'

/** What a tool needs to run at all, or to show something; every other tool runs with no options. */
const OPTIONS: Record<string, JsonRecord> = {
  clahe: { width: 16, height: 16 },
  convolve: { width: 3, height: 3, kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0] },
  boolean: { operand: '@mask', operator: 'eor' },
  recomb: {
    matrix: [
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  },
  tint: { colour: '#ff8800' },
  pipelineColourspace: { colourspace: 'b-w' },
  pipelineColorspace: { colourspace: 'b-w' },
  toColourspace: { colourspace: 'b-w' },
  toColorspace: { colourspace: 'b-w' },
  extractChannel: { channel: 'green' },
  joinChannel: { images: '@mask' },
  bandbool: { operator: 'and' },
  blur: { sigma: 6 },
  sharpen: { sigma: 3 },
  modulate: { saturation: 2.2, hue: 90 },
  threshold: { threshold: 110 },
  gamma: { gamma: 3 },
  median: { size: 7 },
  dilate: { width: 5 },
  erode: { width: 5 },
  linear: { a: 1.6, b: -60 },
}

const OPACITIES = [0, 25, 50, 100] as const
const HALF = { mode: 'normal', opacity: 50 }

export const BLEND_CASES: ToolCase[] = [
  ...blendableOps().map((op) =>
    testCase(`blend-${op}-50`, [tool(op, OPTIONS[op] ?? {}, { blend: HALF })]),
  ),
  ...OPACITIES.map((opacity) =>
    testCase(`blend-greyscale-opacity-${opacity}`, [
      tool('greyscale', {}, { blend: { mode: 'normal', opacity } }),
    ]),
  ),
  ...LAYER_BLENDS.map((mode) =>
    testCase(`blend-mode-${mode}-tint`, [
      tool('tint', { colour: '#ff8800' }, { blend: { mode, opacity: 80 } }),
    ]),
  ),
  ...LAYER_BLENDS.map((mode) =>
    testCase(`blend-mode-${mode}-negate`, [
      tool('negate', {}, { blend: { mode, opacity: 70 } }),
    ]),
  ),
  testCase(
    'blend-on-cutout',
    [tool('greyscale', {}, { blend: { mode: 'multiply', opacity: 60 } })],
    'cutout',
  ),
  testCase('blend-stays-with-its-step', [
    tool('blur', { sigma: 4 }, { blend: HALF }),
    tool('greyscale'),
  ]),
  testCase('blend-twice', [
    tool('greyscale', {}, { blend: HALF }),
    tool('tint', { colour: '#ff8800' }, { blend: HALF }),
  ]),
  testCase('blend-after-scale', [
    tool('scale', { percent: 50 }),
    tool('greyscale', {}, { blend: HALF }),
  ]),
  testCase('blend-switched-off', [
    tool('greyscale', {}, { blend: HALF, enabled: false }),
  ]),
]
