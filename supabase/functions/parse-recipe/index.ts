import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

// gemini-2.5-flash is only served to Google accounts that used it before, so
// a newly created Gemini API project gets a 404 for it. Gemini 3.5 Flash-Lite
// is one of the models Google recommends for new projects: fast, cheap, and
// able to run with minimal thinking, which suits structured extraction.
// When Google reports it overloaded (500 / 503 "high demand"), retrying the
// same model a few seconds later usually fails again, so the retry goes to
// Gemini 3.8 Flash instead. Gemini 3 models set thinking with a level, and
// each model has its own lowest level ('low' is 3.8 Flash's minimum).
interface GeminiModel { id: string; thinkingLevel: string }
const GEMINI_PRIMARY: GeminiModel = { id: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal' }
const GEMINI_FALLBACK: GeminiModel = { id: 'gemini-3.8-flash', thinkingLevel: 'low' }
const geminiUrl = (model: GeminiModel) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${GEMINI_API_KEY}`

// Gemini timing. A recipe extraction usually takes 15–25 s; the old fixed 25 s timeout
// aborted slower ones (e.g. "unexpected: The signal has been aborted"). The whole Edge
// Function must finish within its wall-clock limit (150 s on the free plan), so all Gemini
// attempts share one budget that leaves time for the database work before and after.
const GEMINI_ATTEMPT_TIMEOUT_MS = 75_000
const GEMINI_TOTAL_BUDGET_MS = 120_000
const GEMINI_MIN_RETRY_BUDGET_MS = 20_000
// Rate limited (429) or timed out: one retry on the same model. Overloaded
// (500 / 503): Google usually refuses within seconds, so keep trying while the
// budget lasts, alternating models with growing waits (up to 4 attempts).
const GEMINI_RATE_LIMITED_STATUS = new Set([429])
const GEMINI_OVERLOADED_STATUS = new Set([500, 503])
const GEMINI_OVERLOADED_WAITS_MS = [1000, 5000, 15000] // before attempts 2, 3, 4

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Decides the retry after failed attempt number `attempt`: which model, and
// how long to wait first. null means don't retry (the response is final).
// outcome is the HTTP status, or 'timeout' when the attempt was aborted.
function planGeminiRetry(outcome: number | 'timeout', retryAfterHeader: string | null, attempt = 1):
  { model: GeminiModel; waitMs: number } | null {
  if (GEMINI_OVERLOADED_STATUS.has(outcome as number)) {
    const waitMs = GEMINI_OVERLOADED_WAITS_MS[attempt - 1]
    if (waitMs == null) return null
    // Attempt 1 used the primary, so even-numbered attempts use the fallback.
    return { model: (attempt + 1) % 2 === 0 ? GEMINI_FALLBACK : GEMINI_PRIMARY, waitMs }
  }
  if (attempt !== 1) return null
  if (outcome === 'timeout') return { model: GEMINI_PRIMARY, waitMs: 0 }
  if (GEMINI_RATE_LIMITED_STATUS.has(outcome)) {
    // Honour a short Retry-After from Gemini, otherwise wait 3 s.
    const seconds = Number(retryAfterHeader)
    return { model: GEMINI_PRIMARY, waitMs: seconds > 0 && seconds <= 10 ? seconds * 1000 : 3000 }
  }
  return null
}

// Calls Gemini: the primary model, then retries chosen by planGeminiRetry()
// while enough of the time budget is left. The payload's
// thinking setting is filled in per model. Returns the last response, or
// throws the last error.
async function callGemini(
  payload: { generationConfig: Record<string, unknown> } & Record<string, unknown>,
  log: (msg: string) => void,
): Promise<Response> {
  const started = Date.now()
  const remaining = () => GEMINI_TOTAL_BUDGET_MS - (Date.now() - started)
  let model = GEMINI_PRIMARY

  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(GEMINI_ATTEMPT_TIMEOUT_MS, remaining()))
    const body = {
      ...payload,
      generationConfig: { ...payload.generationConfig, thinkingConfig: { thinkingLevel: model.thinkingLevel } },
    }
    let retry: { model: GeminiModel; waitMs: number } | null = null
    try {
      const res = await fetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const planned = planGeminiRetry(res.status, res.headers.get('retry-after'), attempt)
        // Only retry if, after the wait, there's still time for a real attempt.
        if (planned && remaining() - planned.waitMs > GEMINI_MIN_RETRY_BUDGET_MS) retry = planned
      }
      if (!retry) {
        log(`Gemini model=${model.id} attempt=${attempt} status=${res.status}`)
        return res
      }
      await res.body?.cancel()
      log(`Gemini status=${res.status} from ${model.id} on attempt ${attempt}, retrying with ${retry.model.id} in ${retry.waitMs} ms`)
    } catch (err) {
      if (attempt === 1 && controller.signal.aborted && remaining() > GEMINI_MIN_RETRY_BUDGET_MS) {
        retry = planGeminiRetry('timeout', null)
        log(`Gemini ${model.id} timed out on attempt 1 after ${Date.now() - started} ms, retrying`)
      } else {
        throw err
      }
    } finally {
      clearTimeout(timer)
    }
    if (retry) {
      await sleep(retry.waitMs)
      model = retry.model
    }
  }
}

interface Ingredient {
  name: string
  canonical_name: string | null
  quantity: number | null
  unit: string | null
  preparation: string | null
  display_order: number
}

const NUTRITION_KEYS = [
  'calories_kcal', 'fat_g', 'saturated_fat_g', 'carbs_g',
  'sugar_g', 'fibre_g', 'protein_g', 'salt_g',
] as const
type NutritionKey = typeof NUTRITION_KEYS[number]

interface ParsedRecipe {
  name: string
  source_name: string | null
  cook_time_minutes: number | null
  prep_time_minutes: number | null
  servings: number | null
  difficulty: string | null
  cuisine: string | null
  protein_source: string | null
  nutrition_printed?: Partial<Record<NutritionKey, unknown>> | null
  nutrition_estimate?: Partial<Record<NutritionKey, unknown>> | null
  tags: string[]
  steps: string[]
  ingredients: Ingredient[]
}

// Gemini sometimes returns numbers as strings ("12 g"). A non-number in a
// numeric column would fail the whole recipe update, so coerce here and
// drop anything unusable. Calories round to whole numbers, grams to 0.1.
function toNutritionNumber(raw: unknown, key: NutritionKey): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN
  if (!Number.isFinite(n) || n < 0) return null
  return key === 'calories_kcal' ? Math.round(n) : Math.round(n * 10) / 10
}

// Gemini returns two separate objects: values read off the card
// (nutrition_printed) and its own estimate of every value
// (nutrition_estimate). We use the printed value where there is one and the
// estimate otherwise. Which values count as estimates is decided HERE, not
// by Gemini: asking it to list the fields it guessed proved unreliable (it
// sometimes estimated values and left the list empty).
function mergeNutrition(parsed: ParsedRecipe) {
  const values = {} as Record<NutritionKey, number | null>
  const estimated: NutritionKey[] = []
  for (const key of NUTRITION_KEYS) {
    const printed = toNutritionNumber(parsed.nutrition_printed?.[key], key)
    const estimate = toNutritionNumber(parsed.nutrition_estimate?.[key], key)
    values[key] = printed ?? estimate
    if (printed == null && estimate != null) estimated.push(key)
  }
  return { values, estimated }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function computeIngredientFingerprint(ingredients: Ingredient[]): Promise<string> {
  const sorted = ingredients.map(i => i.name.toLowerCase()).sort()
  return sha256Hex(sorted.join('|'))
}

Deno.serve(async (req) => {
  const executionId = crypto.randomUUID().slice(0, 8)
  console.log(`[${executionId}] invoked method=${req.method}`)

  let body: { record?: { id?: string } }
  try {
    body = await req.json()
  } catch {
    console.log(`[${executionId}] bad request — could not parse body`)
    return new Response('Bad Request', { status: 400 })
  }

  const recipeId = body?.record?.id
  console.log(`[${executionId}] recipeId=${recipeId}`)
  if (!recipeId) {
    console.log(`[${executionId}] missing recipe id in body`)
    return new Response('Missing recipe id', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Atomic claim — prevents double-processing on concurrent webhook deliveries
  const { data: claimed, error: claimError } = await supabase
    .from('recipes')
    .update({ status: 'processing', processing_started_at: new Date().toISOString() })
    .eq('id', recipeId)
    .eq('status', 'pending')
    .select('id, storage_path, retry_count')
    .maybeSingle()

  if (claimError) console.log(`[${executionId}] claim error: ${claimError.message}`)
  if (!claimed) {
    console.log(`[${executionId}] claim failed — already processing or not pending`)
    return new Response('Already processing or not pending', { status: 200 })
  }
  console.log(`[${executionId}] claimed recipe storage_path=${claimed.storage_path}`)

  async function setFailed(reason: string, incrementRetry = true) {
    console.log(`[${executionId}] setFailed reason=${reason}`)
    const update: Record<string, unknown> = {
      status: 'failed',
      rejection_reason: reason,
      processing_completed_at: new Date().toISOString(),
    }
    if (incrementRetry) {
      update.retry_count = (claimed.retry_count ?? 0) + 1
    }
    await supabase.from('recipes').update(update).eq('id', recipeId)
  }

  async function setRejected(existingId: string) {
    console.log(`[${executionId}] setRejected duplicate of ${existingId}`)
    await supabase.from('recipes').update({
      status: 'rejected',
      rejection_reason: `duplicate:${existingId}`,
      processing_completed_at: new Date().toISOString(),
    }).eq('id', recipeId)
  }

  try {
    console.log(`[${executionId}] downloading PDF from storage`)
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('recipe-pdfs')
      .download(claimed.storage_path)

    if (downloadError || !fileBlob) {
      console.log(`[${executionId}] download failed: ${downloadError?.message}`)
      await setFailed('storage_download_failed')
      return new Response('OK', { status: 200 })
    }

    const pdfBytes = new Uint8Array(await fileBlob.arrayBuffer())
    console.log(`[${executionId}] PDF downloaded bytes=${pdfBytes.length}`)

    if (pdfBytes.length > 10 * 1024 * 1024) {
      await setFailed('invalid_file', false)
      return new Response('OK', { status: 200 })
    }
    if (
      pdfBytes[0] !== 0x25 || pdfBytes[1] !== 0x50 ||
      pdfBytes[2] !== 0x44 || pdfBytes[3] !== 0x46
    ) {
      await setFailed('invalid_file', false)
      return new Response('OK', { status: 200 })
    }

    console.log(`[${executionId}] calling Gemini`)
    const base64Pdf = uint8ToBase64(pdfBytes)

    const geminiPayload = {
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            text: `This PDF may be written in any language. Extract the recipe and translate every text field into English, regardless of the PDF's original language — the only exception is "source_name", which should be kept exactly as written if it is a brand or publisher name (e.g. HelloFresh stays HelloFresh, do not translate it). Return a JSON object with exactly these fields:
{
  "name": "primary recipe title only, in English — the main heading (e.g. 'Korean Beef Bibimbap'), NOT the subtitle or ingredient description that follows. Title case, not all caps.",
  "source_name": "brand or publisher if identifiable (e.g. HelloFresh), null otherwise — keep as written, do not translate",
  "cook_time_minutes": integer or null,
  "prep_time_minutes": integer or null,
  "servings": integer or null,
  "difficulty": "Easy" or "Medium" or "Hard" or null (translate the source label into one of these English values),
  "cuisine": "cuisine type in English if identifiable (e.g. Mexican, Italian), null otherwise",
  "protein_source": "exactly one of: Chicken, Beef, Pork, Turkey, Seafood, Vegetarian, Other — pick the dish's single dominant protein (e.g. a dish with both chicken and shrimp: pick whichever the dish is centered on; a meat substitute or a dish with no meat/fish: Vegetarian; a protein that doesn't fit any listed category, e.g. lamb or duck: Other), or null if the dish genuinely has no identifiable protein (e.g. a plain side salad or a dessert)",
  "nutrition_printed": { "calories_kcal": numeric or null, "fat_g": numeric or null, "saturated_fat_g": numeric or null, "carbs_g": numeric or null, "sugar_g": numeric or null, "fibre_g": numeric or null, "protein_g": numeric or null, "salt_g": numeric or null } — only values printed on the PDF, see NUTRITION below,
  "nutrition_estimate": { the same eight keys, numeric or null } — your own estimate from the ingredients, see NUTRITION below,
  "tags": ["array", "of", "tags", "in English"],
  "steps": ["Step 1 text, in English — wrap any oven/cooking temperature using {{temp:VALUEU}}, see TEMPERATURES below", "Step 2 text, in English"],
  "ingredients": [
    {
      "name": "ingredient name only, in English (e.g. chicken breast, garlic clove)",
      "canonical_name": "base-form ingredient for search, in English — strip preparation, quantity words, and adjectives (e.g. 'chicken breast' → 'chicken', 'fresh garlic cloves' → 'garlic', 'extra virgin olive oil' → 'olive oil', 'baby spinach leaves' → 'spinach', 'soy sauce' → 'soy sauce'). Use the shortest recognisable common name.",
      "quantity": numeric value or null,
      "unit": "unit string or null",
      "preparation": "prep method, in English (e.g. diced, sliced) or null",
      "display_order": 1
    }
  ]
}

DUAL-QUANTITY INGREDIENTS: Some recipes list quantities for multiple serving sizes in the same column, separated by a delimiter such as "|" or "/". Examples: "4 oz | 8 oz", "1 | 2", "2 Cloves | 4 Cloves", "¾ Cup | 1½ Cups". When you see this pattern:
- Always extract the FIRST value as "quantity" and the FIRST unit as "unit" (e.g. "4 oz | 8 oz" → quantity: 4, unit: "oz"; "¾ Cup | 1½ Cups" → quantity: 0.75, unit: "Cup").
- Set "servings" to the serving count that corresponds to the first column (e.g. if the header reads "2-person | 4-person", set servings: 2).
- Never average the two values or return null just because two quantities are shown.

NUTRITION: Fill two separate objects, both per serving, each with the same eight keys (calories_kcal, fat_g, saturated_fat_g, carbs_g, sugar_g, fibre_g, protein_g, salt_g).
- "nutrition_printed": ONLY values actually printed on the PDF (in a nutrition / nutritional values section, or e.g. calories shown next to the cook time). If a value is printed per 100 g or per package, convert it to per serving using the servings count. Fibre may be labelled fiber or dietary fiber. If the PDF gives sodium instead of salt, convert: salt_g = sodium in mg × 2.5 ÷ 1000. Every key that is not printed on the PDF must be null in this object — never put an estimate here. Most recipe cards print only calories, so most keys here will be null.
- "nutrition_estimate": your own estimate of ALL eight values per serving, worked out from the ingredient list (the first-column quantities and the servings count above), whether or not the PDF prints them. Use null only if the ingredient list gives you nothing to estimate from.
- Round calories to a whole number and grams to one decimal place. Use plain numbers (e.g. 420, 12.5) with no units in the value itself.

TEMPERATURES: Whenever a step mentions an oven or cooking temperature, wrap the numeric value in the step text using this exact marker syntax: {{temp:VALUEU}}, where VALUE is the number as written (digits only, no unit symbol, no comma) and U is F for Fahrenheit or C for Celsius, matching whichever the source PDF states. This lets the app convert and display it in the reader's preferred unit. Examples:
- "Preheat oven to 425 degrees." → "Preheat oven to {{temp:425F}} degrees."
- A step originally in Celsius, after translating to English: "Preheat the oven to 220°C." → "Preheat the oven to {{temp:220C}}."
- Do not wrap non-temperature numbers such as cook times, quantities, or oven rack positions — only actual temperature values.

Return only valid JSON. No markdown fences, no explanation.`,
          },
        ],
      }],
      generationConfig: {
        response_mime_type: 'application/json',
        // thinkingConfig is added per model by callGemini() (lowest level each
        // model allows — extraction needs little reasoning).
      },
    }

    const geminiStarted = Date.now()
    const geminiRes = await callGemini(geminiPayload, (msg) => console.log(`[${executionId}] ${msg}`))
    console.log(`[${executionId}] Gemini took ${Date.now() - geminiStarted} ms`)

    console.log(`[${executionId}] Gemini response status=${geminiRes.status}`)
    if (!geminiRes.ok) {
      const errBody = await geminiRes.text()
      console.log(`[${executionId}] Gemini error body=${errBody}`)
      await setFailed(`gemini_error_${geminiRes.status}`)
      return new Response('OK', { status: 200 })
    }

    const geminiResult = await geminiRes.json()
    const candidate = geminiResult?.candidates?.[0]
    // Gemini 3 models can split a reply into several parts (and mark thinking
    // parts with thought: true), so join every non-thought text part instead
    // of reading only the first one.
    const rawText: string = (candidate?.content?.parts ?? [])
      .filter((part: { text?: unknown; thought?: boolean }) => typeof part?.text === 'string' && !part.thought)
      .map((part: { text: string }) => part.text)
      .join('')

    if (!rawText.trim()) {
      // finishReason (e.g. MAX_TOKENS, SAFETY) or promptFeedback.blockReason
      // says why there was no text; keep it in the failure reason.
      const why = candidate?.finishReason ?? geminiResult?.promptFeedback?.blockReason ?? 'unknown'
      console.log(`[${executionId}] Gemini returned empty response finishReason=${why} parts=${candidate?.content?.parts?.length ?? 0}`)
      await setFailed(`gemini_empty_response:${why}`)
      return new Response('OK', { status: 200 })
    }

    let parsed: ParsedRecipe
    try {
      parsed = JSON.parse(rawText)
    } catch {
      console.log(`[${executionId}] Gemini returned invalid JSON`)
      await setFailed('gemini_invalid_json')
      return new Response('OK', { status: 200 })
    }

    if (!parsed.name || !Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) {
      console.log(`[${executionId}] Gemini response failed schema validation`)
      await setFailed('gemini_invalid_schema')
      return new Response('OK', { status: 200 })
    }

    console.log(`[${executionId}] parsed name="${parsed.name}" ingredients=${parsed.ingredients.length}`)

    const fingerprint = await computeIngredientFingerprint(parsed.ingredients)

    const { data: fpDupe } = await supabase
      .from('recipes')
      .select('id')
      .eq('ingredient_fingerprint', fingerprint)
      .in('status', ['processing', 'ready'])
      .neq('id', recipeId)
      .maybeSingle()

    if (fpDupe) {
      await setRejected(fpDupe.id)
      return new Response('OK', { status: 200 })
    }

    const { data: nameDupe } = await supabase
      .from('recipes')
      .select('id')
      .ilike('name', parsed.name)
      .in('status', ['processing', 'ready'])
      .neq('id', recipeId)
      .maybeSingle()

    if (nameDupe) {
      await setRejected(nameDupe.id)
      return new Response('OK', { status: 200 })
    }

    const ingredientRows = parsed.ingredients.map(ing => ({
      recipe_id: recipeId,
      name: ing.name,
      canonical_name: ing.canonical_name ?? null,
      quantity: ing.quantity ?? null,
      unit: ing.unit ?? null,
      preparation: ing.preparation ?? null,
      display_order: ing.display_order,
    }))

    console.log(`[${executionId}] inserting ${ingredientRows.length} ingredients`)
    const { error: ingError } = await supabase.from('ingredients').insert(ingredientRows)
    if (ingError) {
      await setFailed(`ingredient_insert_failed: ${ingError.message}`)
      return new Response('OK', { status: 200 })
    }

    const nutrition = mergeNutrition(parsed)
    console.log(`[${executionId}] nutrition estimated=${nutrition.estimated.join(',') || 'none'}`)

    console.log(`[${executionId}] updating recipe to ready`)
    const { error: updateError } = await supabase.from('recipes').update({
      name: parsed.name,
      source_name: parsed.source_name ?? null,
      cook_time_minutes: parsed.cook_time_minutes ?? null,
      prep_time_minutes: parsed.prep_time_minutes ?? null,
      servings: parsed.servings ?? null,
      difficulty: parsed.difficulty ?? null,
      cuisine: parsed.cuisine ?? null,
      protein_source: parsed.protein_source ?? null,
      ...nutrition.values,
      nutrition_estimated: nutrition.estimated,
      tags: parsed.tags ?? [],
      steps: parsed.steps ?? [],
      ingredient_fingerprint: fingerprint,
      status: 'ready',
      processing_completed_at: new Date().toISOString(),
    }).eq('id', recipeId)

    if (updateError) {
      if (updateError.code === '23505') {
        const { data: conflict } = await supabase
          .from('recipes')
          .select('id')
          .ilike('name', parsed.name)
          .eq('status', 'ready')
          .neq('id', recipeId)
          .maybeSingle()
        await setRejected(conflict?.id ?? 'unknown')
      } else {
        await setFailed(`update_failed: ${updateError.message}`)
      }
      return new Response('OK', { status: 200 })
    }

    console.log(`[${executionId}] done — recipe is ready`)
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.log(`[${executionId}] unexpected error: ${(err as Error).message}`)
    await setFailed(`unexpected: ${(err as Error).message}`)
    return new Response('OK', { status: 200 })
  }
})
