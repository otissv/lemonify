import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DesignSection,
  designTableRows,
  designTokens,
} from '@/test/design-tokens'

const STYLES = readFileSync(resolve(import.meta.dirname, 'styles.css'), 'utf8')

const MAX_CORNER_RADIUS = 6
const TAILWIND_SPACING_PX = 4

const DESIGN_TO_THEME_TOKEN: Readonly<Record<string, string>> = {
  '--color-muted': '--color-muted-foreground',
}

function themeValue(token: string): string | undefined {
  const pattern = new RegExp(`${token}:\\s*([^;]+);`)
  return pattern.exec(STYLES)?.[1]?.trim()
}

function resolveVar(value: string | undefined): string | undefined {
  const reference = value ? /^var\((--[\w-]+)\)$/.exec(value) : null
  if (!reference?.[1]) return value
  return resolveVar(themeValue(reference[1]))
}

describe('styles.css matches DESIGN.md', () => {
  it.each(designTokens(DesignSection.Colors))(
    'defines $token as $value',
    ({ token, value }) => {
      const themeToken = DESIGN_TO_THEME_TOKEN[token] ?? token
      expect(resolveVar(themeValue(themeToken))?.toLowerCase()).toBe(value)
    },
  )

  it.each(designTableRows(DesignSection.Spacing))(
    'maps spacing %s (%s) onto Tailwind step %s',
    (name, value, step) => {
      expect(Number.parseFloat(value)).toBe(Number(step) * TAILWIND_SPACING_PX)
      expect(STYLES).not.toContain(`--spacing-${name}:`)
    },
  )

  it.each([
    ...designTokens(DesignSection.Radius),
    ...designTokens(DesignSection.TypeScale),
  ])('defines $token as $value', ({ token, value }) => {
    expect(themeValue(token)).toBe(value)
  })

  it('keeps every corner radius small, except full circles', () => {
    for (const { token, value } of designTokens(DesignSection.Radius)) {
      if (token === '--radius-full') continue
      expect(Number.parseFloat(value), token).toBeLessThanOrEqual(
        MAX_CORNER_RADIUS,
      )
    }
  })

  it.each(['--radius-xl', '--radius-2xl', '--radius-3xl', '--radius-4xl'])(
    'caps Tailwind %s at the largest DESIGN.md radius',
    (token) => {
      expect(themeValue(token)).toBe('var(--radius-lg)')
    },
  )

  it('anchors the page on the canvas and ink colours', () => {
    expect(resolveVar(themeValue('--color-background'))).toBe('#ffffff')
    expect(resolveVar(themeValue('--color-foreground'))).toBe('#181d26')
  })
})

describe('dark theme', () => {
  const DARK = /\.dark\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? ''

  function darkValue(token: string): string | undefined {
    const pattern = new RegExp(`(?:^|\\s)${token}:\\s*([^;]+);`)
    return pattern.exec(DARK)?.[1]?.trim()
  }

  it('is defined', () => {
    expect(DARK).not.toBe('')
  })

  it('anchors the page on the dark surface and on-dark text', () => {
    expect(darkValue('--background')).toBe('var(--color-surface-dark)')
    expect(darkValue('--foreground')).toBe('var(--color-on-dark)')
    expect(darkValue('--card')).toBe('var(--color-surface-dark-elevated)')
  })

  it('uses the Claude desktop app greys for sidebar, rows, borders and focus', () => {
    expect(darkValue('--sidebar')).toBe('var(--color-surface-dark-sidebar)')
    expect(darkValue('--accent')).toBe('var(--color-surface-dark-selected)')
    expect(darkValue('--border')).toBe('var(--color-hairline-dark)')
    expect(darkValue('--input')).toBe('var(--color-border-dark-strong)')
    expect(darkValue('--muted-foreground')).toBe('var(--color-on-dark-muted)')
    expect(darkValue('--ring')).toBe('var(--color-highlight)')
  })

  it('uses the DESIGN.md secondary-on-dark button as the primary action', () => {
    expect(darkValue('--primary')).toBe('var(--color-canvas)')
    expect(darkValue('--primary-foreground')).toBe('var(--color-ink)')
  })

  it('only uses DESIGN.md colour tokens', () => {
    expect(DARK).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|oklch|hsl/i)
  })

  it('tells the browser the page is dark', () => {
    expect(DARK).toMatch(/color-scheme:\s*dark;/)
  })
})
