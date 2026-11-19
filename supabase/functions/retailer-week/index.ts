// This week's AH snapshot for the preview on the Automated ordering tab (rollout phase 5).
// Read-only: nothing is written to AH.
//
// POST {} → {
//   list:     [{ productId | null, text, quantity, ticked }]   the household's AH list now
//   products: { [staple id]: { externalId, title, salesUnitSize, price, mechanism } }
//   skippedLookups: 0
// }
//
// `products` holds this week's answer for the staples that need one: search-term staples
// (first orderable product) and pinned staples that can stock up on bonus (this week's
// bonus label). The staples are read here from the caller's household, never taken from
// the request. The browser combines the snapshot with the planner (src/lib/weekPreview.js).
//
// Uses the household's linked account (token refreshed single-flight, never stored or
// returned) and saves every product seen in public.retailer_products. Needs the
// household's ah_enabled switch on and a linked account. On preview and local the fake
// adapter answers (_shared/retailer/index.ts), so a real AH account is never touched there.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { withAccessToken } from '../_shared/retailer/accountTokens.ts'
import { retailerAdapterFor } from '../_shared/retailer/index.ts'
import { createSql, pgTokenStore } from '../_shared/retailer/pgStores.ts'
import { RetailerError } from '../_shared/retailer/types.ts'
import { getWeekSnapshot } from '../_shared/retailer/weekSnapshot.ts'
import type { SnapshotStaple } from '../_shared/retailer/weekSnapshot.ts'
import { masterKeysFromEnv, TokenCryptoError } from '../_shared/tokenCrypto.ts'

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
  forbidden: [403, 'Supermarket features are not switched on for your household.'],
  not_linked: [409, 'Link your Albert Heijn account first (above).'],
  auth: [409, 'Your Albert Heijn link has expired. Link it again (above), then refresh the preview.'],
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

  const sql = createSql()
  try {
    const adapter = retailerAdapterFor(RETAILER, (name) => Deno.env.get(name))
    const snapshot = await getWeekSnapshot({
      async getHousehold(userId) {
        const [r] = await sql`
          SELECT m.household_id, h.ah_enabled
          FROM public.household_members m JOIN public.households h ON h.id = m.household_id
          WHERE m.user_id = ${userId}`
        return r ? { householdId: r.household_id, ahEnabled: r.ah_enabled === true } : null
      },
      async getStaples(householdId) {
        const rows = await sql`
          SELECT s.id, s.product_external_id, p.title AS product_title, s.search_term,
                 s.perishable, s.max_weeks_stock, s.active
          FROM public.household_staples s
          LEFT JOIN public.retailer_products p
            ON p.retailer = s.retailer AND p.external_id = s.product_external_id
          WHERE s.household_id = ${householdId} AND s.retailer = ${RETAILER}
          ORDER BY s.name, s.id`
        return rows.map((r): SnapshotStaple => ({
          id: r.id,
          product_external_id: r.product_external_id == null ? null : Number(r.product_external_id),
          product_title: r.product_title,
          search_term: r.search_term,
          perishable: r.perishable === true,
          max_weeks_stock: r.max_weeks_stock,
          active: r.active !== false,
        }))
      },
      withToken: (householdId, fn) => withAccessToken({
        store: pgTokenStore(sql),
        adapter,
        masterKeys: masterKeysFromEnv((name) => Deno.env.get(name)),
        householdId,
        retailer: RETAILER,
      }, fn),
      readList: (token) => adapter.readList(token),
      search: (token, query, size) => adapter.searchProducts(token, query, size),
      async saveProducts(rows) {
        await sql`
          INSERT INTO public.retailer_products
            ${sql(rows, 'retailer', 'external_id', 'title', 'sales_unit_size', 'price', 'orderable', 'image_url', 'last_seen_at')}
          ON CONFLICT (retailer, external_id) DO UPDATE SET
            title = excluded.title,
            sales_unit_size = excluded.sales_unit_size,
            price = excluded.price,
            orderable = excluded.orderable,
            image_url = coalesce(excluded.image_url, public.retailer_products.image_url),
            last_seen_at = excluded.last_seen_at`
      },
      now: () => new Date().toISOString(),
      onCacheError: (err) => console.error(`retailer-week: product cache not updated — ${(err as Error)?.message}`),
    }, { userId: user.id, retailer: RETAILER })
    console.log(`retailer-week: ${snapshot.list.length} list items, ${Object.keys(snapshot.products).length} live products, ${snapshot.skippedLookups} lookups skipped`)
    return json(200, snapshot)
  } catch (err) {
    if (err instanceof RetailerError && FAILURES[err.code]) {
      const [status, message] = FAILURES[err.code]
      console.log(`retailer-week: ${err.code}${err.status ? ` (${err.status})` : ''}`)
      return json(status, { error: err.code, message })
    }
    if (err instanceof TokenCryptoError) {
      console.error(`retailer-week: master key problem — ${err.message}`)
      return json(500, { error: 'not_configured', message: 'The supermarket link is not set up on the server yet.' })
    }
    console.error(`retailer-week: unexpected ${(err as Error)?.name}: ${(err as Error)?.message}`)
    return json(500, { error: 'unexpected', message: 'Something went wrong. Try again.' })
  } finally {
    await sql.end({ timeout: 2 })
  }
})
