import { describe, it, expect } from 'vitest'
import { planWeek } from '@/lib/planWeek'

// 2026-10-26 is a Monday.
const RUN = '2026-10-26'

// Products the household uses, keyed by our product id. externalId is AH's id;
// salesUnitSize and mechanism come from the latest product and promotion data.
const products = {
  milk:   { externalId: 1525, salesUnitSize: '1 l', mechanism: null },
  coffee: { externalId: 9001, salesUnitSize: '500 g', mechanism: '2e GRATIS' },
  rice:   { externalId: 5000, salesUnitSize: '400 g', mechanism: null },
  onion:  { externalId: 4000, salesUnitSize: '1 kg', mechanism: null },
  wine:   { externalId: 7000, salesUnitSize: '0,75 l', mechanism: null },
}

const staple = (overrides) => ({
  quantity: 1, cadence_weeks: 1, perishable: true, usage_per_week: null, max_weeks_stock: null,
  active: true, skip_next: false, last_added_on: null, covered_until: null, ...overrides,
})

const staples = [
  staple({ id: 'st-milk', product_id: 'milk', quantity: 2, last_added_on: '2026-10-19' }),
  staple({ id: 'st-coffee', product_id: 'coffee', cadence_weeks: 2, perishable: false, usage_per_week: 0.5, max_weeks_stock: 8 }),
  staple({ id: 'st-wine', product_id: 'wine', skip_next: true }),
]

// Recipe ingredients for the chosen recipes, already scaled to the chosen servings.
const ingredients = [
  { canonical_name: 'rice', name: 'jasmine rice', quantity: 10.6, unit: 'oz' },   // 300.5 g
  { canonical_name: 'salt', name: 'salt', quantity: 1, unit: 'tsp' },
  { canonical_name: 'lemongrass', name: 'lemongrass stalks', quantity: 2, unit: 'stalk' },
  { canonical_name: 'onion', name: 'yellow onion', quantity: 2, unit: null },
  { canonical_name: 'Rice', name: 'rice', quantity: 150, unit: 'g' },             // + 150 g = 450.5 g
  { canonical_name: 'milk', name: 'milk', quantity: 1, unit: 'cup' },             // 240 mL
]

// What the household has chosen for each ingredient name (keyed by canonical name, lowercase).
const mappings = {
  rice:  { product_id: 'rice', pantry: false },
  salt:  { product_id: null, pantry: true },
  onion: { product_id: 'onion', pantry: false },
  milk:  { product_id: 'milk', pantry: false },
}

const plan = () => planWeek({ runDate: RUN, staples, products, ingredients, mappings })

describe('planWeek', () => {
  it('builds the combined target list in a stable order', () => {
    expect(plan().lines).toEqual([
      { productId: 1525, text: null, packs: 3, sources: ['staple', 'recipe'] },   // 2 staple + 1 recipe
      { productId: 9001, text: null, packs: 4, sources: ['stockup'] },            // bonus stock-up
      { productId: 5000, text: null, packs: 2, sources: ['recipe'] },             // 450.5 g in 400 g packs
      { productId: null, text: 'lemongrass stalks', packs: 1, sources: ['recipe'] },
      { productId: 4000, text: null, packs: 1, sources: ['recipe'] },
    ])
  })

  it('returns what to save back to each staple', () => {
    expect(plan().stapleUpdates).toEqual([
      { staple_id: 'st-milk', last_added_on: RUN },
      { staple_id: 'st-coffee', last_added_on: RUN, covered_until: '2026-12-20' },
      { staple_id: 'st-wine', skip_next: false },
    ])
  })

  it('flags ingredients that need a human look', () => {
    expect(plan().review).toEqual([
      { reason: 'unmatched', ingredient: 'lemongrass stalks' },
      { reason: 'check_quantity', ingredient: 'yellow onion', productId: 4000 },
    ])
  })

  it('records the run week and why each staple was or was not included', () => {
    const result = plan()
    expect(result.weekStart).toBe(RUN)
    expect(result.stapleDecisions).toEqual([
      { staple_id: 'st-milk', included: true, reason: 'cadence', packs: 2 },
      { staple_id: 'st-coffee', included: true, reason: 'stock_up', packs: 4 },
      { staple_id: 'st-wine', included: false, reason: 'skipped', packs: 0 },
    ])
  })

  it('stores the Monday of the run week, whatever day it runs', () => {
    const result = planWeek({ runDate: '2026-10-28', staples, products, ingredients: [], mappings })
    expect(result.weekStart).toBe('2026-10-26')
    expect(result.stapleUpdates[0]).toEqual({ staple_id: 'st-milk', last_added_on: '2026-10-26' })
  })

  it('leaves out staples that are not due, with no update', () => {
    const notDue = staple({ id: 'st-oil', product_id: 'rice', cadence_weeks: 4, last_added_on: '2026-10-19' })
    const result = planWeek({ runDate: RUN, staples: [notDue], products, ingredients: [], mappings })
    expect(result.lines).toEqual([])
    expect(result.stapleUpdates).toEqual([])
    expect(result.stapleDecisions).toEqual([{ staple_id: 'st-oil', included: false, reason: 'not_yet', packs: 0 }])
  })

  it('uses the normal due rules when a non-perishable staple is not on bonus', () => {
    const coffeeNoBonus = { ...products, coffee: { ...products.coffee, mechanism: null } }
    const result = planWeek({ runDate: RUN, staples: [staples[1]], products: coffeeNoBonus, ingredients: [], mappings })
    expect(result.lines).toEqual([{ productId: 9001, text: null, packs: 1, sources: ['staple'] }])
    expect(result.stapleUpdates).toEqual([{ staple_id: 'st-coffee', last_added_on: RUN }])
  })

  it('flags a staple whose product is missing and adds nothing for it', () => {
    const orphan = staple({ id: 'st-gone', product_id: 'discontinued' })
    const result = planWeek({ runDate: RUN, staples: [orphan], products, ingredients: [], mappings })
    expect(result.lines).toEqual([])
    expect(result.review).toEqual([{ reason: 'missing_product', staple_id: 'st-gone' }])
  })

  it('flags a mapped ingredient whose product is missing and adds it as free text', () => {
    const result = planWeek({
      runDate: RUN, staples: [], products,
      ingredients: [{ canonical_name: 'tofu', name: 'firm tofu', quantity: 200, unit: 'g' }],
      mappings: { tofu: { product_id: 'gone', pantry: false } },
    })
    expect(result.lines).toEqual([{ productId: null, text: 'firm tofu', packs: 1, sources: ['recipe'] }])
    expect(result.review).toEqual([{ reason: 'missing_product', ingredient: 'firm tofu' }])
  })

  it('falls back to the ingredient name when there is no canonical name', () => {
    const result = planWeek({
      runDate: RUN, staples: [], products,
      ingredients: [{ canonical_name: null, name: 'Rice', quantity: 100, unit: 'g' }],
      mappings,
    })
    expect(result.lines).toEqual([{ productId: 5000, text: null, packs: 1, sources: ['recipe'] }])
  })

  it('returns empty results for an empty week', () => {
    expect(planWeek({ runDate: RUN, staples: [], products, ingredients: [], mappings })).toEqual({
      weekStart: RUN, lines: [], stapleUpdates: [], stapleDecisions: [], review: [],
    })
  })

  it('throws on an invalid run date', () => {
    expect(() => planWeek({ runDate: 'monday', staples, products, ingredients, mappings })).toThrow()
  })
})
