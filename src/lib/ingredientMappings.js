// A household's ingredient mappings (public.household_ingredient_mappings, rollout
// phase 4): what to buy at the retailer for a recipe ingredient — one product, or
// nothing because the household always has it at home. Pure helpers between the
// mapping screen and the table.

import { ingredientKey } from './ingredientMerge'

/** Matches the checks on household_ingredient_mappings. */
export const MAPPING_LIMITS = { name: 120 }

const clean = (text) => (typeof text === 'string' ? text : '').trim().replace(/\s+/g, ' ')

/**
 * Turns a choice on the mapping screen into a row to save.
 *   name     the ingredient as shown on the list ("Olive Oil")
 *   product  the picked search result ({ externalId, … }), or nothing
 *   pantry   true for "always have at home" (wins over a product)
 * Returns { ok: true, row } with ingredient_key (the shopping list's key for the
 * name), label, retailer, product_external_id and pantry — or { ok: false, message }.
 */
export function toMappingRow({ name, product, pantry } = {}) {
  const label = clean(name)
  const key = ingredientKey(label)
  if (!key) return { ok: false, message: 'This ingredient has no name to map.' }
  if (label.length > MAPPING_LIMITS.name) {
    return { ok: false, message: `This ingredient's name is too long to map (over ${MAPPING_LIMITS.name} characters).` }
  }

  const row = { ingredient_key: key, label, retailer: 'ah', product_external_id: null, pantry: false }
  if (pantry === true) return { ok: true, row: { ...row, pantry: true } }

  const externalId = Number(product?.externalId)
  if (!Number.isInteger(externalId) || externalId <= 0) {
    return { ok: false, message: 'Pick a product, or choose "Always have at home".' }
  }
  return { ok: true, row: { ...row, product_external_id: externalId } }
}

/** One line for the list of mappings; row is a loaded mapping with its cached product joined. */
export function describeMapping(row) {
  if (row?.pantry) return 'Always at home'
  if (!row?.product?.title) return `AH product ${row?.product_external_id}`
  return [row.product.title, row.product.sales_unit_size].filter(Boolean).join(' · ')
}
