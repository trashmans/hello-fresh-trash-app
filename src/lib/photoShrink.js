// Food photos, phase F1a (docs/adr/0012): turning chosen files into what may be uploaded.
// Browser only (canvas), so not unit-tested; the pure parts are in foodPhotos.js and tested.
//
// readPhotoBatch(files)  files from the file picker (photos and/or ZIPs) → [{ name, bytes, exif }
//                        | { name, error }], reading GPS and the date in the browser.
// shrinkPhoto(bytes)     → { full, thumb } JPEG Blobs (longest side 1600 / 400 px). Drawing on a
//                        canvas and re-encoding drops all metadata; the result is checked with
//                        hasGps() and refused if a location survived.

import { hasGps, isPhotoName, readExif, unzipEntries } from './foodPhotos'

export const FULL_SIZE = 1600
export const THUMB_SIZE = 400
const QUALITY = 0.85

/** Reads chosen files (photos and ZIPs of photos) in the browser. Errors are per photo. */
export async function readPhotoBatch(files) {
  const out = []
  for (const file of files ?? []) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      let entries
      try { entries = await unzipEntries(bytes) } catch (err) { out.push({ name: file.name, error: err.message === 'zip64' ? 'zip_too_big' : 'not_zip' }); continue }
      for (const e of entries) if (isPhotoName(e.name)) out.push({ name: e.name.split('/').pop(), bytes: e.bytes, exif: readExif(e.bytes) })
    } else if (isPhotoName(file.name)) {
      out.push({ name: file.name, bytes, exif: readExif(bytes) })
    }
  }
  return out
}

async function decode(bytes) {
  try {
    return await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' })
  } catch {
    // HEIC opens only where the browser supports it (Safari); elsewhere it can't be shrunk.
    throw new Error('unsupported')
  }
}

async function encode(bitmap, longest) {
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', QUALITY))
  if (hasGps(new Uint8Array(await blob.arrayBuffer()))) throw new Error('gps_left')
  return blob
}

/** → { full, thumb } JPEG Blobs without any metadata. Throws 'unsupported' for a format the browser can't open. */
export async function shrinkPhoto(bytes) {
  const bitmap = await decode(bytes)
  try {
    return { full: await encode(bitmap, FULL_SIZE), thumb: await encode(bitmap, THUMB_SIZE) }
  } finally {
    bitmap.close?.()
  }
}
