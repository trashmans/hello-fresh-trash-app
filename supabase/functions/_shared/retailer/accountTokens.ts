// Single-flight token refresh for a household's retailer account
// (docs/adr/0003 "Single-flight refresh", refined by docs/adr/0007: access tokens are never stored).
//
// Every AH action runs through withAccessToken(), which:
//   1. locks the account row (SELECT … FOR UPDATE), so two runs can never refresh at once;
//   2. decrypts the refresh token and refreshes it with the retailer;
//   3. re-encrypts the rotated refresh token, raises token_version, audits, and COMMITS —
//      before the access token is used. AH invalidates the old refresh token on refresh,
//      so the new one must be safe in the database first;
//   4. runs the action with the access token, held in memory only.
// If the retailer refuses the token ('auth'), the account is marked relink_needed (committed,
// audited) and an 'auth' error is raised. Any other failure rolls back: the row is unchanged.
//
// The database sits behind TokenStore so this logic is testable without Postgres; the
// Postgres implementation comes with the first Edge Function that uses it.

import { openToken, resealToken } from '../tokenCrypto.ts'
import type { MasterKeys, SealedToken } from '../tokenCrypto.ts'
import { RetailerError } from './types.ts'
import type { RetailerAdapter } from './types.ts'

/** A private.retailer_accounts row, as far as token handling needs it. */
export interface AccountRow {
  id: string
  household_id: string
  retailer: string
  status: 'linked' | 'relink_needed'
  token_ciphertext: Uint8Array
  token_iv: Uint8Array
  wrapped_key: Uint8Array
  wrapped_key_iv: Uint8Array
  key_version: number
  token_version: number
}

export interface TokenTx {
  /** SELECT … FOR UPDATE on the (household, retailer) row; null if not linked. */
  lockAccount(householdId: string, retailer: string): Promise<AccountRow | null>
  /** Saves the (re-)sealed token, token_version + 1 and last_refresh_at, only if token_version still matches. */
  saveRefreshedToken(accountId: string, sealed: SealedToken, expectedTokenVersion: number): Promise<void>
  markRelinkNeeded(accountId: string): Promise<void>
  /** private.audit_events. `detail` must never contain tokens. */
  audit(householdId: string, action: string, detail: Record<string, unknown>): Promise<void>
}

export interface TokenStore {
  /** Runs fn in one transaction: commits if it resolves, rolls back if it throws. */
  transaction<T>(fn: (tx: TokenTx) => Promise<T>): Promise<T>
}

export interface WithAccessTokenOptions {
  store: TokenStore
  adapter: Pick<RetailerAdapter, 'getAccessToken'>
  masterKeys: MasterKeys
  householdId: string
  retailer: string
}

type Outcome =
  | { kind: 'ok'; accessToken: string }
  | { kind: 'not_linked' }
  | { kind: 'relink_needed' }

const sealedFrom = (row: AccountRow): SealedToken => ({
  tokenCiphertext: row.token_ciphertext,
  tokenIv: row.token_iv,
  wrappedKey: row.wrapped_key,
  wrappedKeyIv: row.wrapped_key_iv,
  keyVersion: row.key_version,
})

export async function withAccessToken<T>(opts: WithAccessTokenOptions, action: (accessToken: string) => Promise<T>): Promise<T> {
  const { store, adapter, masterKeys, householdId, retailer } = opts

  const outcome: Outcome = await store.transaction(async (tx) => {
    const row = await tx.lockAccount(householdId, retailer)
    if (!row) return { kind: 'not_linked' }
    if (row.status === 'relink_needed') return { kind: 'relink_needed' }

    const sealed = sealedFrom(row)
    const refreshToken = await openToken(sealed, row.id, masterKeys) // wrong key / tampering → throws, rolls back

    let refreshed
    try {
      refreshed = await adapter.getAccessToken(refreshToken)
    } catch (err) {
      if (err instanceof RetailerError && err.code === 'auth') {
        // Commit this: the token is dead, the household has to link again.
        await tx.markRelinkNeeded(row.id)
        await tx.audit(householdId, 'retailer.relink_needed', { retailer })
        return { kind: 'relink_needed' }
      }
      throw err // timeout, kill switch, …: roll back, row unchanged
    }

    const rotated = refreshed.refreshToken && refreshed.refreshToken !== refreshToken
    const next = rotated ? await resealToken(refreshed.refreshToken!, sealed, row.id, masterKeys) : sealed
    await tx.saveRefreshedToken(row.id, next, row.token_version)
    await tx.audit(householdId, 'retailer.token_refreshed', { retailer, token_version: row.token_version + 1 })
    return { kind: 'ok', accessToken: refreshed.accessToken }
  })

  if (outcome.kind === 'not_linked') throw new RetailerError('not_linked', `This household has not linked ${retailer}`)
  if (outcome.kind === 'relink_needed') throw new RetailerError('auth', `The ${retailer} link has expired; link the account again`)
  return action(outcome.accessToken) // after the commit; the access token never leaves memory
}
