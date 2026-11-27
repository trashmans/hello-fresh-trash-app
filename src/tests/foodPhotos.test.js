// @vitest-environment node
// Food photos, phase F1a (docs/adr/0012): reading photos in the browser before upload —
// opening a ZIP, reading GPS and the date taken, rounding a location for the city lookup,
// sorting a batch, and checking a shrunk photo has no GPS left. Pure: no I/O.
import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { isPhotoName, unzipEntries, readExif, hasGps, coarsen, photoPlan, FOOD_PHOTO_LIMIT } from '@/lib/foodPhotos'

// ---- test files ------------------------------------------------------------------------

// A minimal JPEG with an EXIF block: GPS (degrees/minutes/seconds) and DateTimeOriginal.
function jpeg({ lat = null, lon = null, date = null } = {}) {
  const tiff = new DataView(new ArrayBuffer(178))
  const u16 = (o, v) => tiff.setUint16(o, v, true)
  const u32 = (o, v) => tiff.setUint32(o, v, true)
  const text = (o, s) => { for (let i = 0; i < s.length; i++) tiff.setUint8(o + i, s.charCodeAt(i)) }
  const entry = (o, tag, type, count, value) => { u16(o, tag); u16(o + 2, type); u32(o + 4, count); u32(o + 8, value) }
  const dms = (o, v) => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 100)
    u32(o, d); u32(o + 4, 1); u32(o + 8, m); u32(o + 12, 1); u32(o + 16, s); u32(o + 20, 100)
  }
  text(0, 'II'); u16(2, 42); u32(4, 8)
  const tags = [date && [0x8769, 4, 1, 38], lat != null && [0x8825, 4, 1, 76]].filter(Boolean)
  u16(8, tags.length)
  tags.forEach((t, i) => entry(10 + i * 12, ...t))
  if (date) { u16(38, 1); entry(40, 0x9003, 2, 20, 56); text(56, date) }
  if (lat != null) {
    u16(76, 4)
    entry(78, 1, 2, 2, (lat < 0 ? 'S' : 'N').charCodeAt(0))
    entry(90, 2, 5, 3, 130)
    entry(102, 3, 2, 2, (lon < 0 ? 'W' : 'E').charCodeAt(0))
    entry(114, 4, 5, 3, 154)
    dms(130, lat); dms(154, lon)
  }
  const exif = new Uint8Array([...new TextEncoder().encode('Exif\0\0'), ...new Uint8Array(tiff.buffer)])
  const len = exif.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...exif, 0xff, 0xd9])
}
const plainJpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x03, 0x00, 0xff, 0xd9])

// A ZIP of { name: bytes }, stored or deflated, written the way zip tools write it.
function zip(files, { deflate = false } = {}) {
  const enc = new TextEncoder()
  const locals = [], centrals = []
  let offset = 0
  for (const [name, raw] of Object.entries(files)) {
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const n = enc.encode(name)
    const local = new DataView(new ArrayBuffer(30 + n.length + data.length))
    local.setUint32(0, 0x04034b50, true); local.setUint16(8, deflate ? 8 : 0, true)
    local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true); local.setUint16(26, n.length, true)
    new Uint8Array(local.buffer).set(n, 30); new Uint8Array(local.buffer).set(data, 30 + n.length)
    const central = new DataView(new ArrayBuffer(46 + n.length))
    central.setUint32(0, 0x02014b50, true); central.setUint16(10, deflate ? 8 : 0, true)
    central.setUint32(20, data.length, true); central.setUint32(24, raw.length, true); central.setUint16(28, n.length, true)
    central.setUint32(42, offset, true); new Uint8Array(central.buffer).set(n, 46)
    locals.push(new Uint8Array(local.buffer)); centrals.push(new Uint8Array(central.buffer))
    offset += local.byteLength
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, centrals.length, true); end.setUint16(10, centrals.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

// ---- tests -----------------------------------------------------------------------------

describe('FOOD_PHOTO_LIMIT', () => {
  it('is 300 photos per person, as in ADR 0012', () => {
    expect(FOOD_PHOTO_LIMIT).toBe(300)
  })
})

describe('isPhotoName', () => {
  it('takes JPEG, PNG, WebP and HEIC, in any case', () => {
    for (const ok of ['a.jpg', 'B.JPEG', 'c.png', 'd.webp', 'Food/IMG_1.HEIC', 'e.heif']) expect([ok, isPhotoName(ok)]).toEqual([ok, true])
  })

  it('skips other files, macOS extras and hidden files', () => {
    for (const no of ['clip.mp4', 'IMG_1.jpg.json', 'notes.txt', '__MACOSX/Food/._a.jpg', 'Food/.hidden.jpg', 'Food/']) {
      expect([no, isPhotoName(no)]).toEqual([no, false])
    }
  })
})

describe('unzipEntries', () => {
  it('reads stored and deflated files, with their folders', async () => {
    const a = jpeg({ lat: 52.38, lon: 4.64 })
    for (const deflate of [false, true]) {
      const files = await unzipEntries(zip({ 'Food/a.jpg': a, 'Food/b.txt': new TextEncoder().encode('hi') }, { deflate }))
      expect(files.map(f => f.name)).toEqual(['Food/a.jpg', 'Food/b.txt'])
      expect(files[0].bytes).toEqual(a)
    }
  })

  it('refuses something that is not a ZIP', async () => {
    await expect(unzipEntries(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/not_zip/)
  })
})

describe('readExif', () => {
  it('reads GPS and the date taken', () => {
    const out = readExif(jpeg({ lat: 13.7563, lon: 100.5018, date: '2025:03:14 19:30:00' }))
    expect(out.gps.lat).toBeCloseTo(13.7563, 3)
    expect(out.gps.lon).toBeCloseTo(100.5018, 3)
    expect(out.takenOn).toBe('2025-03-14')
  })

  it('handles south and west', () => {
    const { gps } = readExif(jpeg({ lat: -33.8688, lon: -70.6693 }))
    expect(gps.lat).toBeCloseTo(-33.8688, 3)
    expect(gps.lon).toBeCloseTo(-70.6693, 3)
  })

  it('gives no location for a photo without GPS, and no date when there is none', () => {
    expect(readExif(jpeg({ date: '2025:03:14 19:30:00' }))).toEqual({ gps: null, takenOn: '2025-03-14' })
    expect(readExif(plainJpeg())).toEqual({ gps: null, takenOn: null })
  })

  it('treats 0,0 (a camera with no fix) as no location', () => {
    expect(readExif(jpeg({ lat: 0, lon: 0 })).gps).toBeNull()
  })

  it('ignores a date it cannot read', () => {
    expect(readExif(jpeg({ date: '0000:00:00 00:00:00' })).takenOn).toBeNull()
  })

  it('never throws on broken bytes', () => {
    const broken = jpeg({ lat: 1, lon: 1 }).slice(0, 60)
    expect(() => readExif(broken)).not.toThrow()
    expect(readExif(new Uint8Array(0))).toEqual({ gps: null, takenOn: null })
  })
})

describe('hasGps', () => {
  it('spots GPS left in a file (the check after shrinking)', () => {
    expect(hasGps(jpeg({ lat: 52.38, lon: 4.64 }))).toBe(true)
    expect(hasGps(jpeg({ date: '2025:03:14 19:30:00' }))).toBe(false)
    expect(hasGps(plainJpeg())).toBe(false)
  })
})

describe('coarsen', () => {
  it('rounds to one decimal (about 10 km) for the city lookup', () => {
    expect(coarsen({ lat: 52.38124, lon: 4.63671 })).toEqual({ lat: 52.4, lon: 4.6 })
    expect(coarsen({ lat: -33.86882, lon: -70.66931 })).toEqual({ lat: -33.9, lon: -70.7 })
  })

  it('gives null for no location', () => {
    expect(coarsen(null)).toBeNull()
  })
})

describe('photoPlan', () => {
  it('sorts a batch into with a location, without one, and unreadable, keeping order', () => {
    const plan = photoPlan([
      { name: 'a.jpg', exif: { gps: { lat: 1, lon: 2 }, takenOn: '2025-01-01' } },
      { name: 'b.jpg', exif: { gps: null, takenOn: null } },
      { name: 'c.heic', error: 'unsupported' },
      { name: 'd.jpg', exif: { gps: { lat: 3, lon: 4 }, takenOn: null } },
    ])
    expect(plan.withLocation.map(p => p.name)).toEqual(['a.jpg', 'd.jpg'])
    expect(plan.withoutLocation.map(p => p.name)).toEqual(['b.jpg'])
    expect(plan.unreadable.map(p => p.name)).toEqual(['c.heic'])
  })

  it('stops at the photos still allowed under the limit, and says how many were left out', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}.jpg`, exif: { gps: null, takenOn: null } }))
    const plan = photoPlan(items, { room: 3 })
    expect(plan.withoutLocation.map(p => p.name)).toEqual(['p0.jpg', 'p1.jpg', 'p2.jpg'])
    expect(plan.overLimit).toBe(2)
  })
})
