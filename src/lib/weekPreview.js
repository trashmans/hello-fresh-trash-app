// This week's preview (rollout phase 5, docs/adr/0005): what the weekly run would
// change on the household's AH list. A dry run: nothing here writes to AH or saves
// anything, it only combines the planner (planWeek.js) and the list diff (listDiff.js)
// into something a screen can show.
//
// Recipe ingredients come from the Shopping tab's merged list, without items ticked
// as "Already have". What happens to each depends on the household's ingredient
// mappings (household_ingredient_mappings, keyed by ingredientKey()):
//   - mapped to an AH product → a product line, in whole packs worked out from the
//     amount and the pack size by the planner (one pack plus a "check quantity"
//     flag when the two can't be compared)
//   - marked as always at home → left off the list, reported in atHome
//   - not mapped → a free-text line by ingredient name. The amount is shown in the
//     preview but is not part of the line's text, so changing servings never
//     creates a second line.
//
// Every line gets an aisle (aisles.js) so the screen can group it like the Shopping
// tab: recipe lines by ingredient name, staple lines by the staple's own name (the
// product title is Dutch, the rules are English).

import { planWeek } from './planWeek'
import { diffList } from './listDiff'
import { aisleFor } from './aisles'
import { ingredientKey } from './ingredientMerge'

const REASON_TEXT = {
  first_time: 'First order',
  cadence: 'Due this week',
  running_out: 'Stock runs out this week',
  stock_up: 'On bonus: stocking up',
  not_yet: 'Not due yet',
  covered: 'Still in stock',
  skipped: 'Skipped this week',
  inactive: 'Paused',
  missing_product: 'No AH product found',
}

/** Plain words for a planner reason (staples.js, stockup.js, planWeek.js). */
export function stapleReasonText(reason) {
  return REASON_TEXT[reason] ?? reason
}

const clean = (text) => (text ?? '').trim().replace(/\s+/g, ' ')
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const formatQty = (qty) => parseFloat(qty.toFixed(2)) // same rounding as the Shopping tab
const lineKey = (productId, text) => (productId != null ? `p:${productId}` : `t:${clean(text).toLowerCase()}`)

// The Shopping tab's merged list as things to buy: items ticked as "Already have"
// are left out and an adjusted quantity counts, capped at what the recipes need
// (the same rule as the Shopping tab). key is the ingredient's mapping key.
function buyItems(mergedItems, adjustedItems) {
  const adjusted = new Map((adjustedItems ?? []).map(a => [a.key, a.buy_qty]))
  const items = []

  for (const item of mergedItems ?? []) {
    const text = clean(item?.name)
    if (!text) continue

    let qty = item.computedQty ?? null
    if (adjusted.has(item.key)) {
      const stored = adjusted.get(item.key)
      if (isNumber(stored)) qty = qty !== null && stored > qty ? qty : stored
    }
    if (qty === 0) continue

    items.push({
      key: ingredientKey(text),
      text,
      qty: isNumber(qty) ? qty : null,
      unit: item.unit ?? null,
      amount: isNumber(qty) ? `${formatQty(qty)}${item.unit ? ` ${item.unit}` : ''}` : null,
    })
  }

  return items
}

// One { text, amount } per ingredient, in first-seen order.
function toTextLines(items) {
  const lines = new Map()
  for (const { key, text, amount } of items) {
    if (!lines.has(key)) lines.set(key, { text, amounts: [] })
    if (amount) lines.get(key).amounts.push(amount)
  }
  return [...lines.values()].map(({ text, amounts }) => ({
    text,
    amount: amounts.length ? amounts.join(' + ') : null,
  }))
}

/**
 * The Shopping tab's merged list as free-text lines.
 * mergedItems:   mergeIngredients() output ({ key, name, computedQty, unit })
 * adjustedItems: [{ key, buy_qty }] — 0 means ticked as already have
 * Returns [{ text, amount }] in the order given; amount is for display only
 * ('90 mL', or '30 mL + 1' when one ingredient is listed in two kinds of unit).
 */
export function recipeTextLines(mergedItems = [], adjustedItems = []) {
  return toTextLines(buyItems(mergedItems, adjustedItems))
}

/**
 * Builds the preview for the week containing runDate ('YYYY-MM-DD').
 *
 * staples       household_staples rows with the cached product joined
 *               (product: { title, sales_unit_size, price } | null), as useStaples loads them
 * liveProducts  { [staple id]: { externalId, title, salesUnitSize, price, mechanism } } —
 *               this week's AH answer for staples that need one (stock-up on bonus,
 *               search-term staples). Staples without an entry use their cached product.
 * mergedItems, adjustedItems   the Shopping tab's list (see recipeTextLines)
 * mappings      household_ingredient_mappings rows with the cached product joined:
 *               [{ ingredient_key, label, pantry, product_external_id, product: { title, sales_unit_size } | null }]
 * currentList   the AH list now: [{ productId | null, text, quantity, ticked }]
 *
 * Returns {
 *   weekStart      Monday of the week
 *   lines          target lines [{ productId | null, text | null, packs, sources }]
 *   changes        [{ action: 'add' | 'increase' | 'untick', productId, text, title, detail, aisle, mappedFrom, from, to, sources }]
 *                  mappedFrom: the ingredient mappings behind a product line [{ key, label }], [] for other lines
 *   onListAlready  target lines the AH list already covers [{ productId, text, title, detail, aisle, mappedFrom, quantity }]
 *   atHome         ingredients left off because the household always has them [{ key, text, amount }] (key: the mapping's)
 *   staples        [{ staple_id, name, included, reason, reasonText, packs }] in the order given
 *   review         things a person should look at: [{ reason: 'missing_product', staple_id, name }] for a
 *                  staple without a product, [{ reason: 'check_quantity', name, productId }] for a mapped
 *                  ingredient whose amount can't be compared with the pack (one pack was added)
 * }
 * Throws if runDate is not a valid date.
 */
export function buildWeekPreview({
  runDate,
  staples = [],
  liveProducts = {},
  mergedItems = [],
  adjustedItems = [],
  mappings = [],
  currentList = [],
} = {}) {
  // Staples → planner rows. Each staple is its own "product id" so a live answer
  // and the cached product can be looked up the same way.
  const products = {}
  const shown = new Map() // line key → { title, detail, aisle }
  const names = new Map()
  const plannerStaples = []

  for (const staple of staples ?? []) {
    names.set(staple.id, staple.name)
    plannerStaples.push({ ...staple, product_id: staple.id })

    const live = liveProducts?.[staple.id]
    let product = null
    if (live?.externalId != null) {
      product = { externalId: live.externalId, title: live.title, salesUnitSize: live.salesUnitSize ?? null, mechanism: live.mechanism ?? null }
    } else if (staple.product_external_id != null) {
      product = { externalId: staple.product_external_id, title: staple.product?.title, salesUnitSize: staple.product?.sales_unit_size ?? null, mechanism: null }
    }
    if (!product) continue

    products[staple.id] = product
    const key = lineKey(product.externalId)
    if (!shown.has(key) || product.mechanism) {
      shown.set(key, {
        title: product.title || staple.name,
        detail: [product.salesUnitSize, product.mechanism].filter(Boolean).join(' · ') || null,
        aisle: shown.get(key)?.aisle ?? aisleFor(staple.name), // first staple with this product decides
      })
    }
  }

  // Recipe ingredients: mapped to a product, always at home, or free text.
  // Ingredients mapped to the same product share one planner product, so their
  // amounts are added before packs are worked out.
  const mappingByKey = new Map((mappings ?? []).map(m => [m.ingredient_key, m]))
  const unmapped = []
  const atHomeItems = []
  const mappedProducts = new Map() // line key → { mapping, text, amounts, from: [{ key, label }] }
  const plannerIngredients = []
  const plannerMappings = {}

  for (const item of buyItems(mergedItems, adjustedItems)) {
    const mapping = mappingByKey.get(item.key)
    if (mapping?.pantry) { atHomeItems.push(item); continue }
    if (mapping?.product_external_id == null) { unmapped.push(item); continue }

    const productId = `m:${mapping.product_external_id}`
    const key = lineKey(mapping.product_external_id)
    if (!mappedProducts.has(key)) {
      mappedProducts.set(key, { mapping, text: item.text, amounts: [], from: [] })
      products[productId] = {
        externalId: mapping.product_external_id,
        salesUnitSize: mapping.product?.sales_unit_size ?? null,
        mechanism: null,
      }
    }
    const entry = mappedProducts.get(key)
    if (!entry.from.some(f => f.key === item.key)) entry.from.push({ key: item.key, label: item.text })
    if (item.amount) entry.amounts.push(item.amount)
    plannerMappings[item.key] = { product_id: productId, pantry: false }
    plannerIngredients.push({ canonical_name: item.key, name: item.text, quantity: item.qty, unit: item.unit })
  }

  for (const [key, { mapping, text, amounts }] of mappedProducts) {
    if (shown.has(key)) continue // also a staple: the staple's title and aisle stand
    shown.set(key, {
      title: mapping.product?.title || mapping.label || text,
      detail: [mapping.product?.sales_unit_size, amounts.length ? `for ${amounts.join(' + ')}` : null].filter(Boolean).join(' · ') || null,
      aisle: aisleFor(text),
    })
  }
  const mappedFrom = (key) => mappedProducts.get(key)?.from ?? []

  // Always-at-home ingredients, one entry per mapping.
  const atHome = new Map()
  for (const { key, text, amount } of atHomeItems) {
    if (!atHome.has(key)) atHome.set(key, { key, text, amounts: [] })
    if (amount) atHome.get(key).amounts.push(amount)
  }

  const plan = planWeek({ runDate, staples: plannerStaples, products, ingredients: plannerIngredients, mappings: plannerMappings })

  const recipeLines = toTextLines(unmapped)
  for (const { text, amount } of recipeLines) shown.set(lineKey(null, text), { title: text, detail: amount, aisle: aisleFor(text) })

  const lines = [
    ...plan.lines,
    ...recipeLines.map(({ text }) => ({ productId: null, text, packs: 1, sources: ['recipe'] })),
  ]
  const lineByKey = new Map(lines.map(line => [lineKey(line.productId, line.text), line]))
  const describe = (key) => shown.get(key) ?? { title: lineByKey.get(key)?.text ?? 'Unknown product', detail: null, aisle: 'Other' }

  const changes = diffList(lines, currentList ?? []).map(change => {
    const key = lineKey(change.productId, change.text)
    return {
      action: change.action,
      productId: change.productId,
      text: change.text,
      ...describe(key),
      mappedFrom: mappedFrom(key),
      from: change.from,
      to: change.to,
      sources: lineByKey.get(key)?.sources ?? [],
    }
  })

  const changed = new Set(changes.map(c => lineKey(c.productId, c.text)))
  const onList = new Map((currentList ?? []).map(i => [lineKey(i.productId, i.text), i]))
  const onListAlready = lines
    .filter(line => !changed.has(lineKey(line.productId, line.text)))
    .map(line => {
      const key = lineKey(line.productId, line.text)
      return { productId: line.productId, text: line.text, ...describe(key), mappedFrom: mappedFrom(key), quantity: onList.get(key)?.quantity ?? line.packs }
    })

  return {
    weekStart: plan.weekStart,
    lines,
    changes,
    onListAlready,
    atHome: [...atHome.values()].map(({ key, text, amounts }) => ({ key, text, amount: amounts.length ? amounts.join(' + ') : null })),
    staples: plan.stapleDecisions.map(d => ({
      staple_id: d.staple_id,
      name: names.get(d.staple_id) ?? '',
      included: d.included,
      reason: d.reason,
      reasonText: stapleReasonText(d.reason),
      packs: d.packs,
    })),
    review: plan.review.map(r => (r.staple_id != null
      ? { reason: r.reason, staple_id: r.staple_id, name: names.get(r.staple_id) ?? '' }
      : { reason: r.reason, name: r.ingredient, productId: r.productId })),
  }
}
