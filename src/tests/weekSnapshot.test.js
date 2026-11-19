// @vitest-environment node
// This week's AH snapshot for the preview (rollout phase 5): the household's current AH
// list plus this week's product info for the staples that need a live answer. Read-only.
// The database and the retailer are in-memory stand-ins, as in productSearch.test.js.
import { describe, it, expect } from 'vitest'
import { MAX_LOOKUPS, stapleLookup, getWeekSnapshot } from '../../supabase/functions/_shared/retailer/weekSnapshot.ts'
import { RetailerError } from '../../supabase/functions/_shared/retailer/types.ts'

const NOW = '2026-11-16T05:00:00.000Z'
const RICE_IMG = 'https://static.ah.nl/dam/product/AHI_rice?revLabel=1&rendition=200x200_WEBP&fileType=binary'
const milk = { externalId: 101, title: 'AH Halfvolle melk', salesUnitSize: '1 l', price: 1.19, orderable: true, promotion: null }
const bananas = { externalId: 103, title: 'AH Bananen tros', salesUnitSize: 'per tros', price: 1.69, orderable: true, promotion: null }
const rice = { externalId: 104, title: 'AH Basmati rijst', salesUnitSize: '1 kg', price: 2.99, orderable: true, promotion: { mechanism: '2e GRATIS', priceBefore: 2.99 }, imageUrl: RICE_IMG }
const soldOut = { externalId: 108, title: 'AH Bananen los', salesUnitSize: 'per stuk', price: 0.4, orderable: false, promotion: null }

// Staple rows as the function reads them (household_staples + the cached product title).
const staple = (over) => ({
  id: 's', product_external_id: null, product_title: null, search_term: null,
  perishable: true, max_weeks_stock: null, active: true, ...over,
})
const milkStaple = staple({ id: 's-milk', product_external_id: 101, product_title: 'AH Halfvolle melk' })
const riceStaple = staple({ id: 's-rice', product_external_id: 104, product_title: 'AH Basmati rijst', perishable: false, max_weeks_stock: 8 })
const bananaStaple = staple({ id: 's-ban', search_term: 'bananen' })

const LIST = [
  { productId: 101, text: 'AH Halfvolle melk', quantity: 1, ticked: false },
  { productId: null, text: 'Kaarsen', quantity: 1, ticked: true },
]

// In-memory stand-ins. `calls` records what the flow did, in order.
function deps({
  household = { householdId: 'hh-1', ahEnabled: true },
  staples = [],
  list = LIST,
  results = {},           // { [query]: products }
  saveFails = false,
  listError = null,
} = {}) {
  const calls = []
  return {
    calls,
    saved: [],
    getHousehold: async (userId) => { calls.push(['getHousehold', userId]); return household },
    getStaples: async (householdId) => { calls.push(['getStaples', householdId]); return staples },
    withToken: async (householdId, fn) => { calls.push(['withToken', householdId]); return fn('access-token') },
    readList: async (token) => { calls.push(['readList', token]); if (listError) throw listError; return list },
    search: async (token, query, size) => { calls.push(['search', query]); return results[query] ?? [] },
    async saveProducts(rows) { calls.push(['saveProducts', rows.length]); if (saveFails) throw new Error('db down'); this.saved.push(...rows) },
    now: () => NOW,
  }
}
const run = (d) => getWeekSnapshot(d, { userId: 'u-1', retailer: 'ah' })
const searches = (d) => d.calls.filter(c => c[0] === 'search').map(c => c[1])

describe('stapleLookup', () => {
  it('looks up a search-term staple by its search term', () => {
    expect(stapleLookup(bananaStaple)).toEqual({ kind: 'search', query: 'bananen' })
  })

  it('looks up a pinned staple that can stock up on bonus by its product title', () => {
    expect(stapleLookup(riceStaple)).toEqual({ kind: 'pinned', query: 'AH Basmati rijst' })
  })

  it('needs no lookup for a pinned perishable staple (the cached product is enough)', () => {
    expect(stapleLookup(milkStaple)).toBeNull()
  })

  it('needs no lookup for a paused staple', () => {
    expect(stapleLookup({ ...riceStaple, active: false })).toBeNull()
    expect(stapleLookup({ ...bananaStaple, active: false })).toBeNull()
  })

  it('cannot look up a pinned staple whose product title is unknown', () => {
    expect(stapleLookup({ ...riceStaple, product_title: null })).toBeNull()
  })

  it('cleans the query and refuses one AH would not accept', () => {
    expect(stapleLookup({ ...bananaStaple, search_term: '  bananen   tros ' })).toEqual({ kind: 'search', query: 'bananen tros' })
    expect(stapleLookup({ ...bananaStaple, search_term: 'a' })).toBeNull()
  })
})

describe('getWeekSnapshot', () => {
  it('returns the current AH list as it is, ticked and hand-added items included', async () => {
    const d = deps()
    const result = await run(d)
    expect(result.list).toEqual(LIST)
    expect(result.products).toEqual({})
    expect(d.calls).toEqual([['getHousehold', 'u-1'], ['getStaples', 'hh-1'], ['withToken', 'hh-1'], ['readList', 'access-token']])
  })

  it('refuses a user without a household before touching the token', async () => {
    const d = deps({ household: null })
    await expect(run(d)).rejects.toMatchObject({ code: 'forbidden' })
    expect(d.calls).toEqual([['getHousehold', 'u-1']])
  })

  it('refuses a household with the AH switch off before touching the token', async () => {
    const d = deps({ household: { householdId: 'hh-1', ahEnabled: false } })
    await expect(run(d)).rejects.toMatchObject({ code: 'forbidden' })
    expect(d.calls).toEqual([['getHousehold', 'u-1']])
  })

  it("gives this week's bonus for a pinned staple that can stock up, matched by product id", async () => {
    const d = deps({ staples: [riceStaple], results: { 'AH Basmati rijst': [milk, rice] } })
    const result = await run(d)
    expect(result.products).toEqual({
      's-rice': { externalId: 104, title: 'AH Basmati rijst', salesUnitSize: '1 kg', price: 2.99, mechanism: '2e GRATIS', imageUrl: RICE_IMG },
    })
  })

  it('gives no entry when the pinned product is not in the search results', async () => {
    const d = deps({ staples: [riceStaple], results: { 'AH Basmati rijst': [milk] } })
    expect((await run(d)).products).toEqual({})
  })

  it('does not search for pinned perishable or paused staples', async () => {
    const d = deps({ staples: [milkStaple, { ...riceStaple, active: false }] })
    await run(d)
    expect(searches(d)).toEqual([])
  })

  it('resolves a search-term staple to the first orderable product', async () => {
    const d = deps({ staples: [bananaStaple], results: { bananen: [soldOut, bananas, milk] } })
    expect((await run(d)).products).toEqual({
      's-ban': { externalId: 103, title: 'AH Bananen tros', salesUnitSize: 'per tros', price: 1.69, mechanism: null, imageUrl: null },
    })
  })

  it('gives no entry for a search-term staple when nothing orderable is found', async () => {
    const d = deps({ staples: [bananaStaple], results: { bananen: [soldOut] } })
    expect((await run(d)).products).toEqual({})
  })

  it('uses one token for the list and every lookup, list first', async () => {
    const d = deps({ staples: [riceStaple, bananaStaple], results: { 'AH Basmati rijst': [rice], bananen: [bananas] } })
    await run(d)
    expect(d.calls.filter(c => c[0] === 'withToken')).toHaveLength(1)
    expect(d.calls.slice(3, 6)).toEqual([['readList', 'access-token'], ['search', 'AH Basmati rijst'], ['search', 'bananen']])
  })

  it('searches once when two staples need the same query', async () => {
    const second = { ...bananaStaple, id: 's-ban-2', search_term: 'Bananen' }
    const d = deps({ staples: [bananaStaple, second], results: { bananen: [bananas] } })
    const result = await run(d)
    expect(searches(d)).toEqual(['bananen'])
    expect(Object.keys(result.products)).toEqual(['s-ban', 's-ban-2'])
  })

  it(`looks up at most ${MAX_LOOKUPS} different queries`, async () => {
    const many = Array.from({ length: MAX_LOOKUPS + 5 }, (_, i) => staple({ id: `s-${i}`, search_term: `product ${i}` }))
    const d = deps({ staples: many })
    const result = await run(d)
    expect(searches(d)).toHaveLength(MAX_LOOKUPS)
    expect(result.skippedLookups).toBe(5)
  })

  it('reports no skipped lookups normally', async () => {
    expect((await run(deps({ staples: [bananaStaple] }))).skippedLookups).toBe(0)
  })

  it('saves every product it saw in the product cache', async () => {
    const d = deps({ staples: [riceStaple, bananaStaple], results: { 'AH Basmati rijst': [milk, rice], bananen: [soldOut, bananas, milk] } })
    await run(d)
    expect(d.saved.map(r => r.external_id)).toEqual([101, 104, 108, 103])
    expect(d.saved[0]).toEqual({
      retailer: 'ah', external_id: 101, title: 'AH Halfvolle melk', sales_unit_size: '1 l', price: 1.19, orderable: true, image_url: null, last_seen_at: NOW,
    })
    expect(d.saved[1].image_url).toBe(RICE_IMG)
  })

  it('still answers when the product cache cannot be updated', async () => {
    const errors = []
    const d = { ...deps({ staples: [bananaStaple], results: { bananen: [bananas] }, saveFails: true }), onCacheError: (e) => errors.push(e.message) }
    const result = await run(d)
    expect(result.products['s-ban'].externalId).toBe(103)
    expect(errors).toEqual(['db down'])
  })

  it('does not touch the product cache when nothing was looked up', async () => {
    const d = deps({ staples: [milkStaple] })
    await run(d)
    expect(d.calls.some(c => c[0] === 'saveProducts')).toBe(false)
  })

  it('passes on a retailer failure instead of returning half a snapshot', async () => {
    const d = deps({ staples: [bananaStaple], listError: new RetailerError('auth', 'AH refused the token') })
    await expect(run(d)).rejects.toMatchObject({ code: 'auth' })
    expect(searches(d)).toEqual([])
  })
})
