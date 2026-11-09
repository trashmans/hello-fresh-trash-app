import { describe, it, expect } from 'vitest'
import { THEME_STORAGE_KEY, THEME_COLORS, normalizeTheme, toggleTheme, themeColorFor } from '@/lib/theme'

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
  it('matches the browser bar to the header: Tuscan rosemary by day, Orchard charcoal by night', () => {
    expect(THEME_COLORS).toEqual({ light: '#3B5249', dark: '#1C1A16' })
    expect(themeColorFor('light')).toBe('#3B5249')
    expect(themeColorFor('dark')).toBe('#1C1A16')
  })

  it('uses the light colour for unknown values', () => {
    expect(themeColorFor(undefined)).toBe('#3B5249')
  })
})
