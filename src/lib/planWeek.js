// Builds one household's target list for a week by chaining the planner pieces:
//
//   staples      → planStockUp() (non-perishables on bonus), otherwise checkStaple() (due rules)
//   ingredients  → grouped by canonical_name, mapped to products, summed in base units,
//                  rounded to whole packs (packs.js); unmapped ones become free-text lines
//   everything   → mergeTargetLines() so a product from a staple and a recipe is one line
//
// Pure: no database, no retailer calls. The runner loads the inputs, calls this,
// diffs the result against the retailer list (listDiff.js), applies the changes,
// then saves stapleUpdates.
//
// Inputs
//   runDate      any 'YYYY-MM-DD' in the run week
//   staples      staple rows (see staples.js) with product_id
//   products     { [product_id]: { externalId, salesUnitSize, mechanism } }
//   ingredients  recipe ingredients already scaled to the chosen servings:
//                [{ canonical_name, name, quantity, unit }]
//   mappings     { [canonical name, lowercase]: { product_id, pantry } }
//
// Output
//   weekStart        Monday of the run week
//   lines            merged target lines for diffList()
//   stapleUpdates    fields to save back per staple
//   stapleDecisions  why each staple was or was not included (for the review screen)
//   review           things a person should check: unmatched, check_quantity, missing_product

import { weekStartOf, checkStaple } from './staples'
import { planStockUp } from './stockup'
import { parsePackSize, ingredientToBase, packsNeeded } from './packs'
import { mergeTargetLines } from './listDiff'

const normalise = (text) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function planStaples(staples, products, weekStart) {
  const lines = []
  const updates = []
  const decisions = []
  const review = []

  for (const staple of staples) {
    const decide = (included, reason, packs = 0) =>
      decisions.push({ staple_id: staple.id, included, reason, packs })

    const product = products[staple.product_id]
    if (!product) {
      if (staple.active === false) {
        decide(false, 'inactive')
      } else {
        decide(false, 'missing_product')
        review.push({ reason: 'missing_product', staple_id: staple.id })
      }
      continue
    }

    const stock = planStockUp(staple, { mechanism: product.mechanism, runDate: weekStart })
    if (stock.reason === 'stock_up') {
      lines.push({ productId: product.externalId, packs: stock.packs, source: 'stockup' })
      updates.push({ staple_id: staple.id, last_added_on: weekStart, covered_until: stock.covered_until })
      decide(true, 'stock_up', stock.packs)
      continue
    }

    const { due, reason } = checkStaple(staple, weekStart)
    if (due) {
      const packs = Math.max(1, staple.quantity ?? 1)
      lines.push({ productId: product.externalId, packs, source: 'staple' })
      updates.push({ staple_id: staple.id, last_added_on: weekStart })
      decide(true, reason, packs)
    } else {
      if (reason === 'skipped') updates.push({ staple_id: staple.id, skip_next: false })
      decide(false, reason)
    }
  }

  return { lines, updates, decisions, review }
}

function planIngredients(ingredients, products, mappings) {
  // One entry per mapped product or per unmapped ingredient name, in first-seen order.
  const entries = new Map()

  for (const ingredient of ingredients) {
    const key = normalise(ingredient.canonical_name || ingredient.name)
    if (!key) continue
    const label = ingredient.name || ingredient.canonical_name

    const mapping = mappings[key]
    if (mapping?.pantry) continue

    const product = mapping?.product_id ? products[mapping.product_id] : null
    if (!product) {
      const entryKey = `t:${key}`
      if (!entries.has(entryKey)) {
        entries.set(entryKey, { kind: 'text', label, reason: mapping?.product_id ? 'missing_product' : 'unmatched' })
      }
      continue
    }

    const entryKey = `p:${mapping.product_id}`
    if (!entries.has(entryKey)) {
      entries.set(entryKey, { kind: 'product', label, product, total: null, comparable: true })
    }
    const entry = entries.get(entryKey)
    const amount = ingredientToBase(ingredient.quantity, ingredient.unit)
    if (!entry.comparable) continue
    if (!amount || (entry.total && entry.total.type !== amount.type)) {
      entry.comparable = false
    } else {
      entry.total = entry.total
        ? { value: entry.total.value + amount.value, type: amount.type }
        : { ...amount }
    }
  }

  const lines = []
  const review = []
  for (const entry of entries.values()) {
    if (entry.kind === 'text') {
      lines.push({ text: entry.label, packs: 1, source: 'recipe' })
      review.push({ reason: entry.reason, ingredient: entry.label })
      continue
    }

    const pack = parsePackSize(entry.product.salesUnitSize)
    const packs = entry.comparable && entry.total ? packsNeeded(entry.total, pack) : null
    if (packs == null) {
      lines.push({ productId: entry.product.externalId, packs: 1, source: 'recipe' })
      review.push({ reason: 'check_quantity', ingredient: entry.label, productId: entry.product.externalId })
    } else if (packs > 0) {
      lines.push({ productId: entry.product.externalId, packs, source: 'recipe' })
    }
  }

  return { lines, review }
}

/** Plans one household's week. Throws if runDate is not a valid 'YYYY-MM-DD' date. */
export function planWeek({ runDate, staples = [], products = {}, ingredients = [], mappings = {} }) {
  const weekStart = weekStartOf(runDate)
  if (weekStart == null) throw new Error(`Invalid run date: ${runDate}`)

  const fromStaples = planStaples(staples, products, weekStart)
  const fromRecipes = planIngredients(ingredients, products, mappings)

  return {
    weekStart,
    lines: mergeTargetLines([...fromStaples.lines, ...fromRecipes.lines]),
    stapleUpdates: fromStaples.updates,
    stapleDecisions: fromStaples.decisions,
    review: [...fromStaples.review, ...fromRecipes.review],
  }
}
