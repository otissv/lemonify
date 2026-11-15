import { describe, expect, it } from 'vitest'

import { DESIGN_RADIUS_KEYS, DESIGN_TEXT_KEYS, cn } from '@/lib/utils'
import { DesignSection, designTokenKeys } from '@/test/design-tokens'

describe('cn', () => {
  it('knows every DESIGN.md text and radius token', () => {
    expect([...DESIGN_TEXT_KEYS]).toEqual(
      designTokenKeys(DesignSection.TypeScale, '--text-'),
    )
    expect([...DESIGN_RADIUS_KEYS]).toEqual(
      designTokenKeys(DesignSection.Radius, '--radius-'),
    )
  })

  it('keeps a text colour next to a DESIGN.md text size', () => {
    expect(cn('text-primary-foreground', 'text-button')).toBe(
      'text-primary-foreground text-button',
    )
  })

  it('lets a later DESIGN.md token override an earlier utility', () => {
    expect(cn('px-4 text-sm rounded-xl', 'px-6 text-body-md rounded-lg')).toBe(
      'px-6 text-body-md rounded-lg',
    )
  })
})
