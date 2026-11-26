// "A new version is available" (no service worker; Vite names each build's entry
// script by a content hash, so a new deploy has a new entry path). Pure: no I/O.

/** The build's entry script path ("/assets/index-<hash>.js") from an index.html, or null (dev page, error page). */
export function buildIdFromHtml(html) {
  for (const [tag] of String(html ?? '').matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*["']?module["']?/i.test(tag)) continue
    const m = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
    if (!m) continue
    let path
    try { path = new URL(m[1], 'https://app.invalid').pathname } catch { continue }
    if (/^\/assets\/[^/]+\.js$/.test(path)) return path
  }
  return null
}

/** True when index.html now points to a different build than the one running. */
export function isNewVersion(currentBuildId, html) {
  const next = buildIdFromHtml(html)
  return Boolean(currentBuildId && next && currentBuildId !== next)
}

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

/** A lazy page's file failed to load (usually: deleted by a newer deploy). */
export function isChunkLoadError(err) {
  const message = typeof err === 'string' ? err : err?.message
  return typeof message === 'string' && CHUNK_ERROR.test(message)
}
