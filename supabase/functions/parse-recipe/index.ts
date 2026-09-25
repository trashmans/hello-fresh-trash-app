import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

interface Ingredient {
  name: string
  canonical_name: string | null
  quantity: number | null
  unit: string | null
  preparation: string | null
  display_order: number
}

interface ParsedRecipe {
  name: string
  source_name: string | null
  cook_time_minutes: number | null
  prep_time_minutes: number | null
  servings: number | null
  difficulty: string | null
  cuisine: string | null
  protein_source: string | null
  tags: string[]
  steps: string[]
  ingredients: Ingredient[]
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
      },
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)

    let geminiRes: Response
    try {
      geminiRes = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    console.log(`[${executionId}] Gemini response status=${geminiRes.status}`)
    if (!geminiRes.ok) {
      const errBody = await geminiRes.text()
      console.log(`[${executionId}] Gemini error body=${errBody}`)
      await setFailed(`gemini_error_${geminiRes.status}`)
      return new Response('OK', { status: 200 })
    }

    const geminiResult = await geminiRes.json()
    const rawText: string | undefined =
      geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text

    if (!rawText) {
      console.log(`[${executionId}] Gemini returned empty response`)
      await setFailed('gemini_empty_response')
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
