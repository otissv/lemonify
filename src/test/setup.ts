import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/** Every screen reads the User's key bindings with the rest of the app's data; tests that do not care get the defaults. */
vi.mock('@/features/keybindings/keybinding-functions', async () => {
  const { defaultKeybindingsView } = await import(
    '@/features/keybindings/keybindings-view'
  )
  return {
    getKeybindings: vi.fn(async () => defaultKeybindingsView()),
    saveKeybindings: vi.fn(async () => defaultKeybindingsView()),
  }
})

/** Parallel test files share the CPU, so a screen can take longer than the 1 s default to settle. */
configure({ asyncUtilTimeout: 5000 })

function matchMediaStub(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function defineIfMissing<T extends object>(
  target: T,
  key: string,
  value: unknown,
): void {
  if (key in target) return
  Object.defineProperty(target, key, { writable: true, value })
}

function installBrowserStubs(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: matchMediaStub,
  })
  defineIfMissing(window, 'ResizeObserver', ResizeObserverStub)
  defineIfMissing(Element.prototype, 'hasPointerCapture', () => false)
  defineIfMissing(Element.prototype, 'setPointerCapture', () => undefined)
  defineIfMissing(Element.prototype, 'releasePointerCapture', () => undefined)
  defineIfMissing(Element.prototype, 'scrollIntoView', () => undefined)
}

if (typeof window !== 'undefined') installBrowserStubs()

afterEach(() => {
  cleanup()
})
