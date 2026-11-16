import sharp from 'sharp'

import type { SecondImage } from './case-types.ts'

export const SCENE_WIDTH = 320
export const SCENE_HEIGHT = 240

const SCENE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c2b4a"/>
      <stop offset="1" stop-color="#e8a05a"/>
    </linearGradient>
  </defs>
  <rect width="320" height="240" fill="url(#sky)"/>
  <rect x="0" y="170" width="320" height="70" fill="#2f6b3a"/>
  <circle cx="240" cy="70" r="34" fill="#fff2a8"/>
  <rect x="40" y="90" width="70" height="80" fill="#c0392b"/>
  <polygon points="30,90 75,50 120,90" fill="#7a1f16"/>
  <rect x="64" y="130" width="22" height="40" fill="#f4e3c1"/>
  <rect x="170" y="120" width="60" height="50" fill="#2980b9"/>
  <rect x="0" y="0" width="20" height="20" fill="#ff0000"/>
  <rect x="300" y="0" width="20" height="20" fill="#00ff00"/>
  <rect x="0" y="220" width="20" height="20" fill="#0000ff"/>
  <rect x="300" y="220" width="20" height="20" fill="#ffffff"/>
  <line x1="130" y1="200" x2="300" y2="150" stroke="#111111" stroke-width="3"/>
</svg>`

const CUTOUT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT}">
  <circle cx="160" cy="120" r="90" fill="#d35400"/>
  <circle cx="160" cy="120" r="55" fill="#f1c40f" fill-opacity="0.6"/>
  <rect x="130" y="95" width="60" height="50" fill="#2c3e50"/>
</svg>`

const OVERLAY_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
  <rect width="160" height="120" fill="#8e44ad" fill-opacity="0.55"/>
  <circle cx="80" cy="60" r="40" fill="none" stroke="#ffffff" stroke-width="10"/>
  <circle cx="80" cy="60" r="16" fill="#e74c3c"/>
  <rect x="0" y="0" width="30" height="30" fill="#1abc9c"/>
</svg>`

const MASK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT}">
  <defs>
    <linearGradient id="ramp" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000000"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="320" height="240" fill="url(#ramp)"/>
  <circle cx="160" cy="120" r="60" fill="#808080"/>
</svg>`

async function opaque(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg))
    .flatten({ background: '#000000' })
    .png()
    .toBuffer()
}

/** The pictures the documents are made from, drawn the same way every time so the snapshots stay the same. */
export async function makeImages(): Promise<
  Record<SecondImage | 'cutout', Buffer>
> {
  return {
    scene: await opaque(SCENE_SVG),
    cutout: await sharp(Buffer.from(CUTOUT_SVG)).png().toBuffer(),
    overlay: await sharp(Buffer.from(OVERLAY_SVG)).png().toBuffer(),
    mask: await opaque(MASK_SVG),
  }
}
