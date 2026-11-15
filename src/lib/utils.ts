import { createCn } from 'cn/config'

export const DESIGN_TEXT_KEYS = [
  'display-xl',
  'display-lg',
  'display-md',
  'title-lg',
  'title-md',
  'title-sm',
  'label-md',
  'button',
  'body-md',
  'caption',
  'legal',
  'pricing-display',
  'pricing-section',
  'pricing-card-title',
] as const

export const DESIGN_RADIUS_KEYS = ['xs', 'sm', 'md', 'lg', 'full'] as const

/**
 * Merges class names like the default `cn`, but knows the DESIGN.md theme
 * keys so that e.g. `text-button` is merged as a font size, not a colour.
 */
export const cn = createCn({
  extend: {
    theme: {
      text: [...DESIGN_TEXT_KEYS],
      radius: [...DESIGN_RADIUS_KEYS],
    },
  },
})
