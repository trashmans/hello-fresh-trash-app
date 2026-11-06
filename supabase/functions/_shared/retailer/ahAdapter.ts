// The real Albert Heijn adapter (docs/adr/0004). AH has no public API: this uses the
// unofficial mobile-app API the spike proved (spike/ah-api/FINDINGS.md), which AH can
// change or block at any time — so every response is checked (ahSchema.ts), every call
// has a timeout and backoff, requests are spaced out, and a kill switch stops it all.
//
// Only production uses this (see index.ts); preview and local use fakeAdapter.ts.
// Token storage and the single-flight refresh lock live elsewhere (ADR 0003 / 0007):
// this module only talks to AH.

import { RetailerError } from './types.ts'
import type { ListLine, RetailerAdapter, WriteResult } from './types.ts'
import { buildListPatchItems, parseBonusPeriods, parseListResponse, parseSearchResponse, parseTokenResponse } from './ahSchema.ts'

const API = 'https://api.ah.nl'
const CLIENT_ID = 'appie-ios'
const LIST_PATH = '/mobile-services/shoppinglist/v2/items'
const HEADERS = {
  'User-Agent': 'Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)',
  'x-client-name': 'appie-ios',
  'x-client-version': '9.28',
  'x-application': 'AHWEBSHOP',
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

export interface AhAdapterOptions {
  enabled: boolean
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
  minIntervalMs?: number // spacing between requests, to keep the request rate low
  maxAttempts?: number
  baseBackoffMs?: number // waits base, 2×base, 4×base … between attempts
}

const isRetryableStatus = (status: number) => status === 429 || status >= 500

export function createAhAdapter(opts: AhAdapterOptions): RetailerAdapter {
  const enabled = opts.enabled === true
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = opts.now ?? (() => Date.now())
  const timeoutMs = opts.timeoutMs ?? 15_000
  const minIntervalMs = opts.minIntervalMs ?? 300
  const maxAttempts = opts.maxAttempts ?? 3
  const baseBackoffMs = opts.baseBackoffMs ?? 1000
  let lastRequestAt: number | null = null

  const checkEnabled = () => {
    if (!enabled) throw new RetailerError('disabled', 'AH is switched off (RETAILER_AH_ENABLED is not "true")')
  }

  async function attempt(method: string, path: string, token: string | null, body: unknown) {
    if (lastRequestAt != null) {
      const wait = minIntervalMs - (now() - lastRequestAt)
      if (wait > 0) await sleep(wait)
    }
    lastRequestAt = now()

    const headers: Record<string, string> = { ...HEADERS }
    if (token) headers.Authorization = `Bearer ${token}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(API + path, {
        method, headers, body: body == null ? undefined : JSON.stringify(body), signal: controller.signal,
      })
    } catch (err) {
      const timedOut = controller.signal.aborted || (err as Error)?.name === 'AbortError'
      return { retry: true, error: new RetailerError(timedOut ? 'timeout' : 'http', `${method} ${path.split('?')[0]}: ${timedOut ? 'no answer' : 'network error'}`) }
    } finally {
      clearTimeout(timer)
    }

    const raw = await res.text()
    let data: unknown = null
    try { data = raw ? JSON.parse(raw) : null } catch { data = raw }
    if (res.ok) return { data }

    // Never log the response in full (it can contain personal data); status and path are enough.
    const where = `${method} ${path.split('?')[0]} → HTTP ${res.status}`
    if (res.status === 401 || res.status === 403) return { retry: false, error: new RetailerError('auth', where, res.status) }
    return { retry: isRetryableStatus(res.status), error: new RetailerError('http', where, res.status) }
  }

  async function request(method: string, path: string, { token = null, body = null }: { token?: string | null; body?: unknown } = {}) {
    checkEnabled()
    let lastError: RetailerError | null = null
    for (let n = 1; n <= maxAttempts; n++) {
      const result = await attempt(method, path, token, body)
      if (!('error' in result) || !result.error) return result.data
      lastError = result.error
      if (!result.retry || n === maxAttempts) break
      await sleep(baseBackoffMs * 2 ** (n - 1))
    }
    throw lastError!
  }

  return {
    kind: 'ah',
    retailer: 'ah',
    enabled,

    async getAccessToken(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken) throw new RetailerError('invalid', 'No refresh token')
      try {
        return parseTokenResponse(await request('POST', '/mobile-auth/v1/auth/token/refresh', { body: { clientId: CLIENT_ID, refreshToken } }))
      } catch (err) {
        // AH answers a dead refresh token with 400 ("Incorrect request"), not 401.
        if (err instanceof RetailerError && err.code === 'http' && err.status === 400) {
          throw new RetailerError('auth', err.message, 400)
        }
        throw err
      }
    },

    async searchProducts(accessToken, query, size = 10) {
      const q = new URLSearchParams({ query, sortOn: 'RELEVANCE', page: '0', size: String(size) })
      return parseSearchResponse(await request('GET', `/mobile-services/product/search/v2?${q}`, { token: accessToken }))
    },

    async getPromotions(accessToken) {
      return parseBonusPeriods(await request('GET', '/mobile-services/bonuspage/v3/metadata', { token: accessToken }))
    },

    async readList(accessToken) {
      return parseListResponse(await request('GET', LIST_PATH, { token: accessToken }))
    },

    // One PATCH per line (ADR / HLD "apply": idempotent, outcome recorded per line).
    // A failed line doesn't stop the others; the caller records every outcome.
    async writeListLines(accessToken, lines: ListLine[]) {
      checkEnabled()
      const items = buildListPatchItems(lines) // validates the whole batch before sending anything
      const results: WriteResult[] = []
      for (let i = 0; i < lines.length; i++) {
        try {
          await request('PATCH', LIST_PATH, { token: accessToken, body: { items: [items[i]] } })
          results.push({ line: lines[i], ok: true })
        } catch (err) {
          if (!(err instanceof RetailerError)) throw err
          results.push({ line: lines[i], ok: false, error: err })
        }
      }
      return results
    },
  }
}
