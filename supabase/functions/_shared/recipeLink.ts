// Importing a recipe from a web link (docs/adr/0009). Pure helpers, used by the
// import-recipe Edge Function and tested with Vitest (src/tests/recipeLink.test.js):
//   checkRecipeUrl()     is this a public https web page? (and tidy it)
//   isPrivateAddress()   refuse private, local and special IP addresses (checked for every
//                        address a host resolves to, on every redirect: no SSRF)
//   parseIsoDuration()   "PT1H20M" → 80 minutes
//   extractRecipeData()  the schema.org Recipe most recipe sites publish as JSON-LD
//   pageText()           readable page text for Gemini when there is no Recipe data
//   helloFreshStepImages() HelloFresh.com step photos, from the page's Next.js data
//   pagePhotos()         the photos in a post ("Photos from the page"), for sites whose
//                        step photos are not tied to steps
// No I/O, no Deno or Node APIs (only URL, which both have).

export const MAX_URL_LENGTH = 2048
export const MAX_PAGE_TEXT = 30_000

// deno-lint-ignore no-explicit-any
type Json = any

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string }

const TRACKING = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', '_ga', 'yclid'])
const LOCAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa', '.intranet', '.corp']
const BAD_LINK = 'Paste a link to a recipe page, like https://www.example.com/recipe.'

/** → { ok: true, url } (https, lower-case host, no tracking parameters or #fragment) or { ok: false, message }. */
export function checkRecipeUrl(raw: unknown): UrlCheck {
  if (typeof raw !== 'string') return { ok: false, message: BAD_LINK }
  let text = raw.trim()
  if (!text) return { ok: false, message: BAD_LINK }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`

  let url: URL
  try { url = new URL(text) } catch { return { ok: false, message: BAD_LINK } }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, message: BAD_LINK }
  url.protocol = 'https:'
  if (url.username || url.password || url.port) return { ok: false, message: BAD_LINK }

  const host = url.hostname.toLowerCase()
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')
  if (isIp || !host.includes('.') || host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, message: BAD_LINK }
  }

  url.hash = ''
  const params = new URLSearchParams(url.search)
  for (const key of [...params.keys()]) {
    if (/^utm_/i.test(key) || TRACKING.has(key.toLowerCase())) params.delete(key)
  }
  const query = params.toString()
  url.search = query ? `?${query}` : ''

  const href = url.href
  if (href.length > MAX_URL_LENGTH) return { ok: false, message: 'That link is too long.' }
  return { ok: true, url: href }
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null
  const nums = parts.map(Number)
  return nums.every((n) => n <= 255) ? nums : null
}

function privateIpv4([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
}

/** True for private, loopback, link-local, multicast and other special addresses, and for anything unreadable. */
export function isPrivateAddress(raw: string): boolean {
  const ip = String(raw ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  const v4 = parseIpv4(ip)
  if (v4) return privateIpv4(v4)
  if (!ip.includes(':') || !/^[0-9a-f:.]+$/.test(ip)) return true

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) {
    const inner = parseIpv4(mapped[1])
    return inner ? privateIpv4(inner) : true
  }
  if (ip.startsWith('::')) return true // ::, ::1, IPv4-compatible and other special forms
  const first = parseInt(ip.split(':')[0], 16)
  if (Number.isNaN(first)) return true
  return (first & 0xfe00) === 0xfc00   // unique local fc00::/7
    || (first & 0xffc0) === 0xfe80     // link-local fe80::/10
    || (first & 0xff00) === 0xff00     // multicast ff00::/8
    || first === 0x2001 && ip.startsWith('2001:db8') // documentation
}

/** ISO 8601 duration → whole minutes, or null (also for zero). */
export function parseIsoDuration(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!m || raw.trim() === 'P' || raw.trim().toUpperCase() === 'PT') return null
  const [, d, h, min, s] = m
  const total = Math.round(Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Number(s ?? 0) / 60)
  return total > 0 ? total : null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, code: string) => {
    const lower = code.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)))
    return ENTITIES[lower] ?? whole
  })
}

/** Plain text: no tags, entities decoded, single spaces. */
function clean(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function isRecipe(node: Json): boolean {
  const type = node?.['@type']
  return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))
}

function findRecipes(node: Json, out: Json[] = []): Json[] {
  if (Array.isArray(node)) { for (const n of node) findRecipes(n, out); return out }
  if (!node || typeof node !== 'object') return out
  if (isRecipe(node)) out.push(node)
  if (node['@graph']) findRecipes(node['@graph'], out)
  if (node.mainEntity) findRecipes(node.mainEntity, out)
  return out
}

// Each step's text with its own image (HowToStep.image), or null.
function stepItems(value: Json): { text: string; image: string | null }[] {
  if (typeof value === 'string') return value.split(/\n+/).map(clean).filter(Boolean).map((text) => ({ text, image: null }))
  if (Array.isArray(value)) return value.flatMap(stepItems)
  if (value && typeof value === 'object') {
    if (value.itemListElement) return stepItems(value.itemListElement)
    const text = clean(value.text) || clean(value.name)
    return text ? [{ text, image: httpsUrl(imageUrl(value.image ?? null)) }] : []
  }
  return []
}

// The link when it is a valid https URL, else null.
function httpsUrl(raw: string | null): string | null {
  if (!raw) return null
  try { return new URL(raw).protocol === 'https:' ? raw : null } catch { return null }
}

function imageUrl(value: Json): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    for (const v of value) { const u = imageUrl(v); if (u) return u }
    return null
  }
  if (value && typeof value === 'object') return imageUrl(value.url ?? value.contentUrl ?? null)
  return null
}

function ogImage(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
  return m ? decodeEntities(m[1]).trim() : null
}

export interface RecipeData {
  name: string | null
  ingredients: string[]
  steps: string[]
  /** Each step's own image (https), lined up with steps; null where a step has none. */
  stepImages: (string | null)[]
  image: string | null
  servings: string | null
  prepMinutes: number | null
  cookMinutes: number | null
  totalMinutes: number | null
  calories: string | null
}

/** The first schema.org Recipe on the page that has ingredients, or null. */
export function extractRecipeData(html: string): RecipeData | null {
  const blocks = [...String(html ?? '').matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)]
  for (const [, body] of blocks) {
    let json: Json
    try { json = JSON.parse(body.trim()) } catch { continue }
    for (const r of findRecipes(json)) {
      const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient
        : Array.isArray(r.ingredients) ? r.ingredients : []).map(clean).filter(Boolean)
      if (ingredients.length === 0) continue
      const yieldValue = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield
      const items = stepItems(r.recipeInstructions)
      return {
        name: clean(r.name) || null,
        ingredients,
        steps: items.map((i) => i.text),
        stepImages: items.map((i) => i.image),
        image: imageUrl(r.image) ?? ogImage(html),
        servings: clean(yieldValue) || null,
        prepMinutes: parseIsoDuration(r.prepTime),
        cookMinutes: parseIsoDuration(r.cookTime),
        totalMinutes: parseIsoDuration(r.totalTime),
        calories: clean(r.nutrition?.calories) || null,
      }
    }
  }
  return null
}

/** The page's readable text (no scripts, styles or tags), at most MAX_PAGE_TEXT characters. */
export function pageText(html: string): string {
  const text = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_TEXT)
}

/** The page's og:image, for a cover when the Recipe data has none (or there is no Recipe data). */
export function pageImage(html: string): string | null {
  return ogImage(String(html ?? ''))
}

const HELLOFRESH_HOST = /^(www\.)?hellofresh\.(com|nl|de|fr|be|at|ch|se|dk|no|ie|it|es|lu|ca|co\.uk|com\.au|co\.nz)$/
const HELLOFRESH_PATH = /^\/[A-Za-z0-9_\-/]+\.(jpe?g|png|webp)$/i
const HELLOFRESH_MEDIA = 'https://media.hellofresh.com/w_750,q_auto,f_auto,c_limit,fl_lossy/hellofresh_s3'

// The first object (depth-first) with a steps list whose items have instructions.
function findHfSteps(node: Json, depth = 0): Json[] | null {
  if (!node || typeof node !== 'object' || depth > 12) return null
  if (Array.isArray(node)) {
    for (const n of node) { const found = findHfSteps(n, depth + 1); if (found) return found }
    return null
  }
  const steps = node.steps
  if (Array.isArray(steps) && steps.length > 0 && steps.every((st: Json) => st && typeof st === 'object' && 'instructions' in st)) return steps
  for (const v of Object.values(node)) { const found = findHfSteps(v as Json, depth + 1); if (found) return found }
  return null
}

/**
 * HelloFresh.com step photos, one per step in step order (null where a step has none),
 * from the page's Next.js data; null for other sites, or when there are no photos at all.
 */
export function helloFreshStepImages(html: string, pageUrl: string): (string | null)[] | null {
  let host = ''
  try { host = new URL(pageUrl).hostname.toLowerCase() } catch { return null }
  if (!HELLOFRESH_HOST.test(host)) return null
  const m = String(html ?? '').match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return null
  let data: Json
  try { data = JSON.parse(m[1]) } catch { return null }
  const steps = findHfSteps(data)
  if (!steps) return null
  const ordered = steps
    .map((st, i) => ({ st, order: Number.isFinite(Number(st.index)) ? Number(st.index) : i }))
    .sort((a, b) => a.order - b.order)
  const urls = ordered.map(({ st }) => {
    const path = Array.isArray(st.images) ? st.images[0]?.path : null
    return typeof path === 'string' && HELLOFRESH_PATH.test(path) && !path.includes('..') ? `${HELLOFRESH_MEDIA}${path}` : null
  })
  return urls.some(Boolean) ? urls : null
}

export const PAGE_PHOTOS_MAX = 6
const PHOTO_EXT = /\.(jpe?g|png|webp)$/i
const NOT_A_PHOTO = /logo|avatar|author|gravatar|icon|badge|sprite|emoji|headshot|profile/i
const SIZE_SUFFIX = /-(\d+)x(\d+)(?=\.[a-z0-9]+$)/i

function imgAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
  }
  return attrs
}

// Same photo, any size: host + path without a "-1024x683" size suffix, lower case.
function photoKey(url: URL): string {
  return `${url.hostname}${url.pathname.replace(SIZE_SUFFIX, '')}`.toLowerCase()
}

/**
 * The photos in the post (its <article>, else the whole page), in page order, at most
 * PAGE_PHOTOS_MAX: https JPG/PNG/WebP only; no logos, author photos, icons, small images
 * or small thumbnails; one per photo whatever its size; none of the exclude photos (the cover).
 */
export function pagePhotos(html: string, pageUrl: string, exclude: string[] = []): string[] {
  const page = String(html ?? '')
  const region = page.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ?? page
  const seen = new Set<string>()
  for (const raw of exclude) { try { seen.add(photoKey(new URL(raw))) } catch { /* skip */ } }
  const out: string[] = []
  for (const [tag] of region.matchAll(/<img\b[^>]*>/gi)) {
    if (out.length >= PAGE_PHOTOS_MAX) break
    const a = imgAttributes(tag)
    const src = [a['data-lazy-src'], a['data-src'], a['data-original'], a.src].find((v) => v && !v.trim().startsWith('data:'))?.trim()
    if (!src) continue
    let url: URL
    try { url = new URL(src, pageUrl) } catch { continue }
    if (url.protocol !== 'https:' || !PHOTO_EXT.test(url.pathname)) continue
    const file = url.pathname.split('/').pop() ?? ''
    if (NOT_A_PHOTO.test(`${file} ${a.alt ?? ''} ${a.class ?? ''}`)) continue
    const w = Number(a.width), h = Number(a.height)
    if ((w > 0 || h > 0) && Math.max(w || 0, h || 0) < 300) continue
    const size = file.match(SIZE_SUFFIX)
    if (size && Math.max(Number(size[1]), Number(size[2])) < 500) continue
    const key = photoKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url.href)
  }
  return out
}

/** The Recipe data written out like a recipe card: what Gemini reads in place of a PDF. */
export function recipeSourceText(data: RecipeData, url: string): string {
  const head = [`Recipe from ${url}`]
  if (data.name) head.push(`Title: ${data.name}`)
  if (data.servings) head.push(`Servings: ${data.servings}`)
  if (data.prepMinutes) head.push(`Prep time: ${data.prepMinutes} minutes`)
  if (data.cookMinutes) head.push(`Cook time: ${data.cookMinutes} minutes`)
  if (data.totalMinutes) head.push(`Total time: ${data.totalMinutes} minutes`)
  if (data.calories) head.push(`Calories: ${data.calories}`)
  const parts = [head.join('\n'), ['Ingredients:', ...data.ingredients.map((i) => `- ${i}`)].join('\n')]
  if (data.steps.length) parts.push(['Steps:', ...data.steps.map((s, i) => `${i + 1}. ${s}`)].join('\n'))
  return parts.join('\n\n')
}

/** recipes.filename for a link recipe, e.g. "example.com/sweet-potato-tacos" (max 120 characters). */
export function linkFilename(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const last = u.pathname.split('/').filter(Boolean).pop()
    let name = host
    if (last) {
      let segment = last
      try { segment = decodeURIComponent(last) } catch { /* keep as is */ }
      name = `${host}/${segment}`
    }
    return name.slice(0, 120)
  } catch {
    return String(url ?? '').slice(0, 120)
  }
}
