import { describe, it, expect } from 'vitest'
import { THEME_STORAGE_KEY, THEME_COLORS, normalizeTheme, toggleTheme, themeColorFor, themeToggleLabel } from '@/lib/theme'

describe('THEME_STORAGE_KEY', () => {
  it('is the localStorage key index.html also reads before the app loads', () => {
    expect(THEME_STORAGE_KEY).toBe('hft-theme')
  })
})

describe('normalizeTheme', () => {
  it('keeps the two real themes', () => {
    expect(normalizeTheme('light')).toBe('light')
    expect(normalizeTheme('dark')).toBe('dark')
  })

  it('falls back to light for anything else (nothing saved, old or tampered values)', () => {
    for (const value of [null, undefined, '', 'DARK', ' dark', 'system', 'blue', 1, true, {}]) {
      expect(normalizeTheme(value)).toBe('light')
    }
  })
})

describe('toggleTheme', () => {
  it('switches between light and dark', () => {
    expect(toggleTheme('light')).toBe('dark')
    expect(toggleTheme('dark')).toBe('light')
  })

  it('treats an unknown value as light, so the first toggle goes to dark', () => {
    expect(toggleTheme(null)).toBe('dark')
    expect(toggleTheme('blue')).toBe('dark')
  })
})

describe('themeColorFor', () => {
  it('matches the browser bar to the header: white by day, espresso by night', () => {
    expect(THEME_COLORS).toEqual({ light: '#FFFFFF', dark: '#1E1713' })
    expect(themeColorFor('light')).toBe('#FFFFFF')
    expect(themeColorFor('dark')).toBe('#1E1713')
  })

  it('uses the light colour for unknown values', () => {
    expect(themeColorFor(undefined)).toBe('#FFFFFF')
  })
})

// The Light/Dark button in the header names the theme it switches TO.
describe('themeToggleLabel', () => {
  it('offers dark mode while light, and light mode while dark', () => {
    expect(themeToggleLabel('light')).toEqual({ label: 'Dark mode', ariaLabel: 'Switch to dark mode', next: 'dark' })
    expect(themeToggleLabel('dark')).toEqual({ label: 'Light mode', ariaLabel: 'Switch to light mode', next: 'light' })
  })

  it('treats an unknown value as light', () => {
    expect(themeToggleLabel(undefined)).toEqual(themeToggleLabel('light'))
  })
})
