import {
  LAYER_ANCHORS,
  LAYER_BLENDS,
  LAYER_FITS,
} from '../../src/features/pipeline/layer.ts'
import { layer, testCase, tool } from '../case-types.ts'
import type { ToolCase } from '../case-types.ts'

export const LAYER_CASES: ToolCase[] = [
  testCase('layer-defaults', [layer('overlay')]),
  testCase('layer-opacity-30', [layer('overlay', { opacity: 30 })]),
  ...LAYER_BLENDS.map((blend) =>
    testCase(`layer-blend-${blend}`, [
      layer('overlay', { blend, opacity: 85 }),
    ]),
  ),
  ...LAYER_FITS.map((fit) =>
    testCase(`layer-fit-${fit}`, [layer('overlay', { fit })]),
  ),
  ...LAYER_ANCHORS.map((anchor) =>
    testCase(`layer-anchor-${anchor}`, [
      layer('overlay', { fit: 'original', scale: 40, anchor }),
    ]),
  ),
  testCase('layer-scale-50', [
    layer('overlay', { fit: 'original', scale: 50 }),
  ]),
  testCase('layer-scale-200', [
    layer('overlay', { fit: 'original', scale: 200 }),
  ]),
  testCase('layer-rotation-30', [layer('overlay', { rotation: 30 })]),
  testCase('layer-rotation-minus-90', [layer('overlay', { rotation: -90 })]),
  testCase('layer-offset', [
    layer('overlay', { fit: 'original', scale: 60, x: 40, y: -30 }),
  ]),
  testCase('layer-cut-off-at-the-canvas', [
    layer('overlay', { fit: 'original', scale: 150, x: 120, y: 90 }),
  ]),
  testCase('layers-stacked', [
    layer('overlay', { fit: 'original', scale: 50, anchor: 'northwest' }),
    layer('mask', { blend: 'multiply', opacity: 60 }),
  ]),
  testCase('layer-hidden', [layer('overlay', {}, false)]),
  testCase('layer-then-blur-blurs-both', [
    layer('overlay', { fit: 'original', scale: 60 }),
    tool('blur', { sigma: 4 }),
  ]),
  testCase('blur-then-layer-leaves-the-layer-sharp', [
    tool('blur', { sigma: 4 }),
    layer('overlay', { fit: 'original', scale: 60 }),
  ]),
  testCase('tool-switched-off', [tool('negate', {}, { enabled: false })]),
  testCase('tools-in-order-resize-then-rotate', [
    tool('resize', { width: 160 }),
    tool('rotate', { angle: 90 }),
  ]),
  testCase('tools-in-order-rotate-then-resize', [
    tool('rotate', { angle: 90 }),
    tool('resize', { width: 160 }),
  ]),
  testCase('everything-together', [
    tool('scale', { percent: 80 }),
    layer('overlay', { blend: 'screen', opacity: 70, rotation: 15 }),
    tool(
      'modulate',
      { saturation: 1.6 },
      { blend: { mode: 'normal', opacity: 60 } },
    ),
    tool('opacity', { percent: 90 }),
  ]),
]
