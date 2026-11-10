// Search the household's supermarket (AH) for products, for the Staples screen (rollout phase 4).
//
// POST { query: 'crushed tomatoes' } → { products: [{ externalId, title, salesUnitSize, price, bonus }], searchedFor: ['tomatenblokjes', 'crushed tomatoes'] }
//
// English works: Gemini turns the query into the Dutch words AH uses (_shared/translateSearch.ts),
// and AH is searched for those first, then for the words as typed.
//
// Uses the household's linked account (token refreshed single-flight, never stored or
// returned), saves every product seen in public.retailer_products (the product cache,
// written only here), and returns the orderable ones. Needs the household's ah_enabled
// switch on and a linked account. On preview and local the fake adapter answers
// (shared/retailer/index.ts), so a real AH account is never touched there.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { withAccessToken } from '../_shared/retailer/accountTokens.ts'
import { retailerAdapterFor } from '../_shared/retailer/index.ts'
import { createSql, pgTokenStore } from '../_shared/retailer/pgStores.ts'
import { searchRetailerProducts } from '../_shared/retailer/productSearch.ts'
import { RetailerError } from '../_shared/retailer/types.ts'
import { masterKeysFromEnv, TokenCryptoError } from '../_shared/tokenCrypto.ts'
import { translateSearchToDutch } from '../_shared/translateSearch.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const RETAILER = 'ah'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// What the app shows for each failure. AH's own responses are never passed through.
const FAILURES: Record<string, [number, string]> = {
  invalid: [400, ''], // checkSearchQuery's message says what to fix
  forbidden: [403, 'Supermarket features are not switched on for your household.'],
  not_linked: [409, 'Link your Albert Heijn account first (above).'],
  auth: [409, 'Your Albert Heijn link has expired. Link it again (above), then search.'],
  disabled: [503, 'The AH connection is switched off right now.'],
  timeout: [504, 'AH did not answer in time. Try again in a minute.'],
  http: [502, 'AH could not be reached. Try again later.'],
  schema: [502, 'AH answered in an unexpected way. Try again later.'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(401, { error: 'unauthorized' })
  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) return json(401, { error: 'unauthorized' })

  let body: { query?: unknown }
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  const sql = createSql()
  try {
    const adapter = retailerAdapterFor(RETAILER, (name) => Deno.env.get(name))
    const result = await searchRetailerProducts({
      async getHousehold(userId) {
        const [r] = await sql`
          SELECT m.household_id, h.ah_enabled
          FROM public.household_members m JOIN public.households h ON h.id = m.household_id
          WHERE m.user_id = ${userId}`
        return r ? { householdId: r.household_id, ahEnabled: r.ah_enabled === true } : null
      },
      withToken: (householdId, fn) => withAccessToken({
        store: pgTokenStore(sql),
        adapter,
        masterKeys: masterKeysFromEnv((name) => Deno.env.get(name)),
        householdId,
        retailer: RETAILER,
      }, fn),
      translate: (query) => translateSearchToDutch(query, Deno.env.get('GEMINI_API_KEY')),
      search: (token, query, size) => adapter.searchProducts(token, query, size),
      async saveProducts(rows) {
        await sql`
          INSERT INTO public.retailer_products
            ${sql(rows, 'retailer', 'external_id', 'title', 'sales_unit_size', 'price', 'orderable', 'last_seen_at')}
          ON CONFLICT (retailer, external_id) DO UPDATE SET
            title = excluded.title,
            sales_unit_size = excluded.sales_unit_size,
            price = excluded.price,
            orderable = excluded.orderable,
            last_seen_at = excluded.last_seen_at`
      },
      now: () => new Date().toISOString(),
      onCacheError: (err) => console.error(`retailer-products: product cache not updated — ${(err as Error)?.message}`),
    }, { userId: user.id, retailer: RETAILER, query: body.query })
    return json(200, result)
  } catch (err) {
    if (err instanceof RetailerError && FAILURES[err.code]) {
      const [status, message] = FAILURES[err.code]
      console.log(`retailer-products: ${err.code}${err.status ? ` (${err.status})` : ''}`)
      return json(status, { error: err.code, message: message || err.message })
    }
    if (err instanceof TokenCryptoError) {
      console.error(`retailer-products: master key problem — ${err.message}`)
      return json(500, { error: 'not_configured', message: 'Supermarket search is not set up on the server yet.' })
    }
    console.error(`retailer-products: unexpected ${(err as Error)?.name}: ${(err as Error)?.message}`)
    return json(500, { error: 'unexpected', message: 'Something went wrong. Try again.' })
  } finally {
    await sql.end({ timeout: 2 })
  }
})
