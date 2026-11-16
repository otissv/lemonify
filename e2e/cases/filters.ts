import { testCase, tool } from '../case-types.ts'
import type { ToolCase } from '../case-types.ts'

const OPERATORS = ['and', 'or', 'eor'] as const
const EDGE_KERNEL = [-1, -1, -1, -1, 8, -1, -1, -1, -1]
const SHARPEN_KERNEL = [0, -1, 0, -1, 5, -1, 0, -1, 0]
const EMBOSS_KERNEL = [-2, -1, 0, -1, 1, 1, 0, 1, 2]

export const FILTER_CASES: ToolCase[] = [
  testCase('sharpen-default', [tool('sharpen', {})]),
  testCase('sharpen-sigma', [tool('sharpen', { sigma: 3 })]),
  testCase('sharpen-flat-and-jagged', [
    tool('sharpen', { sigma: 2, m1: 0.5, m2: 6 }),
  ]),
  testCase('median-3', [tool('median', { size: 3 })]),
  testCase('median-9', [tool('median', { size: 9 })]),
  testCase('blur-default', [tool('blur', {})]),
  testCase('blur-sigma-2', [tool('blur', { sigma: 2 })]),
  testCase('blur-sigma-8', [tool('blur', { sigma: 8 })]),
  testCase('blur-float-precision', [
    tool('blur', { sigma: 4, precision: 'float' }),
  ]),
  testCase('dilate-default', [tool('dilate', {})]),
  testCase('dilate-5', [tool('dilate', { width: 5 })]),
  testCase('erode-default', [tool('erode', {})]),
  testCase('erode-5', [tool('erode', { width: 5 })]),
  testCase('flatten-default', [tool('flatten', {})], 'cutout'),
  testCase(
    'flatten-colour',
    [tool('flatten', { background: '#ff8800' })],
    'cutout',
  ),
  testCase('unflatten', [tool('unflatten')]),
  testCase('gamma-default', [tool('gamma', {})]),
  testCase('gamma-dark', [tool('gamma', { gamma: 3 })]),
  testCase('gamma-in-and-out', [tool('gamma', { gamma: 1.5, gammaOut: 3 })]),
  testCase('negate', [tool('negate')]),
  testCase('negate-with-alpha', [tool('negate', { alpha: true })], 'cutout'),
  testCase('negate-keeps-alpha', [tool('negate', { alpha: false })], 'cutout'),
  testCase('normalise-default', [tool('normalise', {})]),
  testCase('normalise-range', [tool('normalise', { lower: 10, upper: 90 })]),
  testCase('normalize-default', [tool('normalize', {})]),
  testCase('normalize-range', [tool('normalize', { lower: 20, upper: 80 })]),
  testCase('clahe-small', [tool('clahe', { width: 16, height: 16 })]),
  testCase('clahe-strong', [
    tool('clahe', { width: 40, height: 40, maxSlope: 10 }),
  ]),
  testCase('convolve-edges', [
    tool('convolve', { width: 3, height: 3, kernel: EDGE_KERNEL }),
  ]),
  testCase('convolve-sharpen', [
    tool('convolve', { width: 3, height: 3, kernel: SHARPEN_KERNEL }),
  ]),
  testCase('convolve-emboss', [
    tool('convolve', {
      width: 3,
      height: 3,
      kernel: EMBOSS_KERNEL,
      scale: 1,
      offset: 128,
    }),
  ]),
  testCase('threshold-default', [tool('threshold', {})]),
  testCase('threshold-low', [tool('threshold', { threshold: 60 })]),
  testCase('threshold-colour', [
    tool('threshold', { threshold: 128, greyscale: false }),
  ]),
  ...OPERATORS.map((operator) =>
    testCase(`boolean-${operator}`, [
      tool('boolean', { operand: '@mask', operator }),
    ]),
  ),
  testCase('linear-contrast', [tool('linear', { a: 1.6, b: -60 })]),
  testCase('linear-fade', [tool('linear', { a: 0.5, b: 100 })]),
  testCase('recomb-swap-red-blue', [
    tool('recomb', {
      matrix: [
        [0, 0, 1],
        [0, 1, 0],
        [1, 0, 0],
      ],
    }),
  ]),
  testCase('recomb-sepia', [
    tool('recomb', {
      matrix: [
        [0.3588, 0.7044, 0.1368],
        [0.299, 0.587, 0.114],
        [0.2392, 0.4696, 0.0912],
      ],
    }),
  ]),
  testCase('modulate-brighter', [tool('modulate', { brightness: 1.6 })]),
  testCase('modulate-darker', [tool('modulate', { brightness: 0.5 })]),
  testCase('modulate-saturated', [tool('modulate', { saturation: 2.2 })]),
  testCase('modulate-washed-out', [tool('modulate', { saturation: 0.2 })]),
  testCase('modulate-hue', [tool('modulate', { hue: 120 })]),
  testCase('modulate-lightness', [tool('modulate', { lightness: 40 })]),
  testCase('modulate-everything', [
    tool('modulate', { brightness: 1.2, saturation: 1.5, hue: 60 }),
  ]),
]
