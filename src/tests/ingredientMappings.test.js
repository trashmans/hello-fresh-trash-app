import { describe, it, expect } from 'vitest'
import { MAPPING_LIMITS, toMappingRow, describeMapping, matchSummary } from '@/lib/ingredientMappings'

const olijfolie = { externalId: 301, title: 'AH Olijfolie', salesUnitSize: '1 l', price: 6.99 }

describe('toMappingRow', () => {
  it('maps an ingredient to the picked AH product', () => {
    expect(toMappingRow({ name: 'Olive Oil', product: olijfolie })).toEqual({
      ok: true,
      row: { ingredient_key: 'olive oil', label: 'Olive Oil', retailer: 'ah', product_external_id: 301, pantry: false },
    })
  })

  it('marks an ingredient as always at home, without a product', () => {
    expect(toMappingRow({ name: 'Salt', pantry: true })).toEqual({
      ok: true,
      row: { ingredient_key: 'salt', label: 'Salt', retailer: 'ah', product_external_id: null, pantry: true },
    })
  })

  it('lets always at home win when a product was picked as well', () => {
    const result = toMappingRow({ name: 'Salt', product: olijfolie, pantry: true })
    expect(result.row).toMatchObject({ product_external_id: null, pantry: true })
  })

  it('stores the key the shopping list uses, and keeps the name as shown', () => {
    const { row } = toMappingRow({ name: '  Sweet   Potatoes ', pantry: true })
    expect(row.ingredient_key).toBe('sweet potato')
    expect(row.label).toBe('Sweet Potatoes')
  })

  it('accepts a product id that arrives as text', () => {
    expect(toMappingRow({ name: 'Olive Oil', product: { ...olijfolie, externalId: '301' } }).row.product_external_id).toBe(301)
  })

  it('refuses a choice with neither a product nor always at home', () => {
    for (const input of [{ name: 'Olive Oil' }, { name: 'Olive Oil', product: null, pantry: false }, { name: 'Olive Oil', product: {} }]) {
      const result = toMappingRow(input)
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/\S/)
    }
  })

  it('refuses a product id that is not a positive whole number', () => {
    for (const externalId of [0, -5, 1.5, 'abc', NaN]) {
      expect(toMappingRow({ name: 'Olive Oil', product: { ...olijfolie, externalId } }).ok).toBe(false)
    }
  })

  it('refuses a missing ingredient name', () => {
    for (const name of ['', '   ', null, undefined]) {
      const result = toMappingRow({ name, pantry: true })
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/\S/)
    }
  })

  it('refuses a name longer than the database allows', () => {
    expect(MAPPING_LIMITS.name).toBe(120)
    expect(toMappingRow({ name: 'x'.repeat(120), pantry: true }).ok).toBe(true)
    expect(toMappingRow({ name: 'x'.repeat(121), pantry: true }).ok).toBe(false)
  })

  it('gives nothing to save for missing input', () => {
    expect(toMappingRow().ok).toBe(false)
  })
})

// Rows as loaded: household_ingredient_mappings with the cached product joined.
describe('describeMapping', () => {
  it('names the product and its pack size', () => {
    const row = { label: 'Olive Oil', pantry: false, product_external_id: 301, product: { title: 'AH Olijfolie', sales_unit_size: '1 l', price: 6.99 } }
    expect(describeMapping(row)).toBe('AH Olijfolie · 1 l')
  })

  it('leaves out a missing pack size', () => {
    const row = { label: 'Bananas', pantry: false, product_external_id: 103, product: { title: 'AH Bananen tros', sales_unit_size: null, price: 1.69 } }
    expect(describeMapping(row)).toBe('AH Bananen tros')
  })

  it('says always at home for a pantry row', () => {
    expect(describeMapping({ label: 'Salt', pantry: true, product_external_id: null, product: null })).toBe('Always at home')
  })

  it('still says something when the product details are missing', () => {
    expect(describeMapping({ label: 'Olive Oil', pantry: false, product_external_id: 301, product: null })).toBe('AH product 301')
  })
})

describe('matchSummary', () => {
  // For "Preview AH order · 3 of 12 matched" on the Shopping tab: how many of the items
  // still to buy are matched to an AH product or marked always at home.
  const product = (ingredient_key) => ({ ingredient_key, pantry: false, product_external_id: 301 })
  const atHome = (ingredient_key) => ({ ingredient_key, pantry: true, product_external_id: null })
  const item = (name) => ({ name })

  it('counts items with a product or marked always at home as matched', () => {
    const items = [item('Olive oil'), item('Salt'), item('Garlic')]
    expect(matchSummary(items, [product('olive oil'), atHome('salt')])).toEqual({ matched: 2, total: 3 })
  })

  it('finds the mapping however the item is spelled, like the preview does', () => {
    expect(matchSummary([item('  Olive   Oils ')], [product('olive oil')])).toEqual({ matched: 1, total: 1 })
  })

  it('counts an ingredient once when two items share it', () => {
    expect(matchSummary([item('Garlic'), item('garlic')], [])).toEqual({ matched: 0, total: 1 })
  })

  it('ignores a mapping without a product that is not at home', () => {
    expect(matchSummary([item('Garlic')], [{ ingredient_key: 'garlic', pantry: false, product_external_id: null }])).toEqual({ matched: 0, total: 1 })
  })

  it('gives 0 of 0 for nothing to buy', () => {
    expect(matchSummary([], [product('olive oil')])).toEqual({ matched: 0, total: 0 })
    expect(matchSummary(null, null)).toEqual({ matched: 0, total: 0 })
  })
})
