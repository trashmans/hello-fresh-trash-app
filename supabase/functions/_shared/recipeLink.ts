// Importing a recipe from a web link (docs/adr/0009). Pure helpers, used by the
// import-recipe Edge Function and tested with Vitest (src/tests/recipeLink.test.js):
//   checkRecipeUrl()     is this a public https web page? (and tidy it)
//   isPrivateAddress()   refuse private, local and special IP addresses (checked for every
//                        address a host resolves to, on every redirect: no SSRF)
//   parseIsoDuration()   "PT1H20M" → 80 minutes
//   extractRecipeData()  the schema.org Recipe most recipe sites publish as JSON-LD
//   pageText()           readable page text for Gemini when there is no Recipe data
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

function steps(value: Json): string[] {
  if (typeof value === 'string') return value.split(/\n+/).map(clean).filter(Boolean)
  if (Array.isArray(value)) return value.flatMap(steps)
  if (value && typeof value === 'object') {
    if (value.itemListElement) return steps(value.itemListElement)
    const text = clean(value.text) || clean(value.name)
    return text ? [text] : []
  }
  return []
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
      return {
        name: clean(r.name) || null,
        ingredients,
        steps: steps(r.recipeInstructions),
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
