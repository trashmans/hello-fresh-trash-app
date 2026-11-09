import { useCallback, useEffect, useState } from 'react'
import { THEME_STORAGE_KEY, normalizeTheme, themeColorFor, toggleTheme } from '@/lib/theme'

function readSavedTheme() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'light'
  }
}

// Light/dark choice for this device. public/theme-init.js applies the saved
// choice before React loads; this hook keeps <html class="dark">, the
// theme-color meta tag and localStorage in step when the user changes it.
export function useTheme() {
  const [theme, setThemeState] = useState(readSavedTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColorFor(theme))
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Storage blocked: the choice lasts until the page is reloaded.
    }
  }, [theme])

  const setTheme = useCallback((value) => setThemeState(normalizeTheme(value)), [])
  const toggle = useCallback(() => setThemeState((current) => toggleTheme(current)), [])

  return { theme, setTheme, toggle }
}
