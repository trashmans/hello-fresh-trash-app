import { describe, it, expect } from 'vitest'
import { buildIdFromHtml, isNewVersion, isChunkLoadError } from '@/lib/appVersion'

// "A new version is available": the open tab compares the build it runs with the
// build index.html points to now. Each Vite build names its entry script by a hash.
const built = (src, extra = '') => `<!doctype html>
<html lang="en">
  <head>
    <script src="/theme-init.js"></script>
    ${extra}
    <script type="module" crossorigin src="${src}"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-CbX12.css">
  </head>
  <body><div id="root"></div></body>
</html>`

describe('buildIdFromHtml', () => {
  it("gives the build's entry script", () => {
    expect(buildIdFromHtml(built('/assets/index-D4f9aZ1q.js'))).toBe('/assets/index-D4f9aZ1q.js')
  })

  it('ignores scripts that are not the module entry (theme-init.js)', () => {
    expect(buildIdFromHtml('<script src="/theme-init.js"></script>')).toBeNull()
  })

  it('finds it whatever the order of the attributes or quotes', () => {
    expect(buildIdFromHtml(`<script src='/assets/index-x1.js' crossorigin type='module'></script>`)).toBe('/assets/index-x1.js')
  })

  it('takes the path from a full address, as the browser reports it', () => {
    expect(buildIdFromHtml(built('https://hello-fresh-trash.vercel.app/assets/index-x1.js'))).toBe('/assets/index-x1.js')
  })

  it('gives null for the development page and for nothing', () => {
    expect(buildIdFromHtml(built('/src/main.jsx'))).toBeNull()
    expect(buildIdFromHtml('')).toBeNull()
    expect(buildIdFromHtml(null)).toBeNull()
  })
})

describe('isNewVersion', () => {
  it('is true when index.html points to another build', () => {
    expect(isNewVersion('/assets/index-old.js', built('/assets/index-new.js'))).toBe(true)
  })

  it('is false for the same build', () => {
    expect(isNewVersion('/assets/index-old.js', built('/assets/index-old.js'))).toBe(false)
  })

  it('is false when either build is unknown (dev, an error page, a failed fetch)', () => {
    expect(isNewVersion(null, built('/assets/index-new.js'))).toBe(false)
    expect(isNewVersion('/assets/index-old.js', '<html><body>502 Bad Gateway</body></html>')).toBe(false)
    expect(isNewVersion('/assets/index-old.js', '')).toBe(false)
  })
})

describe('isChunkLoadError', () => {
  it("recognises a page file that no longer exists after a deploy, in each browser's words", () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x.app/assets/Social-abc.js'))).toBe(true) // Chrome
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true) // Safari
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x.app/assets/Social-abc.js'))).toBe(true) // Firefox
  })

  it('also reads a plain message', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true)
  })

  it('is false for other errors and for nothing', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
