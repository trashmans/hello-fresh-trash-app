// Send this week's preview to the household's AH list (rollout phase 6, docs/adr/0005).
//
// POST { weekStart: 'YYYY-MM-DD' (a Monday), lines: [{ productId | null, text, quantity, sources }],
//        stapleUpdates: [{ staple_id, product_id | null, last_added_on?, covered_until?, skip_next? }] }
//   → { runId, status: 'done' | 'partial' | 'failed', staplesUpdated, lines: [{ …, outcome, errorCode }] }
//
// The request is the preview the member is looking at (src/lib/weekPreview.js), but the server
// doesn't trust it: _shared/retailer/sendPlan.ts checks every field, and the AH list is read
// again here so only writes that add something are sent (never removes or lowers). Only the
// household owner of a household with ah_enabled AND send_enabled may send, one send at a
// time. Every send is recorded in public.household_weekly_runs / household_run_lines.
//
// Uses the household's linked account (token refreshed single-flight, never stored or
// returned). On preview and local the fake adapter answers (_shared/retailer/index.ts), so a
// real AH list is never touched there; RETAILER_AH_ENABLED=true is the kill switch on production.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { withAccessToken } from '../_shared/retailer/accountTokens.ts'
import { retailerAdapterFor } from '../_shared/retailer/index.ts'
import { createSql, pgTokenStore } from '../_shared/retailer/pgStores.ts'
import { sendWeek } from '../_shared/retailer/sendWeek.ts'
import { RetailerError } from '../_shared/retailer/types.ts'
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
// '' means: use the error's own message (written by us in sendPlan.ts / sendWeek.ts).
const FAILURES: Record<string, [number, string]> = {
  invalid: [400, ''],
  forbidden: [403, ''],
  busy: [409, ''],
  not_linked: [409, 'Link your Albert Heijn account first (above).'],
  auth: [409, 'Your Albert Heijn link has expired. Link it again (above). Nothing was sent.'],
  disabled: [503, 'The AH connection is switched off right now. Nothing was sent.'],
  timeout: [504, 'AH did not answer in time. Nothing was sent; try again in a minute.'],
  http: [502, 'AH could not be reached. Nothing was sent; try again later.'],
  schema: [502, 'AH answered in an unexpected way. Nothing was sent; try again later.'],
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
  try { body = await req.json() } catch { return json(400, { error: 'bad_request', message: 'Nothing to send.' }) }

  const sql = createSql()
  try {
    const adapter = retailerAdapterFor(RETAILER, (name) => Deno.env.get(name))
    const result = await sendWeek({
      async getHousehold(userId) {
        const [r] = await sql`
          SELECT m.household_id, m.role, h.ah_enabled, h.send_enabled
          FROM public.household_members m JOIN public.households h ON h.id = m.household_id
          WHERE m.user_id = ${userId}`
        return r
          ? { householdId: r.household_id, role: r.role, ahEnabled: r.ah_enabled === true, sendEnabled: r.send_enabled === true }
          : null
      },
      startRun: (householdId, weekStart, userId) => sql.begin(async (tx) => {
        // A send that crashed mid-way would otherwise block the household for good.
        await tx`
          UPDATE public.household_weekly_runs
          SET status = 'failed', error_code = 'stale', finished_at = now()
          WHERE household_id = ${householdId} AND status = 'running' AND started_at < now() - interval '10 minutes'`
        const [r] = await tx`
          INSERT INTO public.household_weekly_runs (household_id, week_start, mode, started_by)
          VALUES (${householdId}, ${weekStart}, 'manual', ${userId})
          ON CONFLICT (household_id) WHERE status = 'running' DO NOTHING
          RETURNING id`
        return r?.id ?? null
      }),
      withToken: (householdId, fn) => withAccessToken({
        store: pgTokenStore(sql),
        adapter,
        masterKeys: masterKeysFromEnv((name) => Deno.env.get(name)),
        householdId,
        retailer: RETAILER,
      }, fn),
      readList: (token) => adapter.readList(token),
      writeListLines: (token, lines) => adapter.writeListLines(token, lines),
      async saveStapleUpdates(householdId, updates) {
        await sql.begin(async (tx) => {
          for (const u of updates) {
            const has = (k: string) => Object.prototype.hasOwnProperty.call(u, k)
            await tx`
              UPDATE public.household_staples SET
                last_added_on = CASE WHEN ${has('last_added_on')} THEN ${u.last_added_on ?? null}::date ELSE last_added_on END,
                covered_until = CASE WHEN ${has('covered_until')} THEN ${u.covered_until ?? null}::date ELSE covered_until END,
                skip_next     = CASE WHEN ${has('skip_next')} THEN false ELSE skip_next END,
                updated_at    = now()
              WHERE id = ${u.staple_id} AND household_id = ${householdId}`
          }
        })
      },
      finishRun: (runId, { status, errorCode, lines }) => sql.begin(async (tx) => {
        if (lines.length > 0) {
          const rows = lines.map((l, i) => ({
            run_id: runId, line_no: i, product_external_id: l.productId, text: l.text, action: l.action,
            from_qty: l.from, to_qty: l.to, sources: l.sources, outcome: l.outcome, error_code: l.errorCode,
          }))
          await tx`
            INSERT INTO public.household_run_lines
              ${tx(rows, 'run_id', 'line_no', 'product_external_id', 'text', 'action', 'from_qty', 'to_qty', 'sources', 'outcome', 'error_code')}`
        }
        await tx`
          UPDATE public.household_weekly_runs SET
            status = ${status}, error_code = ${errorCode}, finished_at = now(),
            lines_written = ${lines.filter((l) => l.outcome === 'written').length},
            lines_failed  = ${lines.filter((l) => l.outcome === 'failed').length}
          WHERE id = ${runId}`
      }),
    }, { userId: user.id, body })
    const counts = result.lines.reduce((c: Record<string, number>, l) => ({ ...c, [l.outcome]: (c[l.outcome] ?? 0) + 1 }), {})
    console.log(`retailer-send: run ${result.runId} ${result.status} ${JSON.stringify(counts)}, ${result.staplesUpdated} staples updated`)
    return json(200, result)
  } catch (err) {
    if (err instanceof RetailerError && FAILURES[err.code]) {
      const [status, message] = FAILURES[err.code]
      console.log(`retailer-send: ${err.code}${err.status ? ` (${err.status})` : ''}`)
      return json(status, { error: err.code, message: message || err.message })
    }
    if (err instanceof TokenCryptoError) {
      console.error(`retailer-send: master key problem — ${err.message}`)
      return json(500, { error: 'not_configured', message: 'The supermarket link is not set up on the server yet. Nothing was sent.' })
    }
    console.error(`retailer-send: unexpected ${(err as Error)?.name}: ${(err as Error)?.message}`)
    return json(500, { error: 'unexpected', message: 'Something went wrong. Check your AH list before trying again.' })
  } finally {
    await sql.end({ timeout: 2 })
  }
})
