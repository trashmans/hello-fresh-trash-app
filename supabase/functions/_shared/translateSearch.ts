// Turns a shopper's search (often English) into the Dutch words Albert Heijn uses on its
// products, with Gemini (the model parse-recipe uses). Best effort: any failure, slow
// answer or odd reply gives null and the caller searches the words as typed. Only the
// search words are sent; nothing about the user. The query is never logged.

const MODEL = 'gemini-3.5-flash-lite'
const TIMEOUT_MS = 6_000

const PROMPT = `You turn a shopper's supermarket search into the words Albert Heijn, a Dutch supermarket, uses in its product names.
Reply only with JSON: {"dutch": "<1 to 5 Dutch words>"}.
If the search is already Dutch, return it unchanged. Use the everyday product name a Dutch shopper would type, not a recipe or a description.
Drop words that narrow the search more than a shopper would (brands, "concentrate", "microwavable", "Thai", sizes); AH sells the common product.
Examples: "crushed tomatoes" → "tomatenblokjes"; "cilantro" → "koriander"; "ground beef" → "rundergehakt"; "chicken thighs" → "kippendijen"; "laundry detergent" → "wasmiddel"; "sweet onions" → "zoete uien"; "chicken stock concentrate" → "kippenbouillon"; "sweet thai chilli sauce" → "zoete chilisaus"; "jasmine rice" → "pandan rijst"; "halfvolle melk" → "halfvolle melk".
Search: `

export async function translateSearchToDutch(query: string, apiKey: string | undefined): Promise<string | null> {
  if (!apiKey) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT + JSON.stringify(query) }] }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } },
      }),
    })
    if (!res.ok) {
      await res.body?.cancel()
      console.warn(`translateSearch: Gemini status ${res.status}`)
      return null
    }
    const data = await res.json()
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
    const dutch = JSON.parse(text)?.dutch
    return typeof dutch === 'string' ? dutch : null
  } catch (err) {
    console.warn(`translateSearch: no translation (${(err as Error)?.name})`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// The slower, more reliable way for "Suggest AH products": Gemini searches Google for
// "Albert Heijn <ingredient>" (Google Search grounding) and reports the words AH uses in
// that product's name, the way a person would find it. Dutch food names are often not
// the direct translation ("jasmine rice" is sold as "pandan rijst"). Best effort like
// the translation: any failure or slow answer gives null. Only the ingredient name is
// sent. Billed per search after the monthly free allowance (Gemini API pricing).
const SEARCH_TIMEOUT_MS = 15_000
const SEARCH_PROMPT = `Search the web for the Albert Heijn (Dutch supermarket) product a shopper would buy for this recipe ingredient, as if searching Google for "Albert Heijn <ingredient>".
Reply only with JSON, no other text: {"dutch": "<1 to 4 words AH uses in that product's name, without the brand>"}.
Prefer the common everyday product over a specialty one. Ingredient: `

export async function findAhNameWithSearch(ingredient: string, apiKey: string | undefined): Promise<string | null> {
  if (!apiKey) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: SEARCH_PROMPT + JSON.stringify(ingredient) }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0 },
      }),
    })
    if (!res.ok) {
      await res.body?.cancel()
      console.warn(`findAhName: Gemini status ${res.status}`)
      return null
    }
    const data = await res.json()
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
    // Grounded answers can't be forced into JSON mode, so take the first {...} in the reply.
    const match = text.match(/\{[^{}]*\}/)
    const dutch = match ? JSON.parse(match[0])?.dutch : null
    return typeof dutch === 'string' && dutch.trim() ? dutch.trim() : null
  } catch (err) {
    console.warn(`findAhName: no answer (${(err as Error)?.name})`)
    return null
  } finally {
    clearTimeout(timer)
  }
}
