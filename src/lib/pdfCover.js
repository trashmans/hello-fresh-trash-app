// Renders a cover thumbnail for a recipe PDF, entirely in the browser.
//
// Why this works where a raw JPEG 2000 decoder didn't: HelloFresh cards embed
// their hero photo as a JPEG 2000 (JPX) image inside the PDF, and there's no
// good lightweight WASM decoder for that format on its own. But pdf.js (the
// engine behind Chrome's and Firefox's built-in PDF viewers) already ships a
// JPX decoder internally, because it has to be able to render *any* PDF,
// JPEG-2000 images included. So instead of extracting and decoding the image
// ourselves, we let pdf.js render the whole first page to a <canvas> and crop
// the top portion, which is where HelloFresh puts the photo.
import * as pdfjsLib from 'pdfjs-dist'

// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// pdf.js v6+ decodes JPEG 2000 (JPX) images — exactly what HelloFresh's cover
// photos are — via a separate WebAssembly module, not the worker bundle
// itself. It has to be told where to find it via `wasmUrl` on getDocument()
// (below), a directory it appends filenames like "openjpeg.wasm" to.
// Without this, JPX images silently fail to decode and render as blank —
// the render doesn't throw, so this is easy to miss. The wasm files are
// copied from node_modules/pdfjs-dist/wasm/ into public/pdfjs-wasm/ (see
// that folder's contents) since pdf.js needs them at their original
// filenames, which Vite's normal asset pipeline doesn't guarantee — if
// pdfjs-dist is ever upgraded, re-copy that folder.
const PDFJS_WASM_URL = '/pdfjs-wasm/'

// Fraction of the rendered page height to keep. HelloFresh's card layout puts
// the hero photo across roughly the top ~40-45% of the page, with the title
// and ingredient list below — this is a starting guess, tune it once you can
// see real output against an actual recipe card.
const DEFAULT_CROP_RATIO = 0.42
const RENDER_SCALE = 1.5
const JPEG_QUALITY = 0.85

// Some HelloFresh cards embed their hero photo in a way pdf.js's WASM JPX
// decoder silently fails to decode (a known pdf.js limitation, see
// https://github.com/mozilla/pdf.js/issues/19517) — the render call succeeds
// and doesn't throw, but the photo area comes out as a flat, uniform block
// (usually white) while the text/logo above it renders fine. A real food
// photo always has texture, shadows, and color variation, so we can catch
// this by sampling pixel luminance in the lower part of the crop (below
// where the title/logo header sits) and checking whether it's suspiciously
// uniform. If so, we treat it the same as any other render failure: no
// cover is better than a broken-looking one.
const BLANK_SAMPLE_TOP_RATIO = 0.4 // skip the top of the crop (title/logo/header)
const BLANK_SAMPLE_STEP_PX = 4 // sample every 4th pixel (in RGBA units) for speed
const BLANK_STDDEV_THRESHOLD = 10 // luminance std-dev below this reads as "flat"

function isCropSuspiciouslyBlank(cropCanvas) {
  const sampleTop = Math.round(cropCanvas.height * BLANK_SAMPLE_TOP_RATIO)
  const sampleHeight = cropCanvas.height - sampleTop
  if (sampleHeight <= 0) return false

  const { data } = cropCanvas
    .getContext('2d')
    .getImageData(0, sampleTop, cropCanvas.width, sampleHeight)

  let sum = 0
  let sumSq = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4 * BLANK_SAMPLE_STEP_PX) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    sum += luminance
    sumSq += luminance * luminance
    count += 1
  }
  if (count === 0) return false

  const mean = sum / count
  const variance = Math.max(0, sumSq / count - mean * mean)
  return Math.sqrt(variance) < BLANK_STDDEV_THRESHOLD
}

/**
 * Renders page 1 of a PDF (given as an ArrayBuffer) to a cropped JPEG Blob.
 * Returns null (never throws) if rendering fails for any reason — cover
 * generation is a nice-to-have and should never block an upload or a backfill.
 */
export async function renderPdfCoverBlob(arrayBuffer, { cropRatio = DEFAULT_CROP_RATIO } = {}) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, wasmUrl: PDFJS_WASM_URL }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: RENDER_SCALE })

    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = viewport.width
    pageCanvas.height = viewport.height
    const pageCtx = pageCanvas.getContext('2d')

    await page.render({ canvasContext: pageCtx, viewport }).promise

    const cropHeight = Math.max(1, Math.round(pageCanvas.height * cropRatio))
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = pageCanvas.width
    cropCanvas.height = cropHeight
    cropCanvas.getContext('2d').drawImage(
      pageCanvas,
      0, 0, pageCanvas.width, cropHeight,
      0, 0, pageCanvas.width, cropHeight,
    )

    if (isCropSuspiciouslyBlank(cropCanvas)) {
      console.warn('Cover generation produced a suspiciously blank crop, skipping it')
      return null
    }

    const blob = await new Promise(resolve =>
      cropCanvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    )
    return blob
  } catch (err) {
    console.warn('Cover generation failed, continuing without a cover:', err)
    return null
  }
}
