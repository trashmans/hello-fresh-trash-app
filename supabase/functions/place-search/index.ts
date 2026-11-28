// Place search for the food map (docs/adr/0012, F1c), through our server so the browser never
// talks to the place service and the exact GPS never leaves the device. The service is Geoapify
// (since 28 Nov 2026; OpenStreetMap's Nominatim blocked Supabase's shared servers), with the
// API key in the GEOAPIFY_API_KEY secret. The key is in the request URL, so URLs are never logged.
//
// POST { mode: 'reverse', lat, lon }  → { place: { label, detail, lat, lon } | null, attribution }
//   The nearest city. The location is coarsened to 1 decimal here as well (whatever was sent);
//   answers are cached for 30 days per cell (private.place_cache), so a city is asked for once.
// POST { mode: 'search', q }          → { places: [...up to 5], attribution }
//   Only when the person presses Search (no autocomplete). Search text is not cached or logged.
//
// Pace: one request a second for the whole app (public.take_nominatim_slot, named for the first
// service; Geoapify's free plan allows 5 a second and 3,000 a day). Results are shown with
// "Powered by Geoapify · © OpenStreetMap contributors". Per person: 300 lookups an hour. Logs
// hold the mode, cache hit, status and timing only, never a location, search text or the key.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  ATTRIBUTION, cacheKey, checkPlaceRequest, placeFromReverse, placesFromSearch, reverseUrl, searchUrl,
} from '../_shared/places.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEOAPIFY_API_KEY = Deno.env.get('GEOAPIFY_API_KEY') ?? ''

const PER_USER_PER_HOUR = 300
const SLOT_TRIES = 12          // ~4 s of waiting for the app's one-a-second slot
const SLOT_WAIT_MS = 350
const FETCH_TIMEOUT_MS = 8_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const fail = (status: number, error: string, message: string) => json(status, { error, message })
const BUSY = 'Place search is busy. Try again in a moment.'

type Db = ReturnType<typeof createClient>

async function takeSlot(db: Db): Promise<boolean> {
  for (let i = 0; i < SLOT_TRIES; i++) {
    const { data, error } = await db.rpc('take_nominatim_slot')
    if (error) { console.error(`place-search: slot failed — ${error.message}`); return false }
    if (data === true) return true
    await new Promise((r) => setTimeout(r, SLOT_WAIT_MS))
  }
  return false
}

// Geoapify's JSON, or a status for the caller: 'busy' (rate limited or over the day's quota) or 'failed'.
async function ask(db: Db, url: string): Promise<{ data: unknown } | 'busy' | 'failed'> {
  if (!(await takeSlot(db))) return 'busy'
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      await res.body?.cancel()
      console.warn(`place-search: Geoapify status ${res.status}${res.status === 401 || res.status === 403 ? ' (check GEOAPIFY_API_KEY)' : ''}`)
      return res.status === 429 ? 'busy' : 'failed'
    }
    return { data: await res.json() }
  } catch (err) {
    console.warn(`place-search: Geoapify failed (${(err as Error)?.name})`)
    return 'failed'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(401, { error: 'unauthorized' })
  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) return json(401, { error: 'unauthorized' })

  let body: unknown
  try { body = await req.json() } catch { return fail(400, 'bad_request', 'Something went wrong. Try again.') }
  const request = checkPlaceRequest(body)
  if (!request) return fail(400, 'bad_request', 'Type at least 2 characters to search.')
  if (!GEOAPIFY_API_KEY) {
    console.error('place-search: GEOAPIFY_API_KEY is not set')
    return fail(503, 'failed', "Place search isn't set up yet.")
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: allowed, error: useError } = await db.rpc('use_place_search', { p_user: user.id, p_limit: PER_USER_PER_HOUR })
  if (useError) { console.error(`place-search: usage failed — ${useError.message}`); return fail(500, 'failed', 'Something went wrong. Try again.') }
  if (allowed !== true) return fail(429, 'too_many', 'You have looked up many places this hour. Try again later.')

  const started = Date.now()
  if (request.mode === 'reverse') {
    const key = cacheKey(request)
    const { data: cached } = await db.rpc('place_cache_get', { p_key: key })
    if (cached && typeof cached === 'object' && 'result' in cached) {
      console.log(`place-search: reverse cached in ${Date.now() - started} ms`)
      return json(200, { place: (cached as { result: unknown }).result ?? null, attribution: ATTRIBUTION })
    }
    const answer = await ask(db, reverseUrl(request, GEOAPIFY_API_KEY))
    if (answer === 'busy') return fail(503, 'busy', BUSY)
    if (answer === 'failed') return fail(502, 'failed', "Couldn't look up the place. Try again.")
    const place = placeFromReverse(answer.data)
    const { error: putError } = await db.rpc('place_cache_put', { p_key: key, p_result: place })
    if (putError) console.warn(`place-search: cache put failed — ${putError.message}`)
    console.log(`place-search: reverse ${place ? 'found' : 'none'} in ${Date.now() - started} ms`)
    return json(200, { place, attribution: ATTRIBUTION })
  }

  const answer = await ask(db, searchUrl(request.q, GEOAPIFY_API_KEY))
  if (answer === 'busy') return fail(503, 'busy', BUSY)
  if (answer === 'failed') return fail(502, 'failed', "Couldn't search for places. Try again.")
  const places = placesFromSearch(answer.data)
  console.log(`place-search: search ${places.length} results in ${Date.now() - started} ms`)
  return json(200, { places, attribution: ATTRIBUTION })
})
