import {
  LAYER_ANCHORS,
  LAYER_BLENDS,
  LAYER_FITS,
} from '../../src/features/pipeline/layer.ts'
import { imageLayer, testCase, tool } from '../case-types.ts'
import type { ToolCase } from '../case-types.ts'

export const LAYER_CASES: ToolCase[] = [
  testCase('image-layer-defaults', [imageLayer('overlay')]),
  testCase('image-layer-opacity-30', [imageLayer('overlay', { opacity: 30 })]),
  ...LAYER_BLENDS.map((blend) =>
    testCase(`image-layer-blend-${blend}`, [
      imageLayer('overlay', { blend, opacity: 85 }),
    ]),
  ),
  ...LAYER_FITS.map((fit) =>
    testCase(`image-layer-fit-${fit}`, [imageLayer('overlay', { fit })]),
  ),
  ...LAYER_ANCHORS.map((anchor) =>
    testCase(`image-layer-anchor-${anchor}`, [
      imageLayer('overlay', { fit: 'original', scale: 40, anchor }),
    ]),
  ),
  testCase('image-layer-scale-50', [
    imageLayer('overlay', { fit: 'original', scale: 50 }),
  ]),
  testCase('image-layer-scale-200', [
    imageLayer('overlay', { fit: 'original', scale: 200 }),
  ]),
  testCase('image-layer-rotation-30', [
    imageLayer('overlay', { rotation: 30 }),
  ]),
  testCase('image-layer-rotation-minus-90', [
    imageLayer('overlay', { rotation: -90 }),
  ]),
  testCase('image-layer-offset', [
    imageLayer('overlay', { fit: 'original', scale: 60, x: 40, y: -30 }),
  ]),
  testCase('image-layer-cut-off-at-the-canvas', [
    imageLayer('overlay', { fit: 'original', scale: 150, x: 120, y: 90 }),
  ]),
  testCase('image-layers-stacked', [
    imageLayer('overlay', { fit: 'original', scale: 50, anchor: 'northwest' }),
    imageLayer('mask', { blend: 'multiply', opacity: 60 }),
  ]),
  testCase('image-layer-hidden', [imageLayer('overlay', {}, false)]),
  testCase('image-layer-then-blur-blurs-both', [
    imageLayer('overlay', { fit: 'original', scale: 60 }),
    tool('blur', { sigma: 4 }),
  ]),
  testCase('blur-then-image-layer-leaves-the-image-layer-sharp', [
    tool('blur', { sigma: 4 }),
    imageLayer('overlay', { fit: 'original', scale: 60 }),
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
    imageLayer('overlay', { blend: 'screen', opacity: 70, rotation: 15 }),
    tool(
      'modulate',
      { saturation: 1.6 },
      { blend: { mode: 'normal', opacity: 60 } },
    ),
    tool('opacity', { percent: 90 }),
  ]),
]
