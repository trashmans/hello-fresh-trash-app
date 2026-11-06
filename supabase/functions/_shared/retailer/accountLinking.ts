// Linking, unlinking and link status for a household's retailer account (rollout phase 3).
//
// Linking (docs/adr/0003, 0006, 0007):
//   1. read the one-time login code from what was pasted, and check a master key is configured
//      and the household is allowed (member + ah_enabled) — all BEFORE the code is used, since
//      AH accepts it only once;
//   2. trade the code for tokens with the retailer;
//   3. encrypt the refresh token with a new data key under the newest master key, for a new
//      account id; the access token is discarded (never stored);
//   4. in one transaction: replace any existing account for this (household, retailer), insert,
//      audit retailer.linked / retailer.relinked.
// Unlinking deletes the row, the only copy of its data key; it works even with ah_enabled off,
// so a household can always disconnect. Status never returns token data.
//
// The database sits behind LinkStore (tested with an in-memory store); the Postgres
// implementation lives in pgStores.ts.

import { sealNewToken, TokenCryptoError } from '../tokenCrypto.ts'
import type { MasterKeys } from '../tokenCrypto.ts'
import { extractLoginCode } from './ahSchema.ts'
import { RetailerError } from './types.ts'
import type { RetailerAdapter } from './types.ts'

export interface LinkStatus {
  state: 'linked' | 'relink_needed' | 'not_linked'
  linkedAt: string | null
  lastRefreshAt: string | null
}

export interface LinkedAccountRow {
  id: string
  household_id: string
  retailer: string
  status: 'linked' | 'relink_needed'
  linked_at: string | null
  last_refresh_at: string | null
}

export interface NewAccountRow {
  id: string
  household_id: string
  retailer: string
  token_ciphertext: Uint8Array
  token_iv: Uint8Array
  wrapped_key: Uint8Array
  wrapped_key_iv: Uint8Array
  key_version: number
  linked_by: string
}

export interface LinkTx {
  /** The user's household and whether its AH feature switch is on; null if none. */
  getHousehold(userId: string): Promise<{ householdId: string; ahEnabled: boolean } | null>
  /** SELECT … FOR UPDATE on the (household, retailer) row; null if not linked. */
  lockAccount(householdId: string, retailer: string): Promise<LinkedAccountRow | null>
  deleteAccount(accountId: string): Promise<void>
  insertAccount(row: NewAccountRow): Promise<void>
  /** private.audit_events. `detail` must never contain tokens. */
  audit(householdId: string, actorId: string, action: string, detail: Record<string, unknown>): Promise<void>
}

export interface LinkStore {
  /** Runs fn in one transaction: commits if it resolves, rolls back if it throws. */
  transaction<T>(fn: (tx: LinkTx) => Promise<T>): Promise<T>
}

const NOT_LINKED: LinkStatus = { state: 'not_linked', linkedAt: null, lastRefreshAt: null }

const statusOf = (row: LinkedAccountRow | null): LinkStatus =>
  row
    ? { state: row.status === 'relink_needed' ? 'relink_needed' : 'linked', linkedAt: row.linked_at ?? null, lastRefreshAt: row.last_refresh_at ?? null }
    : { ...NOT_LINKED }

/** The highest configured master key version: new links are wrapped with it. */
function newestKeyVersion(keys: MasterKeys): number {
  const versions = Object.keys(keys ?? {}).map(Number).filter((v) => Number.isInteger(v) && keys[v])
  if (!versions.length) throw new TokenCryptoError('No master key configured (RETAILER_TOKEN_KEY_V1)')
  return Math.max(...versions)
}

const forbidden = () => new RetailerError('forbidden', 'Linking a supermarket is not switched on for your household')

export interface LinkAccountOptions {
  store: LinkStore
  adapter: Pick<RetailerAdapter, 'exchangeLoginCode'>
  masterKeys: MasterKeys
  userId: string
  retailer: string
  pasted: unknown
}

export async function linkAccount(opts: LinkAccountOptions): Promise<LinkStatus> {
  const { store, adapter, masterKeys, userId, retailer, pasted } = opts

  // Everything that can fail without AH is checked first: the login code works only once.
  const code = extractLoginCode(pasted)
  const keyVersion = newestKeyVersion(masterKeys)
  await sealNewToken('key check', 'key check', masterKeys, keyVersion) // a malformed master key fails here
  const household = await store.transaction((tx) => tx.getHousehold(userId))
  if (!household?.ahEnabled) throw forbidden()

  const tokens = await adapter.exchangeLoginCode(code)
  if (!tokens.refreshToken) throw new RetailerError('schema', 'AH did not return a refresh token')

  const accountId = crypto.randomUUID()
  const sealed = await sealNewToken(tokens.refreshToken, accountId, masterKeys, keyVersion)

  return store.transaction(async (tx) => {
    const current = await tx.getHousehold(userId)
    if (!current?.ahEnabled || current.householdId !== household.householdId) throw forbidden()

    const existing = await tx.lockAccount(current.householdId, retailer)
    if (existing) await tx.deleteAccount(existing.id) // its data key goes with it
    await tx.insertAccount({
      id: accountId,
      household_id: current.householdId,
      retailer,
      token_ciphertext: sealed.tokenCiphertext,
      token_iv: sealed.tokenIv,
      wrapped_key: sealed.wrappedKey,
      wrapped_key_iv: sealed.wrappedKeyIv,
      key_version: sealed.keyVersion,
      linked_by: userId,
    })
    await tx.audit(current.householdId, userId, existing ? 'retailer.relinked' : 'retailer.linked', { retailer })
    return statusOf(await tx.lockAccount(current.householdId, retailer))
  })
}

export async function unlinkAccount({ store, userId, retailer }: { store: LinkStore; userId: string; retailer: string }): Promise<LinkStatus> {
  return store.transaction(async (tx) => {
    const household = await tx.getHousehold(userId)
    if (!household) return { ...NOT_LINKED }
    const existing = await tx.lockAccount(household.householdId, retailer)
    if (existing) {
      await tx.deleteAccount(existing.id)
      await tx.audit(household.householdId, userId, 'retailer.unlinked', { retailer })
    }
    return { ...NOT_LINKED }
  })
}

export async function getLinkStatus({ store, userId, retailer }: { store: LinkStore; userId: string; retailer: string }): Promise<LinkStatus> {
  return store.transaction(async (tx) => {
    const household = await tx.getHousehold(userId)
    return household ? statusOf(await tx.lockAccount(household.householdId, retailer)) : { ...NOT_LINKED }
  })
}
