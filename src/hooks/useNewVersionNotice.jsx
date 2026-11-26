import { lazy, useEffect } from 'react'
import { toast } from 'sonner'
import { buildIdFromHtml, isNewVersion, isChunkLoadError } from '@/lib/appVersion'

// An open tab keeps running the build it loaded; after a deploy this tells the person
// to reload (src/lib/appVersion.js). Off under `npm run dev`.
const CHECK_EVERY_MS = 5 * 60 * 1000

/** The persistent "new version" toast (one at a time). */
export function showNewVersionNotice() {
  toast('A new version of Hello Fresh Trash is available.', {
    id: 'new-version',
    duration: Infinity,
    action: { label: 'Reload', onClick: () => window.location.reload() },
  })
}

function PageUpdated() {
  return <p className="p-8 text-center text-muted-foreground">This page was updated. Reload to open it.</p>
}

/** React.lazy, but a page file that no longer exists shows the notice instead of crashing. */
export function lazyPage(load) {
  return lazy(() => load().catch((err) => {
    if (!isChunkLoadError(err)) throw err
    showNewVersionNotice()
    return { default: PageUpdated }
  }))
}

/** Checks for a newer deploy every 5 minutes and when the tab comes back into view. */
export function useNewVersionNotice() {
  useEffect(() => {
    if (import.meta.env.DEV) return undefined
    const current = buildIdFromHtml(document.documentElement.outerHTML)
    if (!current) return undefined
    let shown = false

    async function check() {
      if (shown || document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/index.html', { cache: 'no-store' })
        if (!res.ok) return
        if (isNewVersion(current, await res.text())) { shown = true; showNewVersionNotice() }
      } catch { /* offline: try again later */ }
    }
    function onVisible() { if (document.visibilityState === 'visible') check() }
    // Vite fires this when a preloaded file of a lazy page fails to load.
    function onPreloadError(e) { if (isChunkLoadError(e.payload)) { e.preventDefault(); shown = true; showNewVersionNotice() } }

    const timer = setInterval(check, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('vite:preloadError', onPreloadError)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('vite:preloadError', onPreloadError)
    }
  }, [])
}
