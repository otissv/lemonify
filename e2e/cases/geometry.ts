import { testCase, tool } from '../case-types.ts'
import type { ToolCase } from '../case-types.ts'

const FITS = ['contain', 'cover', 'fill', 'inside', 'outside'] as const
const KERNELS = ['nearest', 'cubic', 'lanczos3'] as const
const EXTENDS = ['background', 'copy', 'repeat', 'mirror'] as const
const ROTATIONS = [90, 180, 270, 45, -30] as const

export const GEOMETRY_CASES: ToolCase[] = [
  testCase('scale-50', [tool('scale', { percent: 50 })]),
  testCase('scale-150', [tool('scale', { percent: 150 })]),
  testCase('scale-stretch-height', [
    tool('scale', { percent: 100, verticalPercent: 50 }),
  ]),
  testCase('scale-stretch-width', [
    tool('scale', { percent: 50, verticalPercent: 100 }),
  ]),
  testCase('scale-tiny', [tool('scale', { percent: 4 })]),

  testCase('resize-width', [tool('resize', { width: 160 })]),
  testCase('resize-height', [tool('resize', { height: 90 })]),
  ...FITS.map((fit) =>
    testCase(`resize-fit-${fit}`, [
      tool('resize', { width: 200, height: 100, fit, background: '#ff00aa' }),
    ]),
  ),
  ...KERNELS.map((kernel) =>
    testCase(`resize-kernel-${kernel}`, [
      tool('resize', { width: 40, kernel }),
      tool('resize', { width: 320, kernel }),
    ]),
  ),
  testCase('resize-position-cover-south-east', [
    tool('resize', {
      width: 120,
      height: 120,
      fit: 'cover',
      position: 'southeast',
    }),
  ]),
  testCase('resize-without-enlargement', [
    tool('resize', { width: 900, withoutEnlargement: true }),
  ]),
  testCase('resize-without-reduction', [
    tool('resize', { width: 100, withoutReduction: true }),
  ]),

  testCase('extend-all-sides', [
    tool('extend', {
      top: 20,
      bottom: 30,
      left: 10,
      right: 40,
      background: '#33aa55',
    }),
  ]),
  ...EXTENDS.map((extendWith) =>
    testCase(`extend-with-${extendWith}`, [
      tool('extend', { top: 30, left: 30, extendWith, background: '#aa3355' }),
    ]),
  ),

  testCase('extract-corner', [
    tool('extract', { left: 20, top: 10, width: 140, height: 100 }),
  ]),
  testCase('extract-centre', [
    tool('extract', { left: 100, top: 70, width: 120, height: 100 }),
  ]),

  testCase('trim-border', [tool('trim', {})], 'cutout'),
  testCase('trim-threshold', [tool('trim', { threshold: 60 })], 'cutout'),
  testCase('trim-background', [
    tool('trim', { background: '#1c2b4a', threshold: 20 }),
  ]),

  ...ROTATIONS.map((angle) =>
    testCase(`rotate-${angle}`, [
      tool('rotate', { angle, background: '#ffcc00' }),
    ]),
  ),
  testCase('rotate-transparent-background', [tool('rotate', { angle: 20 })]),

  testCase('auto-orient', [tool('autoOrient')]),
  testCase('flip', [tool('flip')]),
  testCase('flop', [tool('flop')]),
  testCase('flip-and-flop', [tool('flip'), tool('flop')]),

  testCase('affine-shear', [
    tool('affine', { matrix: [1, 0.3, 0, 1], background: '#222222' }),
  ]),
  testCase('affine-rotate-scale', [
    tool('affine', { matrix: [0.8, -0.4, 0.4, 0.8], interpolator: 'nearest' }),
  ]),
]
