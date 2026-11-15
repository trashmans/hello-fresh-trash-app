// This week's preview (rollout phase 5, docs/adr/0005): what the weekly run would
// change on the household's AH list. A dry run: nothing here writes to AH or saves
// anything, it only combines the planner (planWeek.js) and the list diff (listDiff.js)
// into something a screen can show.
//
// Until ingredient mapping exists, recipe ingredients go on the list as free-text
// lines taken from the Shopping tab's merged list: one line per ingredient name,
// without items ticked as "Already have". The amount is shown in the preview but is
// not part of the line's text, so changing servings never creates a second line.

import { planWeek } from './planWeek'
import { diffList } from './listDiff'

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

/**
 * The Shopping tab's merged list as free-text lines.
 * mergedItems:   mergeIngredients() output ({ key, name, computedQty, unit })
 * adjustedItems: [{ key, buy_qty }] — 0 means ticked as already have
 * Returns [{ text, amount }] in the order given; amount is for display only
 * ('90 mL', or '30 mL + 1' when one ingredient is listed in two kinds of unit).
 */
export function recipeTextLines(mergedItems = [], adjustedItems = []) {
  const adjusted = new Map((adjustedItems ?? []).map(a => [a.key, a.buy_qty]))
  const lines = new Map()

  for (const item of mergedItems ?? []) {
    const text = clean(item?.name)
    if (!text) continue

    // Same rule as the Shopping tab: an adjusted quantity counts, capped at what the recipes need.
    let qty = item.computedQty ?? null
    if (adjusted.has(item.key)) {
      const stored = adjusted.get(item.key)
      if (isNumber(stored)) qty = qty !== null && stored > qty ? qty : stored
    }
    if (qty === 0) continue

    const key = text.toLowerCase()
    if (!lines.has(key)) lines.set(key, { text, amounts: [] })
    if (isNumber(qty)) lines.get(key).amounts.push(`${formatQty(qty)}${item.unit ? ` ${item.unit}` : ''}`)
  }

  return [...lines.values()].map(({ text, amounts }) => ({
    text,
    amount: amounts.length ? amounts.join(' + ') : null,
  }))
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
 * currentList   the AH list now: [{ productId | null, text, quantity, ticked }]
 *
 * Returns {
 *   weekStart      Monday of the week
 *   lines          target lines [{ productId | null, text | null, packs, sources }]
 *   changes        [{ action: 'add' | 'increase' | 'untick', productId, text, title, detail, from, to, sources }]
 *   onListAlready  target lines the AH list already covers [{ productId, text, title, detail, quantity }]
 *   staples        [{ staple_id, name, included, reason, reasonText, packs }] in the order given
 *   review         staples a person should look at [{ reason, staple_id, name }]
 * }
 * Throws if runDate is not a valid date.
 */
export function buildWeekPreview({
  runDate,
  staples = [],
  liveProducts = {},
  mergedItems = [],
  adjustedItems = [],
  currentList = [],
} = {}) {
  // Staples → planner rows. Each staple is its own "product id" so a live answer
  // and the cached product can be looked up the same way.
  const products = {}
  const shown = new Map() // line key → { title, detail }
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
      })
    }
  }

  const plan = planWeek({ runDate, staples: plannerStaples, products })

  const recipeLines = recipeTextLines(mergedItems, adjustedItems)
  for (const { text, amount } of recipeLines) shown.set(lineKey(null, text), { title: text, detail: amount })

  const lines = [
    ...plan.lines,
    ...recipeLines.map(({ text }) => ({ productId: null, text, packs: 1, sources: ['recipe'] })),
  ]
  const lineByKey = new Map(lines.map(line => [lineKey(line.productId, line.text), line]))
  const describe = (key) => shown.get(key) ?? { title: lineByKey.get(key)?.text ?? 'Unknown product', detail: null }

  const changes = diffList(lines, currentList ?? []).map(change => {
    const key = lineKey(change.productId, change.text)
    return {
      action: change.action,
      productId: change.productId,
      text: change.text,
      ...describe(key),
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
      return { productId: line.productId, text: line.text, ...describe(key), quantity: onList.get(key)?.quantity ?? line.packs }
    })

  return {
    weekStart: plan.weekStart,
    lines,
    changes,
    onListAlready,
    staples: plan.stapleDecisions.map(d => ({
      staple_id: d.staple_id,
      name: names.get(d.staple_id) ?? '',
      included: d.included,
      reason: d.reason,
      reasonText: stapleReasonText(d.reason),
      packs: d.packs,
    })),
    review: plan.review.map(r => ({ reason: r.reason, staple_id: r.staple_id, name: names.get(r.staple_id) ?? '' })),
  }
}
