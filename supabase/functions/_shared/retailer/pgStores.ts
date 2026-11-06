// Postgres implementations of TokenStore (accountTokens.ts) and LinkStore (accountLinking.ts).
//
// Edge Functions reach the private schema through a direct connection (docs/adr/0002):
// SUPABASE_DB_URL, which Supabase provides to every function. It connects as the database
// owner, so RLS does not apply here — this file is the only place that touches
// private.retailer_accounts, and every query is scoped by household or account id.
//
// bytea values cross the driver as hex strings (encode/decode in SQL), so they don't depend
// on how the driver maps binary types. postgres.js version as in Supabase's docs; prepare: false
// because Supabase's transaction pooler doesn't support prepared statements.

import postgres from 'npm:postgres@3.4.3'
import type { SealedToken } from '../tokenCrypto.ts'
import type { AccountRow, TokenStore, TokenTx } from './accountTokens.ts'
import type { LinkStore, LinkTx, LinkedAccountRow, NewAccountRow } from './accountLinking.ts'

type Sql = ReturnType<typeof postgres>

export function createSql(url = Deno.env.get('SUPABASE_DB_URL')): Sql {
  if (!url) throw new Error('SUPABASE_DB_URL is not set')
  return postgres(url, { prepare: false, max: 1, idle_timeout: 5 })
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)))
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null)

export function pgTokenStore(sql: Sql): TokenStore {
  return {
    transaction: (fn) => sql.begin(async (tx) => {
      const t: TokenTx = {
        async lockAccount(householdId, retailer) {
          const [r] = await tx`
            SELECT id, household_id, retailer, status, key_version, token_version,
                   encode(token_ciphertext, 'hex') AS token_ciphertext, encode(token_iv, 'hex') AS token_iv,
                   encode(wrapped_key, 'hex') AS wrapped_key, encode(wrapped_key_iv, 'hex') AS wrapped_key_iv
            FROM private.retailer_accounts
            WHERE household_id = ${householdId} AND retailer = ${retailer}
            FOR UPDATE`
          if (!r) return null
          const row: AccountRow = {
            id: r.id, household_id: r.household_id, retailer: r.retailer, status: r.status,
            key_version: Number(r.key_version), token_version: Number(r.token_version),
            token_ciphertext: fromHex(r.token_ciphertext), token_iv: fromHex(r.token_iv),
            wrapped_key: fromHex(r.wrapped_key), wrapped_key_iv: fromHex(r.wrapped_key_iv),
          }
          return row
        },
        async saveRefreshedToken(accountId, sealed: SealedToken, expectedTokenVersion) {
          const result = await tx`
            UPDATE private.retailer_accounts SET
              token_ciphertext = decode(${toHex(sealed.tokenCiphertext)}, 'hex'),
              token_iv         = decode(${toHex(sealed.tokenIv)}, 'hex'),
              wrapped_key      = decode(${toHex(sealed.wrappedKey)}, 'hex'),
              wrapped_key_iv   = decode(${toHex(sealed.wrappedKeyIv)}, 'hex'),
              key_version      = ${sealed.keyVersion},
              token_version    = token_version + 1,
              last_refresh_at  = now(),
              updated_at       = now()
            WHERE id = ${accountId} AND token_version = ${expectedTokenVersion}`
          if (result.count !== 1) throw new Error('Retailer account changed during refresh')
        },
        async markRelinkNeeded(accountId) {
          await tx`UPDATE private.retailer_accounts SET status = 'relink_needed', updated_at = now() WHERE id = ${accountId}`
        },
        async audit(householdId, action, detail) {
          await tx`INSERT INTO private.audit_events (household_id, action, detail)
                   VALUES (${householdId}, ${action}, ${JSON.stringify(detail)}::jsonb)`
        },
      }
      return fn(t)
    }),
  }
}

export function pgLinkStore(sql: Sql): LinkStore {
  return {
    transaction: (fn) => sql.begin(async (tx) => {
      const t: LinkTx = {
        async getHousehold(userId) {
          const [r] = await tx`
            SELECT m.household_id, h.ah_enabled
            FROM public.household_members m JOIN public.households h ON h.id = m.household_id
            WHERE m.user_id = ${userId}`
          return r ? { householdId: r.household_id, ahEnabled: r.ah_enabled === true } : null
        },
        async lockAccount(householdId, retailer) {
          const [r] = await tx`
            SELECT id, household_id, retailer, status, linked_at, last_refresh_at
            FROM private.retailer_accounts
            WHERE household_id = ${householdId} AND retailer = ${retailer}
            FOR UPDATE`
          if (!r) return null
          const row: LinkedAccountRow = {
            id: r.id, household_id: r.household_id, retailer: r.retailer, status: r.status,
            linked_at: iso(r.linked_at), last_refresh_at: iso(r.last_refresh_at),
          }
          return row
        },
        async deleteAccount(accountId) {
          await tx`DELETE FROM private.retailer_accounts WHERE id = ${accountId}`
        },
        async insertAccount(row: NewAccountRow) {
          await tx`
            INSERT INTO private.retailer_accounts
              (id, household_id, retailer, token_ciphertext, token_iv, wrapped_key, wrapped_key_iv, key_version, linked_by)
            VALUES (${row.id}, ${row.household_id}, ${row.retailer},
                    decode(${toHex(row.token_ciphertext)}, 'hex'), decode(${toHex(row.token_iv)}, 'hex'),
                    decode(${toHex(row.wrapped_key)}, 'hex'), decode(${toHex(row.wrapped_key_iv)}, 'hex'),
                    ${row.key_version}, ${row.linked_by})`
        },
        async audit(householdId, actorId, action, detail) {
          await tx`INSERT INTO private.audit_events (household_id, actor_id, action, detail)
                   VALUES (${householdId}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb)`
        },
      }
      return fn(t)
    }),
  }
}
