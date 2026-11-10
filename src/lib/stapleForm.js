// The Staples screen's form rules: turns what the user typed into a
// household_staples row, or explains per field what to fix. The limits match
// the database checks in supabase/migrations/20261110000001_staples.sql.
//
// "Stock up on bonus" is the user-facing switch for perishable = false: such a
// staple is bought in bulk when on bonus (src/lib/stockup.js) and so needs a
// weeks limit. Switched off, the staple is perishable and any limit is dropped
// (the database refuses a perishable staple with one). Pure: no I/O.

export const STAPLE_LIMITS = { nameMax: 80, searchMin: 2, searchMax: 60, quantity: [1, 20], cadenceWeeks: [1, 12], maxWeeksStock: [1, 26] }

const tidy = (text) => (typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '')

// A whole number in [min, max] (typed numbers arrive as text), else null.
function wholeNumber(value, [min, max]) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

export function toStapleRow(input) {
  const errors = {}

  const name = tidy(input.name)
  if (!name) errors.name = 'Give the staple a name.'
  else if (name.length > STAPLE_LIMITS.nameMax) errors.name = `Keep the name under ${STAPLE_LIMITS.nameMax + 1} characters.`

  const productId = Number.isInteger(input.productExternalId) && input.productExternalId > 0 ? input.productExternalId : null
  const searchTerm = tidy(input.searchTerm) || null
  if (searchTerm && (searchTerm.length < STAPLE_LIMITS.searchMin || searchTerm.length > STAPLE_LIMITS.searchMax)) {
    errors.searchTerm = `The search term needs ${STAPLE_LIMITS.searchMin}–${STAPLE_LIMITS.searchMax} characters.`
  } else if (!productId && !searchTerm) {
    errors.searchTerm = 'Pick an AH product, or give a search term the app can use each week.'
  }

  const [qMin, qMax] = STAPLE_LIMITS.quantity
  const quantity = wholeNumber(input.quantity, STAPLE_LIMITS.quantity)
  if (quantity === null) errors.quantity = `Quantity is a whole number from ${qMin} to ${qMax}.`

  const [cMin, cMax] = STAPLE_LIMITS.cadenceWeeks
  const cadence = wholeNumber(input.cadenceWeeks, STAPLE_LIMITS.cadenceWeeks)
  if (cadence === null) errors.cadenceWeeks = `Choose every ${cMin} to ${cMax} weeks.`

  const stockUp = input.stockUp === true
  let maxWeeks = null
  if (stockUp) {
    const [mMin, mMax] = STAPLE_LIMITS.maxWeeksStock
    maxWeeks = wholeNumber(input.maxWeeksStock, STAPLE_LIMITS.maxWeeksStock)
    if (maxWeeks === null) errors.maxWeeksStock = `Stock up to a whole number of weeks, ${mMin} to ${mMax}.`
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    row: {
      name,
      product_external_id: productId,
      search_term: searchTerm,
      quantity,
      cadence_weeks: cadence,
      perishable: !stockUp,
      max_weeks_stock: stockUp ? maxWeeks : null,
    },
  }
}

// One line for the staples list, e.g. "Skipping next order · 2 every 3 weeks".
export function describeStaple(staple) {
  const how = `${staple.quantity} every ${staple.cadence_weeks === 1 ? 'week' : `${staple.cadence_weeks} weeks`}`
  const parts = [how]
  if (!staple.perishable && staple.max_weeks_stock) parts.push(`stocks up on bonus (up to ${staple.max_weeks_stock} weeks)`)
  if (staple.active === false) parts.unshift('Paused')
  else if (staple.skip_next) parts.unshift('Skipping next order')
  return parts.join(' · ')
}
