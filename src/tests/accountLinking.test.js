// @vitest-environment node
// Linking a household's AH account from a pasted login code (rollout phase 3).
import { describe, it, expect } from 'vitest'
import { extractLoginCode } from '../../supabase/functions/_shared/retailer/ahSchema.ts'
import { createAhAdapter } from '../../supabase/functions/_shared/retailer/ahAdapter.ts'
import { createFakeAdapter } from '../../supabase/functions/_shared/retailer/fakeAdapter.ts'
import { linkAccount, unlinkAccount, getLinkStatus } from '../../supabase/functions/_shared/retailer/accountLinking.ts'
import { openToken, TokenCryptoError } from '../../supabase/functions/_shared/tokenCrypto.ts'
import { RetailerError } from '../../supabase/functions/_shared/retailer/types.ts'

const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
const V1 = key()
const V2 = key()
const USER = 'user-1'
const HOUSEHOLD = 'hh-1'
const CODE = 'Abc123-def_456.ghi~789'

async function rejectsWith(promise, code) {
  await expect(promise).rejects.toBeInstanceOf(RetailerError)
  await expect(promise).rejects.toMatchObject({ code })
}

// ---------- extractLoginCode ----------

describe('extractLoginCode', () => {
  it('reads the code from the appie:// link', () => {
    expect(extractLoginCode(`appie://login-exit?code=${CODE}`)).toBe(CODE)
    expect(extractLoginCode(`appie://login-exit?code=${CODE}&state=x`)).toBe(CODE)
  })

  it('reads it from a whole pasted console error', () => {
    expect(extractLoginCode(`Failed to launch 'appie://login-exit?code=${CODE}' because the scheme does not have a registered handler.`)).toBe(CODE)
  })

  it('accepts a bare code', () => {
    expect(extractLoginCode(`  ${CODE}  `)).toBe(CODE)
  })

  it('explains when the login page link was pasted instead', () => {
    expect(() => extractLoginCode('https://login.ah.nl/login?client_id=appie-ios&response_type=code&redirect_uri=appie://login-exit'))
      .toThrow(/login page/)
  })

  it('refuses text with no code in it', () => {
    for (const bad of ['', '   ', 'hello world', 'https://www.ah.nl/', null]) {
      expect(() => extractLoginCode(bad)).toThrow(RetailerError)
    }
  })
})

// ---------- exchangeLoginCode ----------

function scriptedFetch(responses) {
  const calls = []
  const fetch = (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null })
    const next = responses.shift() ?? { status: 200, body: {} }
    return Promise.resolve(new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 }))
  }
  return { fetch, calls }
}
const ahWith = (responses, enabled = true) => {
  const { fetch, calls } = scriptedFetch(responses)
  return { adapter: createAhAdapter({ enabled, fetch, sleep: async () => {}, minIntervalMs: 0, timeoutMs: 50 }), calls }
}

describe('exchangeLoginCode', () => {
  it('trades the code for tokens with the app client id', async () => {
    const { adapter, calls } = ahWith([{ body: { access_token: 'a', refresh_token: 'r', expires_in: 604800 } }])
    expect(await adapter.exchangeLoginCode(CODE)).toEqual({ accessToken: 'a', refreshToken: 'r', expiresInSeconds: 604800 })
    expect(calls[0].url).toBe('https://api.ah.nl/mobile-auth/v1/auth/token')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ clientId: 'appie-ios', code: CODE })
  })

  it('an expired or wrong code is an auth error', async () => {
    const { adapter } = ahWith([{ status: 400, body: { message: 'Incorrect request send by client' } }])
    await rejectsWith(adapter.exchangeLoginCode(CODE), 'auth')
  })

  it('respects the kill switch', async () => {
    const { adapter, calls } = ahWith([], false)
    await rejectsWith(adapter.exchangeLoginCode(CODE), 'disabled')
    expect(calls).toHaveLength(0)
  })

  it('the fake adapter accepts any code', async () => {
    const t = await createFakeAdapter().exchangeLoginCode(CODE)
    expect(t.refreshToken).toMatch(/^fake-refresh-/)
  })
})

// ---------- link / unlink / status ----------

// In-memory store with commit-on-success transactions, like the token refresh tests.
function memoryStore({ households = [{ householdId: HOUSEHOLD, userId: USER, ahEnabled: true }], accounts = [] } = {}) {
  const committed = { accounts: accounts.map((a) => ({ ...a })), audit: [] }
  return {
    committed,
    async transaction(fn) {
      const draft = { accounts: committed.accounts.map((a) => ({ ...a })), audit: [...committed.audit] }
      const tx = {
        async getHousehold(userId) {
          const h = households.find((x) => x.userId === userId)
          return h ? { householdId: h.householdId, ahEnabled: h.ahEnabled } : null
        },
        async lockAccount(householdId, retailer) {
          const a = draft.accounts.find((x) => x.household_id === householdId && x.retailer === retailer)
          return a ? { ...a } : null
        },
        async deleteAccount(id) { draft.accounts = draft.accounts.filter((a) => a.id !== id) },
        async insertAccount(row) { draft.accounts.push({ ...row, status: 'linked', token_version: 1, linked_at: '2026-11-06T10:00:00Z', last_refresh_at: null }) },
        async audit(householdId, actorId, action, detail) { draft.audit.push({ householdId, actorId, action, detail }) },
      }
      const result = await fn(tx)
      Object.assign(committed, draft)
      return result
    },
  }
}

function countingFake() {
  const fake = createFakeAdapter()
  const calls = []
  return { calls, adapter: { ...fake, exchangeLoginCode: async (code) => { calls.push(code); return fake.exchangeLoginCode(code) } } }
}

const link = (store, adapter, over = {}) =>
  linkAccount({ store, adapter, masterKeys: { 1: V1 }, userId: USER, retailer: 'ah', pasted: `appie://login-exit?code=${CODE}`, ...over })

const storedToken = (row, keys = { 1: V1 }) => openToken({
  tokenCiphertext: row.token_ciphertext, tokenIv: row.token_iv, wrappedKey: row.wrapped_key, wrappedKeyIv: row.wrapped_key_iv, keyVersion: row.key_version,
}, row.id, keys)

describe('linkAccount', () => {
  it('stores only the encrypted refresh token and reports linked', async () => {
    const store = memoryStore()
    const { adapter, calls } = countingFake()
    const status = await link(store, adapter)
    expect(calls).toEqual([CODE])
    expect(status).toEqual({ state: 'linked', linkedAt: '2026-11-06T10:00:00Z', lastRefreshAt: null })
    const [row] = store.committed.accounts
    expect(row).toMatchObject({ household_id: HOUSEHOLD, retailer: 'ah', key_version: 1, linked_by: USER })
    expect(await storedToken(row)).toMatch(/^fake-refresh-/)
    expect(JSON.stringify(Object.keys(row))).not.toContain('access')
    expect(store.committed.audit).toEqual([{ householdId: HOUSEHOLD, actorId: USER, action: 'retailer.linked', detail: { retailer: 'ah' } }])
  })

  it('wraps with the newest configured master key', async () => {
    const store = memoryStore()
    await link(store, countingFake().adapter, { masterKeys: { 1: V1, 2: V2 } })
    const [row] = store.committed.accounts
    expect(row.key_version).toBe(2)
    expect(await storedToken(row, { 2: V2 })).toMatch(/^fake-refresh-/)
  })

  it('re-linking replaces the old account (new id and data key) and clears relink_needed', async () => {
    const store = memoryStore()
    await link(store, countingFake().adapter)
    const oldId = store.committed.accounts[0].id
    store.committed.accounts[0].status = 'relink_needed'
    const status = await link(store, countingFake().adapter)
    expect(status.state).toBe('linked')
    expect(store.committed.accounts).toHaveLength(1)
    expect(store.committed.accounts[0].id).not.toBe(oldId)
    expect(store.committed.audit.map((a) => a.action)).toEqual(['retailer.linked', 'retailer.relinked'])
  })

  it('refuses when the household does not have the AH feature switched on, before calling AH', async () => {
    const store = memoryStore({ households: [{ householdId: HOUSEHOLD, userId: USER, ahEnabled: false }] })
    const { adapter, calls } = countingFake()
    await rejectsWith(link(store, adapter), 'forbidden')
    expect(calls).toEqual([])
    expect(store.committed.accounts).toEqual([])
  })

  it('refuses a user without a household', async () => {
    await rejectsWith(link(memoryStore({ households: [] }), countingFake().adapter), 'forbidden')
  })

  it('without a master key it fails before using the one-time code', async () => {
    const { adapter, calls } = countingFake()
    await expect(link(memoryStore(), adapter, { masterKeys: {} })).rejects.toBeInstanceOf(TokenCryptoError)
    expect(calls).toEqual([])
  })

  it('a bad paste is refused before calling AH', async () => {
    const { adapter, calls } = countingFake()
    await rejectsWith(link(memoryStore(), adapter, { pasted: 'https://login.ah.nl/login?client_id=appie-ios' }), 'invalid')
    expect(calls).toEqual([])
  })

  it('AH refusing the code stores nothing', async () => {
    const store = memoryStore()
    const adapter = { ...createFakeAdapter(), exchangeLoginCode: async () => { throw new RetailerError('auth', 'expired code', 400) } }
    await rejectsWith(link(store, adapter), 'auth')
    expect(store.committed.accounts).toEqual([])
    expect(store.committed.audit).toEqual([])
  })

  it('no refresh token in AH\'s answer is a schema error and stores nothing', async () => {
    const store = memoryStore()
    const adapter = { ...createFakeAdapter(), exchangeLoginCode: async () => ({ accessToken: 'a', refreshToken: null, expiresInSeconds: 1 }) }
    await rejectsWith(link(store, adapter), 'schema')
    expect(store.committed.accounts).toEqual([])
  })
})

describe('unlinkAccount', () => {
  it('deletes the account (the only copy of its data key) and audits it', async () => {
    const store = memoryStore()
    await link(store, countingFake().adapter)
    expect(await unlinkAccount({ store, userId: USER, retailer: 'ah' })).toEqual({ state: 'not_linked', linkedAt: null, lastRefreshAt: null })
    expect(store.committed.accounts).toEqual([])
    expect(store.committed.audit.at(-1)).toEqual({ householdId: HOUSEHOLD, actorId: USER, action: 'retailer.unlinked', detail: { retailer: 'ah' } })
  })

  it('is safe to repeat when nothing is linked', async () => {
    const store = memoryStore()
    expect((await unlinkAccount({ store, userId: USER, retailer: 'ah' })).state).toBe('not_linked')
    expect(store.committed.audit).toEqual([])
  })

  it('works even if the AH switch has been turned off (a household can always unlink)', async () => {
    const store = memoryStore()
    await link(store, countingFake().adapter)
    const off = memoryStore({ households: [{ householdId: HOUSEHOLD, userId: USER, ahEnabled: false }], accounts: store.committed.accounts })
    expect((await unlinkAccount({ store: off, userId: USER, retailer: 'ah' })).state).toBe('not_linked')
    expect(off.committed.accounts).toEqual([])
  })
})

describe('getLinkStatus', () => {
  it('reports linked / relink_needed / not_linked with dates only, never token data', async () => {
    const store = memoryStore()
    expect((await getLinkStatus({ store, userId: USER, retailer: 'ah' })).state).toBe('not_linked')
    await link(store, countingFake().adapter)
    const linked = await getLinkStatus({ store, userId: USER, retailer: 'ah' })
    expect(linked).toEqual({ state: 'linked', linkedAt: '2026-11-06T10:00:00Z', lastRefreshAt: null })
    store.committed.accounts[0].status = 'relink_needed'
    expect((await getLinkStatus({ store, userId: USER, retailer: 'ah' })).state).toBe('relink_needed')
  })

  it('a user without a household is simply not linked', async () => {
    expect((await getLinkStatus({ store: memoryStore({ households: [] }), userId: USER, retailer: 'ah' })).state).toBe('not_linked')
  })
})
