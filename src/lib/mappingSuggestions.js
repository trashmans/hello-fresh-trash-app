// "Suggest AH products" on this week's preview: which recipe ingredients are still free
// text on the plan, and which search result to suggest for each. The search itself is the
// Staples screen's (retailer-products: Gemini turns the name into Dutch, then AH is
// searched); suggestions only become mappings when someone accepts them. Pure: no I/O.

/** Most ingredients looked up per press, to keep the number of AH searches low. */
export const SUGGEST_LIMIT = 15

const normalize = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const words = (text) => normalize(text).split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Recipe ingredients on the preview that are still free text: lines that would be
 * added and lines already on the AH list. Each once (case and spaces ignored), in
 * that order, at most SUGGEST_LIMIT.
 */
export function unmappedLines(preview) {
  const seen = new Set()
  const out = []
  const add = (text) => {
    const key = normalize(text)
    if (!key || seen.has(key) || out.length >= SUGGEST_LIMIT) return
    seen.add(key)
    out.push(String(text).trim())
  }
  for (const c of preview?.changes ?? []) {
    if (c.productId == null && (c.sources ?? []).includes('recipe')) add(c.text)
  }
  for (const l of preview?.onListAlready ?? []) {
    if (l.productId == null) add(l.text)
  }
  return out
}

/**
 * The product to suggest from one search ({ products, searchedFor }, as retailer-products
 * returns it; searchedFor[0] is the Dutch term). Prefers a product whose name has every
 * whole word of that term, then AH's own brand, then AH's order. Returns { product, sure }
 * (sure: every word matched), or null when there is nothing to suggest.
 */
export function pickSuggestion({ products, searchedFor } = {}) {
  if (!Array.isArray(products) || products.length === 0) return null
  const termWords = words(searchedFor?.[0])
  const score = (p) => {
    const title = new Set(words(p.title))
    const all = termWords.length > 0 && termWords.every((w) => title.has(w))
    return (all ? 2 : 0) + (normalize(p.title).startsWith('ah ') ? 1 : 0)
  }
  let best = products[0]
  let bestScore = score(best)
  for (const p of products.slice(1)) {
    const s = score(p)
    if (s > bestScore) { best = p; bestScore = s }
  }
  return { product: best, sure: bestScore >= 2 }
}
