// Link, unlink or check the signed-in user's household AH account (rollout phase 3).
//
// POST { action: 'status' }                → { state, linkedAt, lastRefreshAt }
// POST { action: 'link', pasted: '…' }     → same, after linking with the pasted login code
// POST { action: 'unlink' }                → { state: 'not_linked', … }
//
// Never returns or logs tokens or AH responses. Linking needs the household's ah_enabled
// switch on; on preview and local the fake adapter is used (shared/retailer/index.ts), so a
// real AH account is never touched there.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { getLinkStatus, linkAccount, unlinkAccount } from '../_shared/retailer/accountLinking.ts'
import { retailerAdapterFor } from '../_shared/retailer/index.ts'
import { createSql, pgLinkStore } from '../_shared/retailer/pgStores.ts'
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
const FAILURES: Record<string, [number, string]> = {
  invalid: [400, ''], // the message from extractLoginCode explains what to paste
  forbidden: [403, 'Linking a supermarket is not switched on for your household.'],
  auth: [400, 'AH did not accept that login code. Codes expire after a few minutes: log in to AH again and paste the new link.'],
  disabled: [503, 'The AH connection is switched off right now.'],
  timeout: [504, 'AH did not answer in time. Try again in a minute.'],
  http: [502, 'AH could not be reached. Try again later.'],
  schema: [502, 'AH answered in an unexpected way, so nothing was saved. Try again later.'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(401, { error: 'unauthorized' })
  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) return json(401, { error: 'unauthorized' })

  let body: { action?: string; pasted?: unknown }
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  const sql = createSql()
  try {
    const store = pgLinkStore(sql)
    switch (body.action) {
      case 'status':
        return json(200, await getLinkStatus({ store, userId: user.id, retailer: RETAILER }))
      case 'unlink':
        return json(200, await unlinkAccount({ store, userId: user.id, retailer: RETAILER }))
      case 'link': {
        const adapter = retailerAdapterFor(RETAILER, (name) => Deno.env.get(name))
        const masterKeys = masterKeysFromEnv((name) => Deno.env.get(name))
        return json(200, await linkAccount({ store, adapter, masterKeys, userId: user.id, retailer: RETAILER, pasted: body.pasted }))
      }
      default:
        return json(400, { error: 'unknown_action' })
    }
  } catch (err) {
    if (err instanceof RetailerError && FAILURES[err.code]) {
      const [status, message] = FAILURES[err.code]
      console.log(`link-account ${body.action}: ${err.code}${err.status ? ` (${err.status})` : ''}`)
      return json(status, { error: err.code, message: message || err.message })
    }
    if (err instanceof TokenCryptoError) {
      console.error(`link-account ${body.action}: master key problem — ${err.message}`)
      return json(500, { error: 'not_configured', message: 'Linking is not set up on the server yet.' })
    }
    console.error(`link-account ${body.action}: unexpected ${(err as Error)?.name}: ${(err as Error)?.message}`)
    return json(500, { error: 'unexpected', message: 'Something went wrong. Nothing was changed.' })
  } finally {
    await sql.end({ timeout: 2 })
  }
})
