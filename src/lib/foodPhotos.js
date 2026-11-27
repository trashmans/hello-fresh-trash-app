// Food photos, phase F1a (docs/adr/0012): reading photos in the browser before anything is
// uploaded. Opens a ZIP (Google Photos "Download all"), reads each photo's GPS and the date it
// was taken from its EXIF block, rounds a location for the city lookup, sorts a batch, and
// checks that a shrunk photo kept no GPS. Pure: no network, no storage. The ZIP reader uses
// the browser's built-in DecompressionStream (no library).

/** Food photos one person can keep (ADR 0012). */
export const FOOD_PHOTO_LIMIT = 300

const PHOTO = /\.(jpe?g|png|webp|heic|heif)$/i

/** A photo file worth reading: not a folder, macOS extra or hidden file. */
export function isPhotoName(name) {
  if (typeof name !== 'string' || name.endsWith('/') || name.startsWith('__MACOSX/')) return false
  const file = name.split('/').pop()
  return !file.startsWith('.') && PHOTO.test(file)
}

// ---- ZIP ------------------------------------------------------------------------------------

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The files in a ZIP, in order: [{ name, bytes }]. Folders are left out. Throws Error('not_zip')
 * for something else and Error('zip64') for ZIPs over 4 GB (which Google splits anyway).
 */
export async function unzipEntries(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error('not_zip')
  const count = view.getUint16(end + 10, true)
  let p = view.getUint32(end + 16, true)
  if (p === 0xffffffff || count === 0xffff) throw new Error('zip64')
  const out = []
  const decode = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('not_zip')
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = decode.decode(b.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = b.subarray(start, start + size)
    if (method === 0) out.push({ name, bytes: raw.slice() })
    else if (method === 8) out.push({ name, bytes: await inflate(raw) })
  }
  return out
}

// ---- EXIF -----------------------------------------------------------------------------------

const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

// Where the TIFF block after an "Exif\0\0" marker starts, or -1.
function tiffStart(b) {
  outer: for (let i = 0; i + 8 < b.length; i++) {
    for (let k = 0; k < 6; k++) if (b[i + k] !== EXIF[k]) continue outer
    const t = i + 6
    if ((b[t] === 0x49 && b[t + 1] === 0x49) || (b[t] === 0x4d && b[t + 1] === 0x4d)) return t
  }
  return -1
}

function parseTiff(b, t) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const le = b[t] === 0x49
  const inside = (o, n) => o >= 0 && t + o + n <= b.length
  const u16 = (o) => (inside(o, 2) ? view.getUint16(t + o, le) : 0)
  const u32 = (o) => (inside(o, 4) ? view.getUint32(t + o, le) : 0)
  const ifd = (o) => {
    const tags = {}
    if (!o || !inside(o, 2)) return tags
    const n = Math.min(u16(o), 200)
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12
      if (!inside(e, 12)) break
      tags[u16(e)] = { count: u32(e + 4), at: e + 8, offset: u32(e + 8) }
    }
    return tags
  }
  const ascii = (tag) => {
    const start = tag.count <= 4 ? tag.at : tag.offset
    if (!inside(start, tag.count)) return ''
    let s = ''
    for (let i = 0; i < tag.count; i++) { const c = b[t + start + i]; if (!c) break; s += String.fromCharCode(c) }
    return s
  }
  const dms = (tag) => {
    if (!inside(tag.offset, 24)) return null
    const r = (k) => { const den = u32(tag.offset + k * 8 + 4); return den ? u32(tag.offset + k * 8) / den : 0 }
    return r(0) + r(1) / 60 + r(2) / 3600
  }

  const ifd0 = ifd(u32(4))
  let takenOn = null
  if (ifd0[0x8769]) {
    const ex = ifd(ifd0[0x8769].offset)
    const m = ex[0x9003] && ascii(ex[0x9003]).match(/^(\d{4}):(\d{2}):(\d{2})/)
    if (m && m[1] !== '0000' && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) takenOn = `${m[1]}-${m[2]}-${m[3]}`
  }

  let gps = null
  if (ifd0[0x8825]) {
    const g = ifd(ifd0[0x8825].offset)
    if (g[2] && g[4]) {
      let lat = dms(g[2]), lon = dms(g[4])
      if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
        if (g[1] && ascii(g[1]).startsWith('S')) lat = -lat
        if (g[3] && ascii(g[3]).startsWith('W')) lon = -lon
        const valid = Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
        if (valid) gps = { lat, lon }
      }
    }
  }
  return { gps, takenOn }
}

/** { gps: { lat, lon } | null, takenOn: 'YYYY-MM-DD' | null } from a photo's EXIF. Never throws. */
export function readExif(bytes) {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
    const t = tiffStart(b)
    return t < 0 ? { gps: null, takenOn: null } : parseTiff(b, t)
  } catch {
    return { gps: null, takenOn: null }
  }
}

/** True when a file still carries a GPS location (the check after shrinking). */
export function hasGps(bytes) {
  return readExif(bytes).gps != null
}

/** A location rounded to one decimal (about 10 km), what leaves the device for the city lookup. */
export function coarsen(gps) {
  if (!gps) return null
  const r = (v) => Math.round(v * 10) / 10
  return { lat: r(gps.lat), lon: r(gps.lon) }
}

/**
 * Sorts a batch, keeping order: { withLocation, withoutLocation, unreadable, overLimit }.
 * items: [{ name, exif: { gps, takenOn } } | { name, error }]. room: how many more photos the
 * person may add (the limit minus what they have); readable photos past it are left out.
 */
export function photoPlan(items, { room = FOOD_PHOTO_LIMIT } = {}) {
  const plan = { withLocation: [], withoutLocation: [], unreadable: [], overLimit: 0 }
  let taken = 0
  for (const item of items ?? []) {
    if (item.error || !item.exif) { plan.unreadable.push(item); continue }
    if (taken >= room) { plan.overLimit++; continue }
    taken++
    ;(item.exif.gps ? plan.withLocation : plan.withoutLocation).push(item)
  }
  return plan
}
