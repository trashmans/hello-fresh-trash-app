// Food map place search (docs/adr/0012, F1c): what we ask OpenStreetMap's Nominatim and what
// we keep of its answer. Pure functions; place-search/index.ts does the fetching.
//
// Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/): at most
// one request a second for the whole app, an identifying User-Agent, caching, attribution,
// no autocomplete (search only when the person presses Search), no systematic or bulk lookups,
// no personal data. Reverse lookups only ever get the coarse cell (1 decimal, ~11 km).

export const NOMINATIM = 'https://nominatim.openstreetmap.org'
export const USER_AGENT = 'HelloFreshTrash/1.0 (+https://hello-fresh-trash-app.vercel.app)'
export const ATTRIBUTION = '© OpenStreetMap contributors'
const LANGUAGE = 'en'
const MAX_LABEL = 200
const MAX_DETAIL = 300
const MAX_RESULTS = 5

export type Cell = { lat: number; lon: number }
export type PlaceRequest = ({ mode: 'reverse' } & Cell) | { mode: 'search'; q: string }
export type Place = { label: string; detail: string; lat: number; lon: number }

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

const url = (path: string, params: Record<string, string>) => `${NOMINATIM}/${path}?${new URLSearchParams(params)}`

export const reverseUrl = (cell: Cell) => url('reverse', {
  format: 'jsonv2', lat: String(cell.lat), lon: String(cell.lon), zoom: '10', addressdetails: '1', 'accept-language': LANGUAGE,
})

export const searchUrl = (q: string) => url('search', {
  format: 'jsonv2', q, limit: String(MAX_RESULTS), addressdetails: '1', 'accept-language': LANGUAGE,
})

export const cacheKey = (cell: Cell) => `reverse:${cell.lat.toFixed(1)},${cell.lon.toFixed(1)}:${LANGUAGE}`

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
  const lat = Number(r.lat)
  const lon = Number(r.lon)
  if (typeof r.lat !== 'string' && typeof r.lat !== 'number') return null
  if (typeof r.lon !== 'string' && typeof r.lon !== 'number') return null
  return inRange(lat, lon) ? { lat: round(lat, 5), lon: round(lon, 5) } : null
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const locality = (a: Record<string, unknown>) =>
  text(a.city) || text(a.town) || text(a.village) || text(a.municipality)

// The nearest city for a coarse cell, with the city's own coordinates; null for the sea or an error.
export function placeFromReverse(data: unknown): Place | null {
  const r = record(data)
  if (r.error) return null
  const at = coords(r)
  if (!at) return null
  const a = record(r.address)
  const city = locality(a) || text(a.county) || text(a.state) || text(r.name)
  if (!city) return null
  return { label: join([city, a.country], MAX_LABEL), detail: join([city, a.state, a.country], MAX_DETAIL), ...at }
}

// Up to 5 places for a typed search: a short label (name, town, country) and the full address.
export function placesFromSearch(data: unknown): Place[] {
  if (!Array.isArray(data)) return []
  const out: Place[] = []
  const seen = new Set<string>()
  for (const item of data) {
    const r = record(item)
    const at = coords(r)
    if (!at) continue
    const a = record(r.address)
    const name = text(r.name) || text(r.display_name).split(',')[0]?.trim() || ''
    if (!name) continue
    const label = join([name, locality(a), a.country], MAX_LABEL)
    if (seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    out.push({ label, detail: join([r.display_name], MAX_DETAIL) || label, ...at })
    if (out.length === MAX_RESULTS) break
  }
  return out
}
