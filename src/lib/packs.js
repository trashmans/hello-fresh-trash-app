// Turns recipe amounts and Albert Heijn pack sizes into comparable metric
// base units, and works out how many whole packs to buy.
//
// Base units: grams for mass, millilitres for volume, pieces for counts.
// Recipe units are converted with the same table the display code uses
// (toBaseUnit() in units.js), so "12 oz" means the same thing everywhere.
//
// AH pack sizes come from the API's salesUnitSize field as Dutch display
// text: "1,5 l", "400 g", "6 stuks", "2 x 125 g", "ca. 500 g", "per stuk".
// Loose produce sold by weight ("per kilo") has no fixed pack, so it
// returns null and the planner flags it for review instead of guessing.

import { toBaseUnit } from './units'

const PACK_UNITS = {
  g: { type: 'mass', factor: 1 },
  gr: { type: 'mass', factor: 1 },
  gram: { type: 'mass', factor: 1 },
  kg: { type: 'mass', factor: 1000 },
  kilo: { type: 'mass', factor: 1000 },
  ml: { type: 'volume', factor: 1 },
  cl: { type: 'volume', factor: 10 },
  dl: { type: 'volume', factor: 100 },
  l: { type: 'volume', factor: 1000 },
  liter: { type: 'volume', factor: 1000 },
  stuk: { type: 'count', factor: 1 },
  stuks: { type: 'count', factor: 1 },
  st: { type: 'count', factor: 1 },
}

// "per stuk", "per bos" (bunch), "per pakket" (packet) and similar are one item.
// "per kilo" / "per kg" are priced by weight and have no fixed pack.
const PER_WEIGHT = new Set(['kilo', 'kg', 'gram', 'g', '100 g', '100 gram'])

// Optional "N x " multipack prefix, then an amount with a dot or Dutch comma, then a unit.
const PACK_PATTERN = /^(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*([a-z]+)$/

function toNumber(text) {
  return Number(text.replace(',', '.'))
}

/**
 * Parses an AH pack size string into { value, type } in base units,
 * or null when it has no fixed size or cannot be read.
 */
export function parsePackSize(text) {
  if (!text) return null
  const cleaned = text.trim().toLowerCase().replace(/^ca\.?\s*/, '')

  if (cleaned.startsWith('per ')) {
    return PER_WEIGHT.has(cleaned.slice(4).trim()) ? null : { value: 1, type: 'count' }
  }

  const match = cleaned.match(PACK_PATTERN)
  if (!match) return null

  const [, multiplier, amount, unitText] = match
  const unit = PACK_UNITS[unitText]
  if (!unit) return null

  const value = (multiplier ? Number(multiplier) : 1) * toNumber(amount) * unit.factor
  return value > 0 ? { value, type: unit.type } : null
}

// Recipe "units" that just mean "this many of the thing".
const COUNT_WORDS = new Set(['', 'piece', 'pieces', 'pc', 'pcs', 'each', 'whole', 'unit', 'units', 'stuk', 'stuks'])

/**
 * Converts a recipe ingredient amount to { value, type } in base units.
 * Returns null for units with no pack equivalent (clove, pinch, sprig…)
 * and for a missing or non-positive quantity.
 */
export function ingredientToBase(quantity, unit) {
  if (quantity == null || !(quantity > 0)) return null

  const unitKey = (unit ?? '').trim().toLowerCase()
  if (COUNT_WORDS.has(unitKey)) return { value: quantity, type: 'count' }

  const base = toBaseUnit(quantity, unit)
  return base ? { value: base.value, type: base.type } : null
}

/**
 * How many whole packs cover the required amount. Accepts being up to
 * `tolerance` (default 5%) of a pack short rather than buying another one.
 * Returns 0 when nothing is needed, and null when the two amounts are not
 * the same kind of measurement or the pack size is unusable.
 */
export function packsNeeded(required, pack, { tolerance = 0.05 } = {}) {
  if (!required || !pack) return null
  if (required.type !== pack.type) return null
  if (!(pack.value > 0)) return null
  if (!(required.value > 0)) return 0

  const ratio = required.value / pack.value
  // The tiny epsilon stops floating-point noise (e.g. 1.0000000000000002) adding a pack.
  return Math.max(1, Math.ceil(ratio - tolerance - 1e-9))
}
