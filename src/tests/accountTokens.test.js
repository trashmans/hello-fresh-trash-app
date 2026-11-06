// @vitest-environment node
// Single-flight token refresh (docs/adr/0003 + 0007), tested with an in-memory store
// that behaves like a Postgres transaction with a row lock, and an AH-like adapter
// where only the latest refresh token works.
import { describe, it, expect } from 'vitest'
import { withAccessToken } from '../../supabase/functions/_shared/retailer/accountTokens.ts'
import { sealNewToken, openToken, TokenCryptoError } from '../../supabase/functions/_shared/tokenCrypto.ts'
import { RetailerError } from '../../supabase/functions/_shared/retailer/types.ts'

const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
const KEYS = { 1: KEY }
const HOUSEHOLD = 'hh-1'
const ACCOUNT = 'acct-1'

// ---------- test doubles ----------

// In-memory store: transactions take turns (like SELECT … FOR UPDATE on one row),
// and changes become visible only if the transaction function resolves (commit).
function memoryStore(rows) {
  const committed = { rows: rows.map((r) => ({ ...r })), audit: [] }
  let queue = Promise.resolve()
  const store = {
    committed,
    transaction(fn) {
      const run = queue.then(async () => {
        const draft = { rows: committed.rows.map((r) => ({ ...r })), audit: [...committed.audit] }
        const tx = {
          async lockAccount(householdId, retailer) {
            const row = draft.rows.find((r) => r.household_id === householdId && r.retailer === retailer)
            return row ? { ...row } : null
          },
          async saveRefreshedToken(accountId, sealed, expectedVersion) {
            const row = draft.rows.find((r) => r.id === accountId)
            if (!row || row.token_version !== expectedVersion) throw new Error('token_version changed')
            Object.assign(row, {
              token_ciphertext: sealed.tokenCiphertext, token_iv: sealed.tokenIv,
              wrapped_key: sealed.wrappedKey, wrapped_key_iv: sealed.wrappedKeyIv, key_version: sealed.keyVersion,
              token_version: row.token_version + 1, last_refresh_at: 'now',
            })
          },
          async markRelinkNeeded(accountId) {
            draft.rows.find((r) => r.id === accountId).status = 'relink_needed'
          },
          async audit(householdId, action, detail) {
            draft.audit.push({ householdId, action, detail })
          },
        }
        const result = await fn(tx) // throws → nothing committed
        committed.rows = draft.rows
        committed.audit = draft.audit
        return result
      })
      queue = run.catch(() => {})
      return run
    },
  }
  return store
}

// AH-like: each refresh rotates the token; only the latest one works, others are refused.
function rotatingAh(firstToken, { rotate = true, failWith = null } = {}) {
  let current = firstToken
  let n = 0
  const calls = []
  return {
    calls,
    kind: 'fake', retailer: 'ah', enabled: true,
    async getAccessToken(refreshToken) {
      calls.push(refreshToken)
      if (failWith) throw failWith
      if (refreshToken !== current) throw new RetailerError('auth', 'refresh token no longer valid', 400)
      n++
      if (rotate) current = `refresh-${n}`
      return { accessToken: `access-${n}`, refreshToken: rotate ? current : null, expiresInSeconds: 604800 }
    },
  }
}

async function linkedRow(token = 'refresh-0', over = {}) {
  const s = await sealNewToken(token, ACCOUNT, KEYS, 1)
  return {
    id: ACCOUNT, household_id: HOUSEHOLD, retailer: 'ah', status: 'linked', token_version: 1,
    token_ciphertext: s.tokenCiphertext, token_iv: s.tokenIv, wrapped_key: s.wrappedKey, wrapped_key_iv: s.wrappedKeyIv, key_version: 1,
    ...over,
  }
}

const storedToken = (row) => openToken({
  tokenCiphertext: row.token_ciphertext, tokenIv: row.token_iv, wrappedKey: row.wrapped_key, wrappedKeyIv: row.wrapped_key_iv, keyVersion: row.key_version,
}, row.id, KEYS)

const run = (store, adapter, action = async (t) => t, masterKeys = KEYS) =>
  withAccessToken({ store, adapter, masterKeys, householdId: HOUSEHOLD, retailer: 'ah' }, action)

async function rejectsWith(promise, code) {
  await expect(promise).rejects.toBeInstanceOf(RetailerError)
  await expect(promise).rejects.toMatchObject({ code })
}

// ---------- tests ----------

describe('withAccessToken', () => {
  it('refreshes, saves the rotated token encrypted, and gives the action the access token', async () => {
    const store = memoryStore([await linkedRow()])
    const ah = rotatingAh('refresh-0')
    const result = await run(store, ah, async (accessToken) => `used ${accessToken}`)
    expect(result).toBe('used access-1')
    const row = store.committed.rows[0]
    expect(await storedToken(row)).toBe('refresh-1')
    expect(row.token_version).toBe(2)
    expect(row.status).toBe('linked')
    expect(store.committed.audit.map((a) => a.action)).toEqual(['retailer.token_refreshed'])
  })

  it('commits the new token before the action runs', async () => {
    const store = memoryStore([await linkedRow()])
    let versionSeenByAction = null
    await run(store, rotatingAh('refresh-0'), async () => { versionSeenByAction = store.committed.rows[0].token_version })
    expect(versionSeenByAction).toBe(2)
  })

  it('keeps the saved token if the action itself fails', async () => {
    const store = memoryStore([await linkedRow()])
    await expect(run(store, rotatingAh('refresh-0'), async () => { throw new Error('list write failed') })).rejects.toThrow('list write failed')
    expect(await storedToken(store.committed.rows[0])).toBe('refresh-1') // otherwise the household would be locked out
  })

  it('still records the refresh when AH does not rotate the token', async () => {
    const before = await linkedRow()
    const store = memoryStore([before])
    await run(store, rotatingAh('refresh-0', { rotate: false }))
    const row = store.committed.rows[0]
    expect(await storedToken(row)).toBe('refresh-0')
    expect(row.token_ciphertext).toEqual(before.token_ciphertext)
    expect(row.token_version).toBe(2)
  })

  it('two runs at once both succeed: the second waits and uses the rotated token', async () => {
    const store = memoryStore([await linkedRow()])
    const ah = rotatingAh('refresh-0')
    const [a, b] = await Promise.all([run(store, ah), run(store, ah)])
    expect([a, b]).toEqual(['access-1', 'access-2'])
    expect(ah.calls).toEqual(['refresh-0', 'refresh-1'])
    expect(store.committed.rows[0].token_version).toBe(3)
    expect(await storedToken(store.committed.rows[0])).toBe('refresh-2')
  })

  it('AH refusing the token marks the account relink_needed, audits it, and does not run the action', async () => {
    const store = memoryStore([await linkedRow('refresh-old')])
    let ran = false
    await rejectsWith(run(store, rotatingAh('refresh-current'), async () => { ran = true }), 'auth')
    expect(ran).toBe(false)
    expect(store.committed.rows[0].status).toBe('relink_needed')
    expect(store.committed.rows[0].token_version).toBe(1)
    expect(store.committed.audit.map((a) => a.action)).toEqual(['retailer.relink_needed'])
  })

  it('an account already marked relink_needed fails at once without calling AH', async () => {
    const store = memoryStore([await linkedRow('refresh-0', { status: 'relink_needed' })])
    const ah = rotatingAh('refresh-0')
    await rejectsWith(run(store, ah), 'auth')
    expect(ah.calls).toEqual([])
  })

  it('no linked account is a not_linked error', async () => {
    const ah = rotatingAh('refresh-0')
    await rejectsWith(run(memoryStore([]), ah), 'not_linked')
    expect(ah.calls).toEqual([])
  })

  it('other AH failures (timeout, kill switch) leave the account unchanged', async () => {
    for (const err of [new RetailerError('timeout', 'no answer'), new RetailerError('disabled', 'off')]) {
      const before = await linkedRow()
      const store = memoryStore([before])
      await rejectsWith(run(store, rotatingAh('refresh-0', { failWith: err })), err.code)
      expect(store.committed.rows[0]).toEqual(before)
      expect(store.committed.audit).toEqual([])
    }
  })

  it('a wrong master key fails before AH is called and changes nothing', async () => {
    const store = memoryStore([await linkedRow()])
    const ah = rotatingAh('refresh-0')
    const otherKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    await expect(run(store, ah, async (t) => t, { 1: otherKey })).rejects.toBeInstanceOf(TokenCryptoError)
    expect(ah.calls).toEqual([])
    expect(store.committed.rows[0].token_version).toBe(1)
  })

  it('audit events never contain tokens', async () => {
    const store = memoryStore([await linkedRow()])
    await run(store, rotatingAh('refresh-0'))
    const auditText = JSON.stringify(store.committed.audit)
    for (const secret of ['refresh-0', 'refresh-1', 'access-1']) expect(auditText).not.toContain(secret)
    expect(store.committed.audit[0].detail).toEqual({ retailer: 'ah', token_version: 2 })
  })
})
