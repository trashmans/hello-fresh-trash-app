// Extracts per-step photos from a recipe PDF, entirely in the browser.
//
// HelloFresh's recipe cards put a fixed grid of step photos on a dedicated
// "steps" page (in every sample checked so far, this is page 2 of a 2-page
// PDF), one photo per numbered step, arranged left-to-right then top-to-
// bottom in step order — this holds even across templates whose page 1
// (the cover) looks completely different. See pdfCover.js for the cover
// generation, and the recipe_step_images migration for how these are
// stored and matched back up to parsed steps.
//
// pdf.js doesn't expose the on-page position of embedded images directly,
// so this walks the page's operator list, tracking the current
// transformation matrix (CTM) through save/restore/transform ops, and
// records the CTM at each image-paint op. A PDF image XObject is always
// painted into the unit square [0,1]x[0,1] under the CTM in force at that
// point, so transforming that square's corners by the CTM (then by the
// viewport, to get canvas pixels) gives each image's on-page position —
// without ever needing the decoded pixel data pdf.js keeps separately. The
// actual pixels are cropped from a single render of the whole page, the
// same way the cover thumbnail is cropped from page 1.
import * as pdfjsLib from 'pdfjs-dist'

// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// See pdfCover.js for why this is needed (JPX images are decoded via a
// separate WASM module pdf.js has to be told where to find).
const PDFJS_WASM_URL = '/pdfjs-wasm/'

const STEPS_PAGE_NUMBER = 2 // every sample so far puts the step grid here
const RENDER_SCALE = 1.5
const JPEG_QUALITY = 0.85

// An image narrower or shorter than this (in unscaled PDF points) is treated
// as a decorative element (a logo, a sidebar icon) rather than a step photo.
// Real step photos in every sample are >150pt on a side; icons are <20pt.
const MIN_IMAGE_POINTS = 80

// Images in the same grid "row" can differ slightly in their vertical
// center without actually being a different row — this is how much slack
// to allow before treating two images as belonging to different rows.
const ROW_TOLERANCE_POINTS = 20

// Combines m1 and m2 so that applying the result to a point is the same as
// applying m1 first, then m2 — matches how the PDF "cm" operator prepends a
// matrix onto the current transformation matrix (CTM).
function multiplyMatrices(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ]
}

function applyMatrix([x, y], m) {
  const [a, b, c, d, e, f] = m
  return [a * x + c * y + e, b * x + d * y + f]
}

const IDENTITY = [1, 0, 0, 1, 0, 0]

// Image-paint ops pdf.js's evaluator can emit for a page — which one gets
// used depends on the image's encoding, but all of them paint into the unit
// square under the current CTM, which is all this needs to know.
const IMAGE_OPS = new Set(
  [
    pdfjsLib.OPS.paintImageXObject,
    pdfjsLib.OPS.paintImageMaskXObject,
    pdfjsLib.OPS.paintInlineImageXObject,
  ].filter(op => typeof op === 'number')
)

// Walks a page's operator list and returns each plausible step-photo's
// on-page rectangle, in canvas-pixel coordinates. Unsorted, already
// filtered down by size to exclude decorative elements.
function findImageRectsOnPage(operatorList, viewport) {
  const { fnArray, argsArray } = operatorList
  const stack = [IDENTITY]
  const rects = []

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === pdfjsLib.OPS.save) {
      stack.push(stack[stack.length - 1])
    } else if (fn === pdfjsLib.OPS.restore) {
      if (stack.length > 1) stack.pop()
    } else if (fn === pdfjsLib.OPS.transform) {
      const ctm = stack[stack.length - 1]
      stack[stack.length - 1] = multiplyMatrices(argsArray[i], ctm)
    } else if (IMAGE_OPS.has(fn)) {
      const ctm = stack[stack.length - 1]
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(p => applyMatrix(p, ctm))
      const xs = corners.map(c => c[0])
      const ys = corners.map(c => c[1])
      const widthPoints = Math.max(...xs) - Math.min(...xs)
      const heightPoints = Math.max(...ys) - Math.min(...ys)
      if (widthPoints < MIN_IMAGE_POINTS || heightPoints < MIN_IMAGE_POINTS) continue

      const viewportCorners = corners.map(([x, y]) => viewport.convertToViewportPoint(x, y))
      const vxs = viewportCorners.map(c => c[0])
      const vys = viewportCorners.map(c => c[1])
      rects.push({
        x0: Math.min(...vxs),
        y0: Math.min(...vys),
        x1: Math.max(...vxs),
        y1: Math.max(...vys),
      })
    }
  }

  return rects
}

// Sorts image rects into reading order: top-to-bottom by row (grouping
// rects whose vertical center is within ROW_TOLERANCE_POINTS of each other
// into the same row), then left-to-right within each row.
function sortIntoReadingOrder(rects) {
  const withCenters = rects
    .map(r => ({ ...r, cy: (r.y0 + r.y1) / 2, cx: (r.x0 + r.x1) / 2 }))
    .sort((a, b) => a.cy - b.cy)

  const rows = []
  for (const rect of withCenters) {
    const row = rows.find(r => Math.abs(r.cy - rect.cy) <= ROW_TOLERANCE_POINTS)
    if (row) {
      row.items.push(rect)
      row.cy = row.items.reduce((sum, r) => sum + r.cy, 0) / row.items.length
    } else {
      rows.push({ cy: rect.cy, items: [rect] })
    }
  }
  rows.sort((a, b) => a.cy - b.cy)

  return rows.flatMap(row => row.items.sort((a, b) => a.cx - b.cx))
}

/**
 * Extracts one cropped JPEG Blob per step photo found on the PDF's steps
 * page, in step order (index 0 = step 1, and so on). Returns [] (never
 * throws) if extraction fails or the PDF doesn't have a steps page —
 * matching the result's length against the recipe's actual parsed step
 * count is done separately at display time, not here, since this runs at
 * upload time, before the PDF has been parsed.
 */
export async function extractStepImageBlobs(arrayBuffer) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, wasmUrl: PDFJS_WASM_URL }).promise
    if (pdf.numPages < STEPS_PAGE_NUMBER) return []

    const page = await pdf.getPage(STEPS_PAGE_NUMBER)
    const viewport = page.getViewport({ scale: RENDER_SCALE })

    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = viewport.width
    pageCanvas.height = viewport.height
    const pageCtx = pageCanvas.getContext('2d')
    await page.render({ canvasContext: pageCtx, viewport }).promise

    const operatorList = await page.getOperatorList()
    const rects = findImageRectsOnPage(operatorList, viewport)
    const ordered = sortIntoReadingOrder(rects)

    const blobs = []
    for (const rect of ordered) {
      const x = Math.max(0, Math.round(rect.x0))
      const y = Math.max(0, Math.round(rect.y0))
      const width = Math.min(pageCanvas.width, Math.round(rect.x1)) - x
      const height = Math.min(pageCanvas.height, Math.round(rect.y1)) - y
      if (width <= 0 || height <= 0) continue

      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = width
      cropCanvas.height = height
      cropCanvas.getContext('2d').drawImage(pageCanvas, x, y, width, height, 0, 0, width, height)

      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise(resolve =>
        cropCanvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
      )
      if (blob) blobs.push(blob)
    }

    return blobs
  } catch (err) {
    console.warn('Step image extraction failed, continuing without step photos:', err)
    return []
  }
}
