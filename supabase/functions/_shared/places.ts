// Food map place search (docs/adr/0012): what we ask Geoapify and what we keep of its answer.
// Pure functions; place-search/index.ts does the fetching.
//
// Geoapify (EU-hosted, OpenStreetMap data) replaced OpenStreetMap's own Nominatim on 28 Nov
// 2026: Nominatim blocked Supabase's shared servers (403 on every request). Free plan: 3,000
// lookups a day, 5 a second; results shown with "Powered by Geoapify" and OpenStreetMap's
// credit. Reverse lookups only ever get the coarse cell (1 decimal, ~11 km); typed searches
// run only when the person presses Search.

export const GEOAPIFY = 'https://api.geoapify.com/v1/geocode'
export const ATTRIBUTION = 'Powered by Geoapify · © OpenStreetMap contributors'
const LANGUAGE = 'en'
const MAX_LABEL = 200
const MAX_DETAIL = 300
const MAX_RESULTS = 5

export type Cell = { lat: number; lon: number }
export type PlaceRequest = ({ mode: 'reverse' } & Cell) | { mode: 'search'; q: string }
export type Place = { label: string; detail: string; lat: number; lon: number; precision: 'city' | 'exact' }

// Geoapify's result_type for a whole town, part of one, region or country: stored as city
// level, not an exact spot.
const AREA_TYPES = new Set(['city', 'suburb', 'district', 'postcode', 'county', 'state', 'country'])

// Rounds and turns -0 into 0.
const round = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals + 0

const inRange = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180

export function checkPlaceRequest(body: unknown): PlaceRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.mode === 'reverse') {
    if (typeof b.lat !== 'number' || typeof b.lon !== 'number' || !inRange(b.lat, b.lon)) return null
    return { mode: 'reverse', lat: round(b.lat, 1), lon: round(b.lon, 1) }
  }
  if (b.mode === 'search') {
    if (typeof b.q !== 'string') return null
    const q = b.q.replace(/\s+/g, ' ').trim()
    return q.length >= 2 && q.length <= 120 ? { mode: 'search', q } : null
  }
  return null
}

const url = (path: string, params: Record<string, string>) => `${GEOAPIFY}/${path}?${new URLSearchParams(params)}`

export const reverseUrl = (cell: Cell, apiKey: string) => url('reverse', {
  lat: String(cell.lat), lon: String(cell.lon), type: 'city', lang: LANGUAGE, format: 'json', apiKey,
})

export const searchUrl = (q: string, apiKey: string) => url('search', {
  text: q, limit: String(MAX_RESULTS), lang: LANGUAGE, format: 'json', apiKey,
})

export const cacheKey = (cell: Cell) => `geoapify:${cell.lat.toFixed(1)},${cell.lon.toFixed(1)}:${LANGUAGE}`

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

// Joins the non-empty parts, skipping repeats (case-insensitive), capped at max characters.
function join(parts: unknown[], max: number): string {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const p of parts.map(text)) {
    if (p && !seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); kept.push(p) }
  }
  const s = kept.join(', ')
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}

function coords(r: Record<string, unknown>): Cell | null {
  if (typeof r.lat !== 'number' && typeof r.lat !== 'string') return null
  if (typeof r.lon !== 'number' && typeof r.lon !== 'string') return null
  const lat = Number(r.lat)
  const lon = Number(r.lon)
  return inRange(lat, lon) ? { lat: round(lat, 5), lon: round(lon, 5) } : null
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

// The results list of a Geoapify reply (format=json), or [] for an error or anything else.
const results = (data: unknown): unknown[] => {
  const list = record(data).results
  return Array.isArray(list) ? list : []
}

// The nearest city for a coarse cell, with the city's own coordinates; null for the sea or an error.
export function placeFromReverse(data: unknown): Place | null {
  const r = record(results(data)[0])
  const at = coords(r)
  if (!at) return null
  const city = text(r.city) || text(r.county) || text(r.state) || text(r.name)
  if (!city) return null
  return { label: join([city, r.country], MAX_LABEL), detail: join([city, r.state, r.country], MAX_DETAIL), ...at, precision: 'city' }
}

// Up to 5 places for a typed search: a short label (name, town, country), the full address, and
// whether it is a town or area ('city') or a spot such as a restaurant ('exact').
export function placesFromSearch(data: unknown): Place[] {
  const out: Place[] = []
  const seen = new Set<string>()
  for (const item of results(data)) {
    const r = record(item)
    const at = coords(r)
    if (!at) continue
    const name = text(r.name) || text(r.address_line1)
    if (!name) continue
    const label = join([name, r.city, r.country], MAX_LABEL)
    if (seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    const precision = AREA_TYPES.has(text(r.result_type)) ? 'city' : 'exact'
    out.push({ label, detail: join([r.formatted], MAX_DETAIL) || label, ...at, precision })
    if (out.length === MAX_RESULTS) break
  }
  return out
}
