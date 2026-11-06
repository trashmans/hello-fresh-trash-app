// @vitest-environment node
// Adapter code targets Deno Edge Functions; it only needs fetch/Response/AbortController,
// which plain Node provides.
import { describe, it, expect } from 'vitest'
import {
  parseSearchResponse, parseTokenResponse, parseBonusPeriods, parseListResponse, buildListPatchItems,
} from '../../supabase/functions/_shared/retailer/ahSchema.ts'
import { createAhAdapter } from '../../supabase/functions/_shared/retailer/ahAdapter.ts'
import { createFakeAdapter } from '../../supabase/functions/_shared/retailer/fakeAdapter.ts'
import { retailerAdapterFor } from '../../supabase/functions/_shared/retailer/index.ts'
import { RetailerError } from '../../supabase/functions/_shared/retailer/types.ts'

const product = (over = {}) => ({
  webshopId: 101, title: 'AH Halfvolle melk', salesUnitSize: '1 l', currentPrice: 1.19,
  priceBeforeBonus: 1.19, isBonus: false, isOrderable: true, ...over,
})

// Expect a promise to reject with a RetailerError carrying the given code.
async function rejectsWith(promise, code) {
  await expect(promise).rejects.toBeInstanceOf(RetailerError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('parseSearchResponse', () => {
  it('maps AH products to our own type', () => {
    expect(parseSearchResponse({ products: [product()] })).toEqual([{
      externalId: 101, title: 'AH Halfvolle melk', salesUnitSize: '1 l', price: 1.19, orderable: true, promotion: null,
    }])
  })

  it('keeps a national bonus as a promotion', () => {
    const [p] = parseSearchResponse({ products: [product({ isBonus: true, bonusMechanism: '2e GRATIS', currentPrice: 0.6, priceBeforeBonus: 1.19 })] })
    expect(p.promotion).toEqual({ mechanism: '2e GRATIS', priceBefore: 1.19 })
    expect(p.price).toBe(0.6)
  })

  it('marks products that cannot be ordered online', () => {
    const items = parseSearchResponse({ products: [product({ isOrderable: false }), product({ webshopId: 102, availableOnline: false })] })
    expect(items.map((p) => p.orderable)).toEqual([false, false])
  })

  it('skips products without an id or title, keeps the rest', () => {
    const items = parseSearchResponse({ products: [product({ webshopId: undefined }), product({ title: '' }), product({ webshopId: '103' })] })
    expect(items.map((p) => p.externalId)).toEqual([103])
  })

  it('stops with a schema error when the response shape changed', () => {
    for (const bad of [null, {}, { products: 'x' }, 'html error page']) {
      expect(() => parseSearchResponse(bad)).toThrow(RetailerError)
    }
    expect(parseSearchResponse({ products: [] })).toEqual([])
  })
})

describe('parseTokenResponse', () => {
  it('reads the rotated tokens and lifetime', () => {
    expect(parseTokenResponse({ access_token: 'a', refresh_token: 'r2', expires_in: 604800 }))
      .toEqual({ accessToken: 'a', refreshToken: 'r2', expiresInSeconds: 604800 })
  })

  it('allows AH to not rotate (no new refresh token)', () => {
    expect(parseTokenResponse({ access_token: 'a' })).toEqual({ accessToken: 'a', refreshToken: null, expiresInSeconds: null })
  })

  it('stops with a schema error without an access token', () => {
    expect(() => parseTokenResponse({ refresh_token: 'r' })).toThrow(RetailerError)
    expect(() => parseTokenResponse(null)).toThrow(RetailerError)
  })
})

describe('parseBonusPeriods', () => {
  it('reads bonus weeks as YYYY-MM-DD dates', () => {
    expect(parseBonusPeriods({ periods: [{ bonusStartDate: '2026-11-09', bonusEndDate: '2026-11-15' }] }))
      .toEqual([{ start: '2026-11-09', end: '2026-11-15' }])
  })

  it('skips malformed periods but fails if the list itself is missing', () => {
    expect(parseBonusPeriods({ periods: [{ bonusStartDate: 'soon' }, { bonusStartDate: '2026-11-09', bonusEndDate: '2026-11-15' }] }))
      .toHaveLength(1)
    expect(() => parseBonusPeriods({})).toThrow(RetailerError)
  })
})

describe('parseListResponse', () => {
  it('maps product lines, free-text lines and ticked items', () => {
    const items = parseListResponse({ items: [
      { description: 'AH Halfvolle melk', productDetails: { product: { webshopId: 101 } }, quantity: 2, strikedthrough: false },
      { description: 'iets lekkers', productId: 0, quantity: 1, strikedthrough: true },
    ] })
    expect(items).toEqual([
      { productId: 101, text: 'AH Halfvolle melk', quantity: 2, ticked: false },
      { productId: null, text: 'iets lekkers', quantity: 1, ticked: true },
    ])
  })

  it('stops with a schema error when items is not a list', () => {
    expect(() => parseListResponse({ items: {} })).toThrow(RetailerError)
  })
})

describe('buildListPatchItems', () => {
  it('builds product and free-text lines in AH format, unticked', () => {
    expect(buildListPatchItems([
      { productId: 101, text: 'AH Halfvolle melk', quantity: 2 },
      { productId: null, text: 'bananen', quantity: 1 },
    ])).toEqual([
      { description: 'AH Halfvolle melk', productId: 101, quantity: 2, type: 'SHOPPABLE', originCode: 'PRD', searchTerm: 'AH Halfvolle melk', strikeThrough: false },
      { description: 'bananen', quantity: 1, type: 'SHOPPABLE', originCode: 'TXT', strikeThrough: false },
    ])
  })

  it('never removes: refuses quantities below 1 or not whole numbers', () => {
    for (const quantity of [0, -1, 1.5, NaN]) {
      expect(() => buildListPatchItems([{ productId: 101, text: 'x', quantity }])).toThrow(RetailerError)
    }
    expect(() => buildListPatchItems([{ productId: null, text: '', quantity: 1 }])).toThrow(RetailerError)
  })
})

// A scripted fetch: each call takes the next response (or 'hang' to never answer).
function scriptedFetch(responses) {
  const calls = []
  const fetch = (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null })
    const next = responses.shift() ?? { status: 200, body: {} }
    if (next === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    }
    return Promise.resolve(new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 }))
  }
  return { fetch, calls }
}

function adapterWith(responses, over = {}) {
  const { fetch, calls } = scriptedFetch(responses)
  const waits = []
  let clock = 1_000_000
  const adapter = createAhAdapter({
    enabled: true, fetch, timeoutMs: 20, minIntervalMs: 0,
    sleep: async (ms) => { waits.push(ms); clock += ms },
    now: () => clock,
    ...over,
  })
  return { adapter, calls, waits }
}

describe('createAhAdapter', () => {
  it('kill switch: with enabled false every call fails and nothing is sent', async () => {
    const { adapter, calls } = adapterWith([], { enabled: false })
    await rejectsWith(adapter.searchProducts('tok', 'melk'), 'disabled')
    await rejectsWith(adapter.getAccessToken('refresh'), 'disabled')
    await rejectsWith(adapter.writeListLines('tok', [{ productId: 101, text: 'x', quantity: 1 }]), 'disabled')
    expect(calls).toHaveLength(0)
  })

  it('searches with the bearer token and AH app headers', async () => {
    const { adapter, calls } = adapterWith([{ body: { products: [product()] } }])
    const results = await adapter.searchProducts('tok', 'halfvolle melk')
    expect(results[0].externalId).toBe(101)
    expect(calls[0].url).toMatch(/^https:\/\/api\.ah\.nl\/mobile-services\/product\/search\/v2\?/)
    expect(calls[0].url).toContain('query=halfvolle+melk')
    expect(calls[0].headers.Authorization).toBe('Bearer tok')
    expect(calls[0].headers['x-client-name']).toBe('appie-ios')
  })

  it('refreshes the token with the app client id', async () => {
    const { adapter, calls } = adapterWith([{ body: { access_token: 'a2', refresh_token: 'r2', expires_in: 10 } }])
    expect(await adapter.getAccessToken('r1')).toEqual({ accessToken: 'a2', refreshToken: 'r2', expiresInSeconds: 10 })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ clientId: 'appie-ios', refreshToken: 'r1' })
  })

  it('a refused refresh is an auth error (household must re-link)', async () => {
    const { adapter } = adapterWith([{ status: 401, body: { message: 'invalid' } }])
    await rejectsWith(adapter.getAccessToken('dead'), 'auth')
  })

  it('retries 503 with backoff, then succeeds', async () => {
    const { adapter, calls, waits } = adapterWith([{ status: 503 }, { body: { items: [] } }])
    expect(await adapter.readList('tok')).toEqual([])
    expect(calls).toHaveLength(2)
    expect(waits).toEqual([1000])
  })

  it('gives up after 3 attempts with exponential waits', async () => {
    const { adapter, calls, waits } = adapterWith([{ status: 429 }, { status: 429 }, { status: 429 }])
    await rejectsWith(adapter.readList('tok'), 'http')
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([1000, 2000])
  })

  it('does not retry a 400 (our request was wrong)', async () => {
    const { adapter, calls } = adapterWith([{ status: 400 }])
    await rejectsWith(adapter.readList('tok'), 'http')
    expect(calls).toHaveLength(1)
  })

  it('times out a hanging request, retries, and reports a timeout', async () => {
    const { adapter, calls } = adapterWith(['hang', 'hang', 'hang'])
    await rejectsWith(adapter.readList('tok'), 'timeout')
    expect(calls).toHaveLength(3)
  })

  it('spaces requests out to keep a low request rate', async () => {
    const { adapter, waits } = adapterWith([{ body: { items: [] } }, { body: { items: [] } }], { minIntervalMs: 500 })
    await adapter.readList('tok')
    await adapter.readList('tok')
    expect(waits).toEqual([500])
  })

  it('a changed response shape is a schema error, not wrong data', async () => {
    const { adapter } = adapterWith([{ body: { unexpected: true } }])
    await rejectsWith(adapter.searchProducts('tok', 'melk'), 'schema')
  })

  it('writes one PATCH per line and reports each outcome', async () => {
    const { adapter, calls } = adapterWith([{ body: {} }, { status: 400, body: { message: 'bad product' } }])
    const results = await adapter.writeListLines('tok', [
      { productId: 101, text: 'AH Halfvolle melk', quantity: 2 },
      { productId: 999, text: 'Unknown', quantity: 1 },
    ])
    expect(results.map((r) => r.ok)).toEqual([true, false])
    expect(results[1].error.code).toBe('http')
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH'])
    expect(calls[0].body.items).toHaveLength(1)
  })
})

describe('createFakeAdapter (preview and local)', () => {
  it('searches recorded products and never calls the network', async () => {
    const fake = createFakeAdapter()
    const results = await fake.searchProducts('fake', 'melk')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((p) => p.title.toLowerCase().includes('melk'))).toBe(true)
  })

  it('keeps its own in-memory list: add, raise and untick like AH', async () => {
    const fake = createFakeAdapter({ list: [{ productId: 101, text: 'AH Halfvolle melk', quantity: 1, ticked: true }] })
    const results = await fake.writeListLines('fake', [
      { productId: 101, text: 'AH Halfvolle melk', quantity: 2 },
      { productId: null, text: 'bananen', quantity: 1 },
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(await fake.readList('fake')).toEqual([
      { productId: 101, text: 'AH Halfvolle melk', quantity: 2, ticked: false },
      { productId: null, text: 'bananen', quantity: 1, ticked: false },
    ])
  })

  it('rotates fake tokens and reports the current bonus week', async () => {
    const fake = createFakeAdapter({ now: () => Date.UTC(2026, 10, 11) }) // Wednesday 11 Nov 2026
    const t1 = await fake.getAccessToken('r0')
    const t2 = await fake.getAccessToken(t1.refreshToken)
    expect(t2.refreshToken).not.toBe(t1.refreshToken)
    expect(await fake.getPromotions('fake')).toEqual([{ start: '2026-11-09', end: '2026-11-15' }])
  })
})

describe('retailerAdapterFor', () => {
  it('preview and local always get the fake adapter, even with AH enabled', () => {
    const env = { APP_ENVIRONMENT: 'preview', RETAILER_AH_ENABLED: 'true' }
    expect(retailerAdapterFor('ah', (k) => env[k]).kind).toBe('fake')
    expect(retailerAdapterFor('ah', () => undefined).kind).toBe('fake')
  })

  it('production gets the real adapter; the kill switch decides whether it may call AH', async () => {
    const on = retailerAdapterFor('ah', (k) => ({ APP_ENVIRONMENT: 'production', RETAILER_AH_ENABLED: 'true' })[k])
    expect(on.kind).toBe('ah')
    expect(on.enabled).toBe(true)
    const off = retailerAdapterFor('ah', (k) => ({ APP_ENVIRONMENT: 'production' })[k])
    expect(off.kind).toBe('ah')
    await rejectsWith(off.readList('tok'), 'disabled')
  })

  it('refuses retailers that have no adapter yet', () => {
    expect(() => retailerAdapterFor('jumbo', () => undefined)).toThrow(RetailerError)
  })
})
