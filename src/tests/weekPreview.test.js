import { describe, it, expect } from 'vitest'
import { recipeTextLines, stapleReasonText, buildWeekPreview } from '@/lib/weekPreview'

const MONDAY = '2026-11-16'

// household_staples rows as useStaples loads them (with the cached product joined).
const staple = (over) => ({
  id: 's', name: 'Staple', retailer: 'ah', product_external_id: null, search_term: null, product: null,
  quantity: 1, cadence_weeks: 1, perishable: true, max_weeks_stock: null,
  skip_next: false, active: true, last_added_on: null, covered_until: null,
  ...over,
})
const milk = staple({
  id: 's-milk', name: 'Milk', product_external_id: 101,
  product: { title: 'AH Halfvolle melk', sales_unit_size: '1 l', price: 1.19 },
  quantity: 2, last_added_on: '2026-11-09',
})
const rice = staple({
  id: 's-rice', name: 'Rice', product_external_id: 104,
  product: { title: 'AH Basmati rijst', sales_unit_size: '1 kg', price: 2.99 },
  cadence_weeks: 4, perishable: false, max_weeks_stock: 8, last_added_on: '2026-11-09',
})
const bananas = staple({ id: 's-ban', name: 'Bananas', search_term: 'bananen' })
const riceOnBonus = { 's-rice': { externalId: 104, title: 'AH Basmati rijst', salesUnitSize: '1 kg', price: 2.99, mechanism: '2e GRATIS' } }
const bananasFound = { 's-ban': { externalId: 103, title: 'AH Bananen tros', salesUnitSize: 'per tros', price: 1.69, mechanism: null } }

// mergeIngredients() items, cut down to what the preview reads.
const item = (key, name, computedQty, unit = null) => ({ key, name, computedQty, unit })

describe('recipeTextLines', () => {
  it('gives one free-text line per ingredient, with the amount to buy', () => {
    const items = [item('garlic|count:clove', 'Garlic', 3, 'clove'), item('olive oil|volume:metric', 'Olive oil', 90, 'mL')]
    expect(recipeTextLines(items, [])).toEqual([
      { text: 'Garlic', amount: '3 clove' },
      { text: 'Olive oil', amount: '90 mL' },
    ])
  })

  it('leaves out items ticked as already have', () => {
    const items = [item('a|count:', 'Onion', 2), item('b|count:', 'Carrot', 1)]
    expect(recipeTextLines(items, [{ key: 'a|count:', buy_qty: 0 }])).toEqual([{ text: 'Carrot', amount: '1' }])
  })

  it('uses an adjusted quantity, but never more than the recipes need', () => {
    const items = [item('a|mass:metric', 'Rice', 300, 'g'), item('b|mass:metric', 'Flour', 200, 'g')]
    const adjusted = [{ key: 'a|mass:metric', buy_qty: 100 }, { key: 'b|mass:metric', buy_qty: 500 }]
    expect(recipeTextLines(items, adjusted)).toEqual([
      { text: 'Rice', amount: '100 g' },
      { text: 'Flour', amount: '200 g' },
    ])
  })

  it('rounds amounts like the Shopping tab does', () => {
    expect(recipeTextLines([item('a|mass:metric', 'Butter', 33.3333, 'g')], [])).toEqual([{ text: 'Butter', amount: '33.33 g' }])
  })

  it('keeps an ingredient without a quantity, with no amount', () => {
    expect(recipeTextLines([item('salt|count:', 'Salt', null)], [])).toEqual([{ text: 'Salt', amount: null }])
  })

  it('makes one line when the same ingredient is listed in two kinds of unit', () => {
    const items = [item('olive oil|volume:metric', 'Olive oil', 30, 'mL'), item('olive oil|count:', 'olive oil ', 1)]
    expect(recipeTextLines(items, [])).toEqual([{ text: 'Olive oil', amount: '30 mL + 1' }])
  })

  it('gives nothing for an empty or missing list', () => {
    expect(recipeTextLines([], [])).toEqual([])
    expect(recipeTextLines()).toEqual([])
  })
})

describe('stapleReasonText', () => {
  it('has plain words for every planner reason', () => {
    const reasons = ['first_time', 'cadence', 'running_out', 'stock_up', 'not_yet', 'covered', 'skipped', 'inactive', 'missing_product']
    for (const reason of reasons) {
      expect(stapleReasonText(reason), reason).toMatch(/\S/)
      expect(stapleReasonText(reason), reason).not.toBe(reason)
    }
  })

  it('falls back to the reason itself when it is unknown', () => {
    expect(stapleReasonText('something_new')).toBe('something_new')
  })
})

describe('buildWeekPreview', () => {
  it('reports the Monday of the run week', () => {
    expect(buildWeekPreview({ runDate: '2026-11-19' }).weekStart).toBe(MONDAY)
  })

  it('throws on an invalid run date', () => {
    expect(() => buildWeekPreview({ runDate: 'next week' })).toThrow()
  })

  it('adds a due pinned staple from the cached product, without a live lookup', () => {
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [milk] })
    expect(preview.changes).toEqual([
      { action: 'add', productId: 101, text: null, title: 'AH Halfvolle melk', detail: '1 l', aisle: 'Dairy & eggs', mappedFrom: [], from: 0, to: 2, sources: ['staple'] },
    ])
    expect(preview.staples).toEqual([
      { staple_id: 's-milk', name: 'Milk', included: true, reason: 'cadence', reasonText: stapleReasonText('cadence'), packs: 2 },
    ])
    expect(preview.review).toEqual([])
  })

  it('stocks up a non-perishable staple that is on bonus this week', () => {
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [rice], liveProducts: riceOnBonus })
    expect(preview.changes).toHaveLength(1)
    expect(preview.changes[0]).toMatchObject({ action: 'add', productId: 104, to: 2, sources: ['stockup'], detail: '1 kg · 2e GRATIS' })
    expect(preview.staples[0]).toMatchObject({ included: true, reason: 'stock_up', packs: 2 })
  })

  it('leaves that staple out when it is not on bonus and not due', () => {
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [rice] })
    expect(preview.changes).toEqual([])
    expect(preview.staples[0]).toMatchObject({ included: false, reason: 'not_yet', packs: 0 })
  })

  it('uses the product found for a search-term staple', () => {
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [bananas], liveProducts: bananasFound })
    expect(preview.changes[0]).toMatchObject({ action: 'add', productId: 103, title: 'AH Bananen tros', detail: 'per tros', to: 1 })
    expect(preview.staples[0]).toMatchObject({ included: true, reason: 'first_time' })
  })

  it('flags a search-term staple with no product found', () => {
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [bananas] })
    expect(preview.changes).toEqual([])
    expect(preview.staples[0]).toMatchObject({ staple_id: 's-ban', included: false, reason: 'missing_product' })
    expect(preview.review).toEqual([{ reason: 'missing_product', staple_id: 's-ban', name: 'Bananas' }])
  })

  it('lists paused and skipped staples as not included, without flagging them', () => {
    const paused = { ...milk, id: 's-paused', active: false }
    const skipped = { ...milk, id: 's-skip', skip_next: true }
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [paused, skipped] })
    expect(preview.changes).toEqual([])
    expect(preview.staples.map(s => [s.staple_id, s.included, s.reason])).toEqual([
      ['s-paused', false, 'inactive'],
      ['s-skip', false, 'skipped'],
    ])
    expect(preview.review).toEqual([])
  })

  it('adds recipe ingredients as free-text lines by name, amount only shown', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive oil', 90, 'mL'), item('onion|count:', 'Onion', 2)],
      adjustedItems: [{ key: 'onion|count:', buy_qty: 0 }],
    })
    expect(preview.changes).toEqual([
      { action: 'add', productId: null, text: 'Olive oil', title: 'Olive oil', detail: '90 mL', aisle: 'Pantry', mappedFrom: [], from: 0, to: 1, sources: ['recipe'] },
    ])
  })

  it('puts staples first, then recipe ingredients, in the target lines', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY, staples: [milk],
      mergedItems: [item('garlic|count:clove', 'Garlic', 3, 'clove')],
    })
    expect(preview.lines).toEqual([
      { productId: 101, text: null, packs: 2, sources: ['staple'] },
      { productId: null, text: 'Garlic', packs: 1, sources: ['recipe'] },
    ])
  })

  it('compares with the current AH list: raise, untick, or leave alone', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      staples: [milk, { ...bananas, last_added_on: null }],
      liveProducts: bananasFound,
      mergedItems: [item('garlic|count:clove', 'Garlic', 3, 'clove'), item('olive oil|volume:metric', 'Olive oil', 90, 'mL')],
      currentList: [
        { productId: 101, text: 'AH Halfvolle melk', quantity: 1, ticked: false },   // fewer than needed
        { productId: 103, text: 'AH Bananen tros', quantity: 3, ticked: false },     // already enough
        { productId: null, text: 'olive  OIL', quantity: 1, ticked: true },          // ticked last week
        { productId: null, text: 'Kaarsen', quantity: 1, ticked: false },            // added by hand
      ],
    })
    expect(preview.changes.map(c => [c.action, c.title, c.from, c.to])).toEqual([
      ['increase', 'AH Halfvolle melk', 1, 2],
      ['add', 'Garlic', 0, 1],
      ['untick', 'Olive oil', 0, 1],
    ])
    expect(preview.onListAlready).toEqual([{ productId: 103, text: null, title: 'AH Bananen tros', detail: 'per tros', aisle: 'Produce', mappedFrom: [], quantity: 3 }])
  })

  it('gives no changes when the list already matches (safe to run again)', () => {
    const first = buildWeekPreview({ runDate: MONDAY, staples: [milk], mergedItems: [item('g|count:', 'Garlic', 3)] })
    const currentList = first.lines.map(l => ({ productId: l.productId, text: l.text ?? 'x', quantity: l.packs, ticked: false }))
    const again = buildWeekPreview({ runDate: MONDAY, staples: [milk], mergedItems: [item('g|count:', 'Garlic', 3)], currentList })
    expect(again.changes).toEqual([])
    expect(again.onListAlready).toHaveLength(2)
  })

  it('combines two staples pinned to the same product into one line', () => {
    const second = { ...milk, id: 's-milk-2', name: 'Milk for coffee', quantity: 1 }
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [milk, second] })
    expect(preview.changes).toHaveLength(1)
    expect(preview.changes[0]).toMatchObject({ productId: 101, to: 3, sources: ['staple', 'staple'] })
  })

  it('files a staple under the aisle of its own name, not of the Dutch product title', () => {
    const detergent = staple({
      id: 's-det', name: 'Ariel Color detergent', product_external_id: 201,
      product: { title: 'Ariel Vloeibaar color wasmiddel', sales_unit_size: '1,2 l', price: 9.99 },
    })
    const eggs = staple({
      id: 's-eggs', name: 'Large eggs', product_external_id: 105,
      product: { title: 'AH Scharreleieren L', sales_unit_size: '10 stuks', price: 3.49 },
    })
    const preview = buildWeekPreview({ runDate: MONDAY, staples: [detergent, eggs] })
    expect(preview.changes.map(c => [c.title, c.aisle])).toEqual([
      ['Ariel Vloeibaar color wasmiddel', 'Household'],
      ['AH Scharreleieren L', 'Dairy & eggs'],
    ])
  })

  it('files recipe ingredients under the same aisle as the Shopping tab', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('garlic powder|count:', 'Garlic powder', 1), item('spinach|mass:metric', 'Spinach', 200, 'g'), item('x|count:', 'Wonton wrappers', 1)],
    })
    expect(preview.changes.map(c => [c.title, c.aisle])).toEqual([
      ['Garlic powder', 'Herbs & spices'],
      ['Spinach', 'Produce'],
      ['Wonton wrappers', 'Other'],
    ])
  })

  it('uses the first staple name when two staples share a product', () => {
    const second = { ...milk, id: 's-milk-2', name: 'Something for coffee', quantity: 1 }
    expect(buildWeekPreview({ runDate: MONDAY, staples: [milk, second] }).changes[0].aisle).toBe('Dairy & eggs')
  })

  it('is empty for a household with nothing planned', () => {
    expect(buildWeekPreview({ runDate: MONDAY })).toEqual({
      weekStart: MONDAY, lines: [], changes: [], onListAlready: [], atHome: [], staples: [], review: [],
    })
  })
})

// Ingredient mappings (household_ingredient_mappings rows with the cached product joined):
// a household maps an ingredient once to an AH product, or marks it as always at home.
describe('buildWeekPreview with ingredient mappings', () => {
  const mapping = (ingredient_key, label, externalId, title, size) => ({
    ingredient_key, label, pantry: false, product_external_id: externalId,
    product: { title, sales_unit_size: size, price: 1 },
  })
  const atHome = (ingredient_key, label) => ({ ingredient_key, label, pantry: true, product_external_id: null, product: null })

  const oil = mapping('olive oil', 'Olive oil', 301, 'AH Olijfolie', '1 l')
  const riceMap = mapping('basmati rice', 'Basmati rice', 104, 'AH Basmati rijst', '1 kg')
  const garlicMap = mapping('garlic', 'Garlic', 302, 'AH Knoflook', 'per stuk')
  const milkMap = mapping('milk', 'Milk', 101, 'AH Halfvolle melk', '1 l')

  it('turns a mapped ingredient into its AH product, with whole packs', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive oil', 90, 'mL')],
      mappings: [oil],
    })
    expect(preview.changes).toEqual([
      { action: 'add', productId: 301, text: null, title: 'AH Olijfolie', detail: '1 l · for 90 mL', aisle: 'Pantry', mappedFrom: [{ key: 'olive oil', label: 'Olive oil' }], from: 0, to: 1, sources: ['recipe'] },
    ])
    expect(preview.review).toEqual([])
  })

  it('buys enough packs for what the recipes need', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('basmati rice|mass:metric', 'Basmati Rice', 1500, 'g')],
      mappings: [riceMap],
    })
    expect(preview.changes[0]).toMatchObject({ productId: 104, to: 2, detail: '1 kg · for 1500 g' })
  })

  it('uses the adjusted quantity from the Shopping tab', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('basmati rice|mass:metric', 'Basmati Rice', 1500, 'g')],
      adjustedItems: [{ key: 'basmati rice|mass:metric', buy_qty: 400 }],
      mappings: [riceMap],
    })
    expect(preview.changes[0]).toMatchObject({ productId: 104, to: 1, detail: '1 kg · for 400 g' })
  })

  it('finds the mapping whatever way the recipe spells the ingredient', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', '  Olive   Oils ', 90, 'mL')],
      mappings: [oil],
    })
    expect(preview.changes.map(c => c.productId)).toEqual([301])
  })

  it('leaves an ingredient marked as always at home off the list, and says so', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('salt|volume:us', 'Salt', 1, 'tsp'), item('onion|count:', 'Onion', 2)],
      mappings: [atHome('salt', 'Salt')],
    })
    expect(preview.changes.map(c => c.title)).toEqual(['Onion'])
    expect(preview.atHome).toEqual([{ key: 'salt', text: 'Salt', amount: '1 tsp' }])
  })

  it('keeps unmapped ingredients as free-text lines next to mapped ones', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive oil', 90, 'mL'), item('onion|count:', 'Onion', 2)],
      mappings: [oil],
    })
    expect(preview.lines).toEqual([
      { productId: 301, text: null, packs: 1, sources: ['recipe'] },
      { productId: null, text: 'Onion', packs: 1, sources: ['recipe'] },
    ])
  })

  it('adds one pack and asks for a check when the amount cannot be compared with the pack', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('garlic|count:clove', 'Garlic', 3, 'clove')],
      mappings: [garlicMap],
    })
    expect(preview.changes[0]).toMatchObject({ productId: 302, to: 1, detail: 'per stuk · for 3 clove' })
    expect(preview.review).toEqual([{ reason: 'check_quantity', name: 'Garlic', productId: 302 }])
  })

  it('asks for a check when one ingredient is listed in two kinds of unit', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive oil', 30, 'mL'), item('olive oil|count:', 'Olive oil', 1)],
      mappings: [oil],
    })
    expect(preview.changes).toHaveLength(1)
    expect(preview.changes[0]).toMatchObject({ productId: 301, to: 1, detail: '1 l · for 30 mL + 1' })
    expect(preview.review).toEqual([{ reason: 'check_quantity', name: 'Olive oil', productId: 301 }])
  })

  it('combines a mapped ingredient with a staple for the same product', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      staples: [milk],
      mergedItems: [item('milk|volume:metric', 'Milk', 500, 'mL')],
      mappings: [milkMap],
    })
    expect(preview.changes).toHaveLength(1)
    expect(preview.changes[0]).toMatchObject({ productId: 101, to: 3, sources: ['staple', 'recipe'], aisle: 'Dairy & eggs' })
  })

  it('ignores a mapped ingredient that is ticked as already have', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive oil', 90, 'mL'), item('salt|volume:us', 'Salt', 1, 'tsp')],
      adjustedItems: [{ key: 'olive oil|volume:metric', buy_qty: 0 }, { key: 'salt|volume:us', buy_qty: 0 }],
      mappings: [oil, atHome('salt', 'Salt')],
    })
    expect(preview.changes).toEqual([])
    expect(preview.atHome).toEqual([])
  })

  it('diffs mapped products against the AH list like any other product', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive oil', 90, 'mL')],
      mappings: [oil],
      currentList: [{ productId: 301, text: 'AH Olijfolie', quantity: 1, ticked: false }],
    })
    expect(preview.changes).toEqual([])
    expect(preview.onListAlready.map(l => l.productId)).toEqual([301])
  })

  it('behaves as before when the household has no mappings', () => {
    const args = { runDate: MONDAY, staples: [milk], mergedItems: [item('onion|count:', 'Onion', 2)] }
    expect(buildWeekPreview({ ...args, mappings: [] })).toEqual(buildWeekPreview(args))
  })
})

// Undoing a mapping from the preview: each line says which ingredient mappings put it there.
describe('buildWeekPreview: which mapping a line came from', () => {
  const mapping = (ingredient_key, label, externalId, title, size) => ({
    ingredient_key, label, pantry: false, product_external_id: externalId,
    product: { title, sales_unit_size: size, price: 1 },
  })
  const oil = mapping('olive oil', 'Olive oil', 301, 'AH Olijfolie', '1 l')
  const evoo = mapping('extra virgin olive oil', 'Extra Virgin Olive Oil', 301, 'AH Olijfolie', '1 l')
  const milkMap = mapping('milk', 'Milk', 101, 'AH Halfvolle melk', '1 l')

  it('names the ingredient behind a mapped line, as the recipe list shows it', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive Oils', 90, 'mL')],
      mappings: [oil],
    })
    expect(preview.changes[0].mappedFrom).toEqual([{ key: 'olive oil', label: 'Olive Oils' }])
  })

  it('names every ingredient when two are mapped to the same product', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [
        item('olive oil|volume:metric', 'Olive oil', 90, 'mL'),
        item('extra virgin olive oil|volume:metric', 'Extra Virgin Olive Oil', 30, 'mL'),
      ],
      mappings: [oil, evoo],
    })
    expect(preview.changes).toHaveLength(1)
    // 90 mL + 30 mL is one bottle, not one bottle per ingredient
    expect(preview.changes[0]).toMatchObject({ productId: 301, to: 1, detail: '1 l · for 90 mL + 30 mL' })
    expect(preview.changes[0].mappedFrom).toEqual([
      { key: 'olive oil', label: 'Olive oil' },
      { key: 'extra virgin olive oil', label: 'Extra Virgin Olive Oil' },
    ])
  })

  it('names the ingredient on a line that is also a staple', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      staples: [milk],
      mergedItems: [item('milk|volume:metric', 'Milk', 500, 'mL')],
      mappings: [milkMap],
    })
    expect(preview.changes[0].mappedFrom).toEqual([{ key: 'milk', label: 'Milk' }])
  })

  it('gives no mapping for staple lines and free-text lines', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      staples: [milk],
      mergedItems: [item('onion|count:', 'Onion', 2)],
      mappings: [oil],
    })
    expect(preview.changes.map(c => c.mappedFrom)).toEqual([[], []])
  })

  it('names the mapping on a line the AH list already covers', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('olive oil|volume:metric', 'Olive oil', 90, 'mL')],
      mappings: [oil],
      currentList: [{ productId: 301, text: 'AH Olijfolie', quantity: 1, ticked: false }],
    })
    expect(preview.onListAlready[0].mappedFrom).toEqual([{ key: 'olive oil', label: 'Olive oil' }])
  })

  it('gives each always-at-home ingredient its mapping key, once', () => {
    const preview = buildWeekPreview({
      runDate: MONDAY,
      mergedItems: [item('salt|volume:us', 'Salt', 1, 'tsp'), item('salt|count:', 'Salt', 1)],
      mappings: [{ ingredient_key: 'salt', label: 'Salt', pantry: true, product_external_id: null, product: null }],
    })
    expect(preview.atHome).toEqual([{ key: 'salt', text: 'Salt', amount: '1 tsp + 1' }])
  })
})
