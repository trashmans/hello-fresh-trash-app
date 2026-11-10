// @vitest-environment node
// Product search for the Staples screen: query checks, the product-cache rows, and the
// search flow with in-memory stand-ins for the database and the retailer.
import { describe, it, expect } from 'vitest'
import {
  MIN_QUERY_LENGTH, MAX_QUERY_LENGTH, checkSearchQuery, toProductRow, toSearchResult, searchRetailerProducts,
} from '../../supabase/functions/_shared/retailer/productSearch.ts'
import { RetailerError } from '../../supabase/functions/_shared/retailer/types.ts'

const NOW = '2026-11-10T12:00:00.000Z'
const milk = { externalId: 101, title: 'AH Halfvolle melk', salesUnitSize: '1 l', price: 1.19, orderable: true, promotion: null }
const rice = { externalId: 104, title: 'AH Basmati rijst', salesUnitSize: '1 kg', price: 2.99, orderable: true, promotion: { mechanism: '2e GRATIS', priceBefore: 2.99 } }
const soldOut = { externalId: 108, title: 'AH Lijnzaad gebroken', salesUnitSize: '250 g', price: 1.89, orderable: false, promotion: null }

describe('checkSearchQuery', () => {
  it('allows 2 to 60 characters', () => {
    expect([MIN_QUERY_LENGTH, MAX_QUERY_LENGTH]).toEqual([2, 60])
  })

  it('trims and collapses spaces', () => {
    expect(checkSearchQuery('  halfvolle   melk ')).toEqual({ ok: true, query: 'halfvolle melk' })
  })

  it('refuses too short, too long, empty and non-text queries with a message', () => {
    for (const raw of ['a', ' a ', '', null, undefined, 42, {}, 'x'.repeat(61)]) {
      const result = checkSearchQuery(raw)
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/\S/)
    }
  })
})

describe('toProductRow', () => {
  it('maps a retailer product to a product-cache row', () => {
    expect(toProductRow('ah', rice, NOW)).toEqual({
      retailer: 'ah', external_id: 104, title: 'AH Basmati rijst', sales_unit_size: '1 kg', price: 2.99, orderable: true, last_seen_at: NOW,
    })
  })
})

describe('toSearchResult', () => {
  it('keeps what the Staples screen shows, including a national bonus', () => {
    expect(toSearchResult(rice)).toEqual({
      externalId: 104, title: 'AH Basmati rijst', salesUnitSize: '1 kg', price: 2.99, bonus: '2e GRATIS',
    })
    expect(toSearchResult(milk).bonus).toBeNull()
  })
})

// In-memory stand-ins. `calls` records what the flow did, in order.
function deps({ household = { householdId: 'hh-1', ahEnabled: true }, products = [milk, rice, soldOut], saveFails = false } = {}) {
  const calls = []
  return {
    calls,
    saved: [],
    getHousehold: async (userId) => { calls.push(['getHousehold', userId]); return household },
    withToken: async (householdId, fn) => { calls.push(['withToken', householdId]); return fn('access-token') },
    search: async (token, query, size) => { calls.push(['search', token, query, size]); return products },
    async saveProducts(rows) { calls.push(['saveProducts', rows.length]); if (saveFails) throw new Error('db down'); this.saved.push(...rows) },
    now: () => NOW,
  }
}

describe('searchRetailerProducts', () => {
  it('searches with the cleaned query, caches every product seen and returns the orderable ones in the retailer order', async () => {
    const d = deps()
    const result = await searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: '  rijst ' })
    expect(result.products.map((p) => p.externalId)).toEqual([101, 104])
    expect(d.calls).toEqual([
      ['getHousehold', 'u-1'],
      ['withToken', 'hh-1'],
      ['search', 'access-token', 'rijst', 12],
      ['saveProducts', 3],
    ])
    expect(d.saved.map((r) => r.external_id)).toEqual([101, 104, 108])
  })

  it('drops repeats of the same product', async () => {
    const d = deps({ products: [milk, milk, rice] })
    const result = await searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'melk' })
    expect(result.products.map((p) => p.externalId)).toEqual([101, 104])
    expect(d.saved.map((r) => r.external_id)).toEqual([101, 104])
  })

  it('refuses a bad query before touching the household account', async () => {
    const d = deps()
    await expect(searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'a' })).rejects.toMatchObject({ code: 'invalid' })
    expect(d.calls).toEqual([])
  })

  it('refuses users without a household, and households with the AH switch off, without using the token', async () => {
    for (const household of [null, { householdId: 'hh-1', ahEnabled: false }]) {
      const d = deps({ household })
      const error = await searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'melk' }).catch((e) => e)
      expect(error).toBeInstanceOf(RetailerError)
      expect(error.code).toBe('forbidden')
      expect(d.calls).toEqual([['getHousehold', 'u-1']])
    }
  })

  it('still returns results when saving to the product cache fails', async () => {
    const d = deps({ saveFails: true })
    const result = await searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'melk' })
    expect(result.products).toHaveLength(2)
  })

  it('passes retailer errors (e.g. not linked) through unchanged', async () => {
    const d = deps()
    d.withToken = async () => { throw new RetailerError('not_linked', 'not linked') }
    await expect(searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'melk' })).rejects.toMatchObject({ code: 'not_linked' })
  })
})

// English searches: deps.translate (Gemini in the Edge Function) turns the query into the
// Dutch words AH uses. Results for the Dutch term come first, then for the words as typed.
describe('searchRetailerProducts with translation', () => {
  const tomatoes = { externalId: 201, title: 'AH Tomatenblokjes', salesUnitSize: '400 g', price: 0.89, orderable: true, promotion: null }
  const passata = { externalId: 202, title: 'AH Passata', salesUnitSize: '500 g', price: 1.29, orderable: true, promotion: null }

  function translatingDeps(translation, byTerm) {
    const d = deps()
    d.translate = async (query) => {
      d.calls.push(['translate', query])
      if (translation instanceof Error) throw translation
      return translation
    }
    d.search = async (token, query, size) => { d.calls.push(['search', token, query, size]); return byTerm[query] ?? [] }
    return d
  }

  it('searches the Dutch term first, then the words as typed, under one token, and says what it searched for', async () => {
    const d = translatingDeps('tomatenblokjes', { tomatenblokjes: [tomatoes, passata], 'crushed tomatoes': [passata, milk] })
    const result = await searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'crushed tomatoes' })
    expect(d.calls).toEqual([
      ['getHousehold', 'u-1'],
      ['translate', 'crushed tomatoes'],
      ['withToken', 'hh-1'],
      ['search', 'access-token', 'tomatenblokjes', 12],
      ['search', 'access-token', 'crushed tomatoes', 12],
      ['saveProducts', 3],
    ])
    expect(result.products.map((p) => p.externalId)).toEqual([201, 202, 101])
    expect(result.searchedFor).toEqual(['tomatenblokjes', 'crushed tomatoes'])
  })

  it('searches once when the query is already Dutch (same words, any case or spacing)', async () => {
    const d = translatingDeps('Halfvolle  Melk ', { 'halfvolle melk': [milk] })
    const result = await searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'halfvolle melk' })
    expect(d.calls.filter((c) => c[0] === 'search')).toEqual([['search', 'access-token', 'halfvolle melk', 12]])
    expect(result.searchedFor).toEqual(['halfvolle melk'])
  })

  it('falls back to the words as typed when translation fails or gives nothing usable', async () => {
    for (const translation of [new Error('Gemini down'), null, '', 'x', 'y'.repeat(61)]) {
      const d = translatingDeps(translation, { onions: [milk] })
      const result = await searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'onions' })
      expect(d.calls.filter((c) => c[0] === 'search')).toEqual([['search', 'access-token', 'onions', 12]])
      expect(result.searchedFor).toEqual(['onions'])
    }
  })

  it('does not translate a refused query or for a household without AH', async () => {
    const d = translatingDeps('melk', {})
    await expect(searchRetailerProducts(d, { userId: 'u-1', retailer: 'ah', query: 'a' })).rejects.toMatchObject({ code: 'invalid' })
    const off = translatingDeps('melk', {})
    off.getHousehold = async () => ({ householdId: 'hh-1', ahEnabled: false })
    await expect(searchRetailerProducts(off, { userId: 'u-1', retailer: 'ah', query: 'milk' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(d.calls.some((c) => c[0] === 'translate')).toBe(false)
    expect(off.calls.some((c) => c[0] === 'translate')).toBe(false)
  })
})
