#!/usr/bin/env node
// Food photos spike (phase F0). Throwaway, run by hand; nothing here is part of the app.
//
// Question: when food photos come out of Google Photos (Takeout ZIP, the album's normal
// Download, or straight from a phone), do they still carry where they were taken?
// For each photo it reports whether a location is in the photo itself (EXIF GPS), only in
// a Takeout metadata file next to it (.json), or nowhere. Everything stays on this
// computer: no network, no uploads. Locations are printed rounded to about 1 km, so the
// output is safe to paste into a chat.
//
//   node spike/food-photos/check.mjs ~/Downloads/takeout-food.zip
//   node spike/food-photos/check.mjs ~/Downloads/Food            (an unzipped folder)
//
// Node 18+ only, no npm install. Reads JPEG and HEIC (EXIF found by its header), and ZIPs
// stored or deflated (not ZIP64, which Takeout uses only above 4 GB).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const target = process.argv[2]
if (!target) { console.log('Give a .zip file or a folder.'); process.exit(1) }

const PHOTO = /\.(jpe?g|heic|heif)$/i

// ---- ZIP (central directory) -------------------------------------------------------------
function unzip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a ZIP (no end record)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (p === 0xffffffff) throw new Error('ZIP64 is not supported by this spike')
  const files = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(dataStart, dataStart + size)
    files.push({ name, read: () => (method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null) })
  }
  return files
}

function folder(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push({ name: full.slice(dir.length + 1), read: () => readFileSync(full) })
    }
  }
  walk(dir)
  return out
}

// ---- EXIF GPS ----------------------------------------------------------------------------
// Finds "Exif\0\0" followed by a TIFF header (works for JPEG APP1 and the HEIC Exif item),
// then reads the GPS IFD (tag 0x8825) and DateTimeOriginal (tag 0x9003 in the Exif IFD).
function exifInfo(bytes) {
  const marker = Buffer.from('Exif\0\0', 'latin1')
  let at = bytes.indexOf(marker)
  while (at >= 0) {
    const t = at + 6
    const order = bytes.toString('latin1', t, t + 2)
    if ((order === 'II' || order === 'MM') && t + 8 <= bytes.length) return readTiff(bytes, t, order === 'II')
    at = bytes.indexOf(marker, at + 1)
  }
  return null
}

function readTiff(b, t, le) {
  const u16 = (o) => (le ? b.readUInt16LE(t + o) : b.readUInt16BE(t + o))
  const u32 = (o) => (le ? b.readUInt32LE(t + o) : b.readUInt32BE(t + o))
  const ifd = (o) => {
    const tags = {}
    if (o <= 0 || t + o + 2 > b.length) return tags
    const n = u16(o)
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12
      if (t + e + 12 > b.length) break
      tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), valueAt: e + 8, offset: u32(e + 8) }
    }
    return tags
  }
  const rationals = (tag) => {
    const out = []
    for (let i = 0; i < Math.min(tag.count, 3); i++) {
      const o = tag.offset + i * 8
      if (t + o + 8 > b.length) return null
      const den = u32(o + 4)
      out.push(den ? u32(o) / den : 0)
    }
    return out
  }
  const ascii = (tag) => (tag.count <= 4 ? b.toString('latin1', t + tag.valueAt, t + tag.valueAt + tag.count) : b.toString('latin1', t + tag.offset, t + tag.offset + tag.count)).replace(/\0+$/, '')
  const ifd0 = ifd(u32(4))
  let date = null
  if (ifd0[0x8769]) { const ex = ifd(ifd0[0x8769].offset); if (ex[0x9003]) date = ascii(ex[0x9003]) }
  if (!ifd0[0x8825]) return { gps: null, date }
  const g = ifd(ifd0[0x8825].offset)
  if (!g[2] || !g[4]) return { gps: null, date }
  const lat = rationals(g[2]), lon = rationals(g[4])
  if (!lat || !lon) return { gps: null, date }
  let la = lat[0] + lat[1] / 60 + lat[2] / 3600
  let lo = lon[0] + lon[1] / 60 + lon[2] / 3600
  if (g[1] && ascii(g[1]).startsWith('S')) la = -la
  if (g[3] && ascii(g[3]).startsWith('W')) lo = -lo
  if (la === 0 && lo === 0) return { gps: null, date }
  return { gps: { lat: la, lon: lo }, date }
}

// ---- Takeout metadata files ----------------------------------------------------------------
// IMG_1234.jpg.json, IMG_1234.jpg.supplemental-metadata.json, or a shortened variant.
function sidecarFor(photoName, jsonFiles) {
  const base = basename(photoName)
  const dir = photoName.slice(0, photoName.length - base.length)
  const candidates = jsonFiles.filter((f) => f.name.startsWith(dir) && basename(f.name).startsWith(base.slice(0, Math.min(base.length, 40))))
  for (const f of candidates) {
    try {
      const j = JSON.parse(f.read().toString('utf8'))
      const geo = [j.geoDataExif, j.geoData].find((g) => g && (g.latitude || g.longitude))
      return { file: basename(f.name), gps: geo ? { lat: geo.latitude, lon: geo.longitude } : null, taken: j.photoTakenTime?.formatted ?? null }
    } catch { /* not a metadata file */ }
  }
  return null
}

const round = (v) => v.toFixed(2)
const where = (g) => `${round(g.lat)}, ${round(g.lon)}`

// ---- Run ---------------------------------------------------------------------------------
const files = statSync(target).isDirectory() ? folder(target) : unzip(readFileSync(target))
const photos = files.filter((f) => PHOTO.test(f.name))
const jsons = files.filter((f) => extname(f.name).toLowerCase() === '.json')
console.log(`${files.length} files: ${photos.length} photos, ${jsons.length} .json files\n`)

const tally = { inPhoto: 0, onlyJson: 0, none: 0 }
for (const f of photos) {
  let info = null
  try { info = exifInfo(f.read()) } catch (err) { info = { error: err.message } }
  const side = sidecarFor(f.name, jsons)
  let result
  if (info?.gps) { tally.inPhoto++; result = `GPS in photo ~${where(info.gps)}` }
  else if (side?.gps) { tally.onlyJson++; result = `GPS only in ${side.file} ~${where(side.gps)}` }
  else { tally.none++; result = 'no location' }
  const extra = [info?.date ? `taken ${info.date}` : null, side && !side.gps ? `json without location` : null, info?.error ? `read error: ${info.error}` : null].filter(Boolean).join('; ')
  console.log(`${basename(f.name)}: ${result}${extra ? `  (${extra})` : ''}`)
}
console.log(`\nSummary: ${tally.inPhoto} with GPS in the photo, ${tally.onlyJson} with GPS only in a .json file, ${tally.none} without a location.`)
