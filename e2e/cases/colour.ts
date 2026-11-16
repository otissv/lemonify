import { testCase, tool } from '../case-types.ts'
import type { ToolCase } from '../case-types.ts'

const OPERATORS = ['and', 'or', 'eor'] as const
const CHANNELS = ['red', 'green', 'blue'] as const
const COLOURSPACES = ['b-w', 'srgb', 'lab'] as const

export const COLOUR_CASES: ToolCase[] = [
  testCase('tint-orange', [tool('tint', { colour: '#ff8800' })]),
  testCase('tint-blue', [tool('tint', { colour: '#2255ff' })]),
  testCase('opacity-75', [tool('opacity', { percent: 75 })]),
  testCase('opacity-50', [tool('opacity', { percent: 50 })]),
  testCase('opacity-50-cutout', [tool('opacity', { percent: 50 })], 'cutout'),
  testCase('opacity-10', [tool('opacity', { percent: 10 })]),
  testCase('opacity-0', [tool('opacity', { percent: 0 })]),
  testCase('opacity-100', [tool('opacity', { percent: 100 })]),
  testCase('greyscale', [tool('greyscale')]),
  testCase('grayscale', [tool('grayscale')]),
  testCase('greyscale-cutout', [tool('greyscale')], 'cutout'),
  ...COLOURSPACES.map((colourspace) =>
    testCase(`pipeline-colourspace-${colourspace}`, [
      tool('pipelineColourspace', { colourspace }),
      tool('modulate', { saturation: 1.4 }),
    ]),
  ),
  testCase('pipeline-colorspace', [
    tool('pipelineColorspace', { colourspace: 'b-w' }),
  ]),
  ...COLOURSPACES.map((colourspace) =>
    testCase(`to-colourspace-${colourspace}`, [
      tool('toColourspace', { colourspace }),
    ]),
  ),
  testCase('to-colorspace', [tool('toColorspace', { colourspace: 'b-w' })]),
  testCase('remove-alpha', [tool('removeAlpha')], 'cutout'),
  testCase('ensure-alpha-half', [tool('ensureAlpha', { alpha: 0.5 })]),
  testCase('ensure-alpha-default', [tool('ensureAlpha', {})]),
  ...CHANNELS.map((channel) =>
    testCase(`extract-channel-${channel}`, [
      tool('extractChannel', { channel }),
    ]),
  ),
  testCase(
    'extract-channel-alpha',
    [tool('extractChannel', { channel: 'alpha' })],
    'cutout',
  ),
  testCase('join-channel', [tool('joinChannel', { images: '@mask' })]),
  ...OPERATORS.map((operator) =>
    testCase(`bandbool-${operator}`, [tool('bandbool', { operator })]),
  ),
]
