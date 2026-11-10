// Turns a shopper's search (often English) into the Dutch words Albert Heijn uses on its
// products, with Gemini (the model parse-recipe uses). Best effort: any failure, slow
// answer or odd reply gives null and the caller searches the words as typed. Only the
// search words are sent; nothing about the user. The query is never logged.

const MODEL = 'gemini-3.5-flash-lite'
const TIMEOUT_MS = 6_000

const PROMPT = `You turn a shopper's supermarket search into the words Albert Heijn, a Dutch supermarket, uses in its product names.
Reply only with JSON: {"dutch": "<1 to 5 Dutch words>"}.
If the search is already Dutch, return it unchanged. Use the everyday product name a Dutch shopper would type, not a recipe or a description.
Examples: "crushed tomatoes" → "tomatenblokjes"; "cilantro" → "koriander"; "ground beef" → "rundergehakt"; "chicken thighs" → "kippendijen"; "laundry detergent" → "wasmiddel"; "sweet onions" → "zoete uien"; "halfvolle melk" → "halfvolle melk".
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
