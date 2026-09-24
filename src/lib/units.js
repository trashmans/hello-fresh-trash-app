// Converts ingredient quantities and step temperatures for display, based
// on the viewer's own saved preference (see AuthContext's unitPrefs) —
// never rewrites what's actually stored in the database.
//
// Ingredient quantity/unit are already structured fields (see
// parse-recipe), so converting them for display is a straightforward
// lookup + arithmetic problem, handled below by convertIngredientUnit().
//
// Temperatures are different: they only exist as plain text inside
// instruction steps, so parse-recipe wraps them in a {{temp:425F}} marker
// at parse time (see its TEMPERATURES prompt section), which
// formatTemperatureText() looks for and replaces at render time. Recipes
// parsed before this feature existed have no markers, so their step text
// just renders unchanged — the same fail-safe fallback used elsewhere in
// this app (no cover, no step photos, etc. all degrade the same way).

const TEMP_MARKER = /\{\{temp:(-?\d+(?:\.\d+)?)(F|C)\}\}/g

function convertTemperature(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return Math.round(value)
  if (fromUnit === 'F' && toUnit === 'C') return Math.round((value - 32) * (5 / 9))
  if (fromUnit === 'C' && toUnit === 'F') return Math.round(value * (9 / 5) + 32)
  return Math.round(value)
}

export function formatTemperatureText(stepText, preferredUnit) {
  if (!stepText) return stepText
  return stepText.replace(TEMP_MARKER, (match, rawValue, sourceUnit) => {
    const value = Number(rawValue)
    if (Number.isNaN(value)) return match
    return `${convertTemperature(value, sourceUnit, preferredUnit)}°${preferredUnit}`
  })
}

// --- Ingredient unit conversion ---
//
// Each entry maps one canonical unit to its measurement type, the system it
// belongs to, and its conversion factor to that type's base unit (mL for
// volume, g for mass). These use the same rounded values standard in
// cooking (1 cup = 240 mL, 1 pint = 2 cups, and so on), not lab-precise
// ones, since that's what matches other recipes and the tools people
// actually measure with.
const UNIT_INFO = {
  tsp:     { type: 'volume', system: 'us', toBase: 5 },
  tbsp:    { type: 'volume', system: 'us', toBase: 15 },
  'fl oz': { type: 'volume', system: 'us', toBase: 30 },
  cup:     { type: 'volume', system: 'us', toBase: 240 },
  pint:    { type: 'volume', system: 'us', toBase: 480 },
  quart:   { type: 'volume', system: 'us', toBase: 960 },
  gallon:  { type: 'volume', system: 'us', toBase: 3840 },
  ml:      { type: 'volume', system: 'metric', toBase: 1 },
  l:       { type: 'volume', system: 'metric', toBase: 1000 },
  oz:      { type: 'mass', system: 'us', toBase: 28.35 },
  lb:      { type: 'mass', system: 'us', toBase: 453.6 },
  g:       { type: 'mass', system: 'metric', toBase: 1 },
  kg:      { type: 'mass', system: 'metric', toBase: 1000 },
}

// Maps the many ways a unit shows up in real recipe text (plurals,
// abbreviations, capitalization) to one of the canonical keys above.
// Matching is case-insensitive; unrecognized strings simply pass through
// unconverted rather than erroring.
const UNIT_ALIASES = {
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  'fl oz': 'fl oz', 'fl. oz': 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  cup: 'cup', cups: 'cup',
  pint: 'pint', pints: 'pint', pt: 'pint',
  quart: 'quart', quarts: 'quart', qt: 'quart',
  gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
}

function resolveUnit(rawUnit) {
  if (!rawUnit) return null
  const key = rawUnit.trim().toLowerCase().replace(/\.$/, '')
  const canonical = UNIT_ALIASES[key]
  if (!canonical) return null
  const info = UNIT_INFO[canonical]
  return info ? { canonical, ...info } : null
}

// Rounds a converted quantity to a sensible number of decimal places —
// whole numbers once a value is reasonably large, one decimal place below
// that, so small quantities (like 2.3 tsp) don't collapse to "2".
function roundForDisplay(value) {
  if (value >= 10) return Math.round(value)
  return Math.round(value * 10) / 10
}

// Picks the best-fitting unit within a target system for a base-unit
// value, preferring the largest unit whose converted value is still >= 1
// (so results read naturally: "2 cups", not "0.5 quarts" or "480 tsp").
// Falls back to the smallest unit in that system if nothing fits (a very
// small quantity, e.g. under 1 tsp / 1 g, still needs some unit to show).
// Conventional display casing for units whose canonical key is lowercase
// but is normally written differently (mL, L) — the rest (tsp, cup, g, kg,
// ...) already match how they're written.
const DISPLAY_UNIT_LABEL = { ml: 'mL', l: 'L' }

function pickDisplayUnit(baseValue, type, system) {
  const candidates = Object.entries(UNIT_INFO).filter(
    ([, info]) => info.type === type && info.system === system
  )
  if (candidates.length === 0) return null

  const sorted = [...candidates].sort((a, b) => b[1].toBase - a[1].toBase)
  const fit = sorted.find(([, info]) => baseValue / info.toBase >= 1)
  const [unit, info] = fit ?? sorted[sorted.length - 1]
  return { unit, factor: info.toBase }
}

/**
 * Converts an ingredient's quantity/unit for display, given the viewer's
 * preferred system for that measurement type (prefs.volume_unit /
 * prefs.mass_unit, each 'us' or 'metric'). Returns { quantity, unit } —
 * unchanged from what was passed in if the unit isn't recognized, isn't a
 * convertible measurement type (e.g. "clove", "each"), or is already in
 * the viewer's preferred system.
 */
export function convertIngredientUnit(quantity, rawUnit, prefs) {
  const resolved = resolveUnit(rawUnit)
  if (!resolved || quantity == null) return { quantity, unit: rawUnit }

  const preferredSystem = resolved.type === 'volume' ? prefs?.volume_unit : prefs?.mass_unit
  if (!preferredSystem || resolved.system === preferredSystem) {
    return { quantity, unit: rawUnit }
  }

  const baseValue = quantity * resolved.toBase
  const display = pickDisplayUnit(baseValue, resolved.type, preferredSystem)
  if (!display) return { quantity, unit: rawUnit }

  return {
    quantity: roundForDisplay(baseValue / display.factor),
    unit: DISPLAY_UNIT_LABEL[display.unit] ?? display.unit,
  }
}
