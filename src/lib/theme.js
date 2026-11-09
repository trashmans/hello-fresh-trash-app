// Light/dark theme choice. Light (Tuscan Garden & Herb) is the default; dark
// (Crisp Orchard) is opt-in from Settings and saved per device in localStorage.
// index.html applies the saved choice before React loads (no flash) using the
// same key and the same rule as normalizeTheme: only the exact string 'dark'
// means dark.

export const THEME_STORAGE_KEY = 'hft-theme'

// Browser/OS bar colour (<meta name="theme-color">), matched to the app header.
export const THEME_COLORS = { light: '#3B5249', dark: '#1C1A16' }

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light'
}

export function toggleTheme(value) {
  return normalizeTheme(value) === 'dark' ? 'light' : 'dark'
}

export function themeColorFor(value) {
  return THEME_COLORS[normalizeTheme(value)]
}
