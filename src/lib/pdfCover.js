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

// Fraction of the rendered page height to keep. HelloFresh's card layout puts
// the hero photo across roughly the top ~40-45% of the page, with the title
// and ingredient list below — this is a starting guess, tune it once you can
// see real output against an actual recipe card.
const DEFAULT_CROP_RATIO = 0.42
const RENDER_SCALE = 1.5
const JPEG_QUALITY = 0.85

/**
 * Renders page 1 of a PDF (given as an ArrayBuffer) to a cropped JPEG Blob.
 * Returns null (never throws) if rendering fails for any reason — cover
 * generation is a nice-to-have and should never block an upload or a backfill.
 */
export async function renderPdfCoverBlob(arrayBuffer, { cropRatio = DEFAULT_CROP_RATIO } = {}) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
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

    const blob = await new Promise(resolve =>
      cropCanvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    )
    return blob
  } catch (err) {
    console.warn('Cover generation failed, continuing without a cover:', err)
    return null
  }
}
