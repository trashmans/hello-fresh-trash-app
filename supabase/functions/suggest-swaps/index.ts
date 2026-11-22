// Protein swap options for a recipe (docs/adr/0010).
//
// POST { recipeId, direction: 'to_vegetarian' | 'to_meat', more?: boolean }
//   → { swaps: [recipe_swaps rows of the latest batch] }
//
// Returns the saved options for that recipe and direction; when there are none, or with
// more: true ("Suggest other options"), asks Gemini for 3–4 new ones (avoiding the titles
// already offered), checks them (_shared/swapOptions.ts) and saves them as a new batch.
// Gemini gets only the recipe (name, cuisine, servings, ingredients, steps): nothing
// about the user. Limits: 20 batches per recipe and direction; 40 saved options per user
// per 24 hours.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { checkSwapOptions, swapPrompt } from '../_shared/swapOptions.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')

// Suggesting swaps that suit a dish is more than extraction, so the stronger Flash model
// goes first; the other one is the fallback when Google is overloaded or slow.
const MODELS = [
  { id: 'gemini-3.8-flash', thinkingLevel: 'low' },
  { id: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal' },
]
const ATTEMPT_TIMEOUT_MS = 55_000
const MAX_BATCHES = 20
const MAX_OPTIONS_PER_DAY = 40

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const fail = (status: number, error: string, message: string) => json(status, { error, message })

function jsonPart(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

async function askGemini(prompt: string): Promise<unknown | null> {
  if (!GEMINI_API_KEY) return null
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0.7, thinkingConfig: { thinkingLevel: model.thinkingLevel } },
        }),
      })
      if (!res.ok) {
        await res.body?.cancel()
        console.warn(`suggest-swaps: Gemini ${model.id} status ${res.status}`)
        if (res.status >= 500 || res.status === 429) continue
        return null
      }
      const data = await res.json()
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .filter((p: { text?: unknown; thought?: boolean }) => typeof p?.text === 'string' && !p.thought)
        .map((p: { text: string }) => p.text).join('')
      try { return JSON.parse(jsonPart(text)) } catch { console.warn(`suggest-swaps: ${model.id} gave invalid JSON`); continue }
    } catch (err) {
      console.warn(`suggest-swaps: Gemini ${model.id} failed (${(err as Error)?.name})`)
    }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(401, { error: 'unauthorized' })
  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) return json(401, { error: 'unauthorized' })

  let body: { recipeId?: unknown; direction?: unknown; more?: unknown }
  try { body = await req.json() } catch { return fail(400, 'bad_request', 'Something went wrong. Try again.') }
  const recipeId = typeof body.recipeId === 'string' ? body.recipeId : ''
  const direction = body.direction === 'to_vegetarian' || body.direction === 'to_meat' ? body.direction : null
  if (!recipeId || !direction) return fail(400, 'bad_request', 'Something went wrong. Try again.')

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: recipe } = await db.from('recipes')
    .select('id, name, cuisine, protein_source, servings, steps, status')
    .eq('id', recipeId).maybeSingle()
  if (!recipe || recipe.status !== 'ready') return fail(404, 'not_ready', 'That recipe is not ready yet.')

  const { data: existing } = await db.from('recipe_swaps')
    .select('*').eq('recipe_id', recipeId).eq('direction', direction)
    .order('batch', { ascending: false }).order('position')
  const rows = existing ?? []
  const lastBatch = rows[0]?.batch ?? 0
  if (!body.more && lastBatch > 0) return json(200, { swaps: rows.filter((r) => r.batch === lastBatch) })
  if (lastBatch >= MAX_BATCHES) return fail(429, 'too_many', 'That is all the options for this recipe.')

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await db.from('recipe_swaps').select('id', { count: 'exact', head: true })
    .eq('created_by', user.id).gte('created_at', since)
  if ((count ?? 0) >= MAX_OPTIONS_PER_DAY) return fail(429, 'daily_limit', 'You have asked for many suggestions today. Try again tomorrow.')

  const { data: ingredients } = await db.from('ingredients')
    .select('name, quantity, unit, preparation').eq('recipe_id', recipeId).order('display_order')
  if (!ingredients?.length) return fail(422, 'no_ingredients', 'This recipe has no ingredients to swap.')

  const prompt = swapPrompt({
    name: recipe.name ?? 'Recipe',
    cuisine: recipe.cuisine,
    protein_source: recipe.protein_source,
    servings: recipe.servings,
    ingredients,
    steps: Array.isArray(recipe.steps) ? recipe.steps : [],
  }, direction, [...new Set(rows.map((r) => r.title))])
  const started = Date.now()
  const reply = await askGemini(prompt)
  const options = checkSwapOptions(reply, ingredients.map((i) => i.name))
  console.log(`suggest-swaps: ${direction} batch ${lastBatch + 1}: ${options.length} options in ${Date.now() - started} ms`)
  if (options.length === 0) return fail(502, 'no_options', "Couldn't come up with swaps for this recipe right now. Try again.")

  const { data: saved, error: saveError } = await db.from('recipe_swaps').insert(options.map((o, i) => ({
    recipe_id: recipeId,
    direction,
    batch: lastBatch + 1,
    position: i + 1,
    title: o.title,
    summary: o.summary,
    changes: o.changes,
    steps_all: o.steps_all.length ? o.steps_all : null,
    steps_half: o.steps_half.length ? o.steps_half : null,
    created_by: user.id,
  }))).select('*').order('position')
  if (saveError) {
    console.error(`suggest-swaps: save failed — ${saveError.message}`)
    return fail(500, 'save_failed', 'Something went wrong. Try again.')
  }
  return json(200, { swaps: saved })
})
