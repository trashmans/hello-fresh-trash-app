// Light/dark theme choice: Espresso & saffron, in a light version (the default) and a
// dark one. The choice is made with the Light/Dark button in the header (or in
// Settings) and saved per device in localStorage. public/theme-init.js applies the
// saved choice before React loads (no flash) using the same key and the same rule as
// normalizeTheme: only the exact string 'dark' means dark.

export const THEME_STORAGE_KEY = 'hft-theme'

// Browser/OS bar colour (<meta name="theme-color">), matched to the app header.
export const THEME_COLORS = { light: '#FFFFFF', dark: '#1E1713' }

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light'
}

export function toggleTheme(value) {
  return normalizeTheme(value) === 'dark' ? 'light' : 'dark'
}

export function themeColorFor(value) {
  return THEME_COLORS[normalizeTheme(value)]
}

/** What the header's theme button says: the theme it switches to. */
export function themeToggleLabel(value) {
  const next = toggleTheme(value)
  const label = next === 'dark' ? 'Dark mode' : 'Light mode'
  return { label, ariaLabel: `Switch to ${next} mode`, next }
}
