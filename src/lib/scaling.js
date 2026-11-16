// Computes scale factors for a recipe — either from a target servings
// count (the same ratio math src/lib/ingredientMerge.js already uses for
// the shopping list) or from a target amount of a single ingredient — and
// applies a scale factor to an ingredient list, and to the amounts written
// inside the instruction steps, for display.
//
// Never touches what's stored in the database: scaling is purely a
// display-time transform, same principle as src/lib/units.js.

import { toBaseUnit, roundForDisplay, normalizeUnit as readMeasurement, bestUnitInSystem } from './units'

function normalizeUnit(unit) {
  return (unit ?? '').trim().toLowerCase()
}

/**
 * Scale factor implied by wanting `targetServings` instead of the
 * recipe's own stated `baseServings`. Mirrors the ratio used in
 * ingredientMerge.js so a recipe scaled this way in the preview panel
 * matches what the shopping list would compute for the same servings.
 */
export function computeScaleFactorFromServings(targetServings, baseServings) {
  if (!baseServings || baseServings <= 0) return null
  if (targetServings == null || targetServings <= 0) return null
  return targetServings / baseServings
}

/**
 * Scale factor implied by wanting `targetQuantity targetUnit` of a
 * specific ingredient, relative to that ingredient's amount as written in
 * the recipe. The two amounts can be compared either because they share
 * the exact same unit text (works for anything, including unconvertible
 * units like "clove" or "each"), or because both resolve to the same
 * measurement type — volume or mass — via src/lib/units.js's conversion
 * table (e.g. recipe says "2 lb", target is "1 kg"). Returns null when
 * neither applies, or when the ingredient/target amount is missing or
 * not a usable positive number.
 */
export function computeScaleFactorFromIngredient(ingredient, targetQuantity, targetUnit) {
  if (ingredient?.quantity == null || ingredient.quantity <= 0) return null
  if (targetQuantity == null || targetQuantity <= 0) return null

  if (normalizeUnit(ingredient.unit) === normalizeUnit(targetUnit)) {
    return targetQuantity / ingredient.quantity
  }

  const base = toBaseUnit(ingredient.quantity, ingredient.unit)
  const target = toBaseUnit(targetQuantity, targetUnit)
  if (!base || !target || base.type !== target.type) return null

  return target.value / base.value
}

/**
 * Scales a list of ingredients (as returned by useRecipeIngredients) by a
 * plain multiplicative factor. Returns new ingredient objects with
 * `quantity` replaced by the scaled value, rounded the same way unit
 * conversion is (see roundForDisplay in units.js) so scaled amounts read
 * naturally; ingredients with no quantity (e.g. "salt to taste") pass
 * through unchanged, since there's nothing to scale.
 */
export function scaleIngredients(ingredients, scaleFactor) {
  if (!scaleFactor || scaleFactor === 1) return ingredients
  return ingredients.map(ing => ({
    ...ing,
    quantity: ing.quantity != null ? roundForDisplay(ing.quantity * scaleFactor) : null,
  }))
}

// --- Amounts inside the instruction steps ---
//
// Recipe cards give home-supplied ingredients (water, butter, oil, salt) only
// in the step text ("Combine 4 cups of water…"), not in the ingredient list,
// so scaling the list alone leaves them at the original amount. scaleStepText()
// finds "number + measurement" in a step and scales it; it also shows the
// amount in the viewer's unit preference, the same way the ingredient list does.
//
// Only volume and weight units are read. Times ("4–5 minutes"), sizes
// ("½-inch"), counts ("2 cloves", "3 large eggs") and temperature markers
// ({{temp:425F}}) are left alone, and so is a unit letter inside a longer word
// ("1 lime").

const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }
const FRACTION_CHARS = Object.keys(FRACTIONS).join('')

// "1 1/2", "1/2", "1½" or "1 ½", "½", "1.5", "4" — longest forms first.
const NUMBER = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?\\s?[${FRACTION_CHARS}]|[${FRACTION_CHARS}]|\\d+(?:\\.\\d+)?)`

// Unit words as they appear in step text, longest first so "tablespoons" is not read as "tbs".
const STEP_UNITS = [
  'fluid ounces', 'fluid ounce', 'fl\\.? oz',
  'tablespoons', 'tablespoon', 'teaspoons', 'teaspoon', 'tbsps', 'tbsp', 'tbs', 'tsps', 'tsp',
  'cups', 'cup', 'pints', 'pint', 'quarts', 'quart', 'gallons', 'gallon',
  'milliliters', 'milliliter', 'millilitres', 'millilitre', 'liters', 'liter', 'litres', 'litre', 'ml', 'l',
  'ounces', 'ounce', 'oz', 'pounds', 'pound', 'lbs', 'lb',
  'kilograms', 'kilogram', 'grams', 'gram', 'kg', 'g',
]

// number, optionally a range ("2–3", "2-3", "2 to 3"), then the unit as a whole word.
// Not preceded by a word character or part of another number.
const STEP_AMOUNT = new RegExp(
  `(?<![\\w.,/${FRACTION_CHARS}])(${NUMBER})(?:(\\s?[–-]\\s?|\\s+to\\s+)(${NUMBER}))?(\\s?)(${STEP_UNITS.join('|')})\\b`,
  'gi'
)

const METRIC_STEP_UNITS = new Set(['ml', 'l', 'g', 'kg'])
const SPELLED_OUT_UNIT = /^(fluid ounce|tablespoon|teaspoon|cup|pint|quart|gallon|milliliter|millilitre|liter|litre|ounce|pound|kilogram|gram)s?$/i

function readStepNumber(text) {
  let m
  if ((m = text.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return Number(m[3]) > 0 ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null
  if ((m = text.match(/^(\d+)\/(\d+)$/))) return Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null
  const last = text[text.length - 1]
  if (last in FRACTIONS) {
    const whole = text.slice(0, -1).trim()
    return (whole ? Number(whole) : 0) + FRACTIONS[last]
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

// "tablespoon" for 1 or less, "tablespoons" above; abbreviations stay as written.
function unitWordFor(word, value) {
  if (!SPELLED_OUT_UNIT.test(word)) return word
  const stem = word.replace(/s$/i, '')
  return value > 1 ? `${stem}${stem === stem.toUpperCase() ? 'S' : 's'}` : stem
}

/**
 * Scales the volume and weight amounts written in one instruction step by
 * `scaleFactor`, and shows them in the viewer's preferred system
 * (prefs.volume_unit / prefs.mass_unit, 'us' or 'metric'). Amounts are rounded
 * like the ingredient list. With no scaling to do and the amount already in
 * the viewer's system, the text is returned exactly as written.
 */
export function scaleStepText(stepText, scaleFactor, prefs) {
  if (!stepText) return stepText
  const factor = scaleFactor > 0 ? scaleFactor : 1

  return stepText.replace(STEP_AMOUNT, (match, lowText, rangeSeparator, highText, space, unitWord) => {
    const unit = readMeasurement(unitWord)
    const low = readStepNumber(lowText)
    const high = highText == null ? null : readStepNumber(highText)
    if (!unit || low == null || (highText != null && high == null)) return match

    const system = METRIC_STEP_UNITS.has(unit.unit) ? 'metric' : 'us'
    const preferred = unit.type === 'volume' ? prefs?.volume_unit : prefs?.mass_unit
    const convert = (preferred === 'us' || preferred === 'metric') && preferred !== system
    if (factor === 1 && !convert) return match

    const scaledLow = low * factor
    const scaledHigh = high == null ? null : high * factor
    const top = scaledHigh ?? scaledLow

    if (convert) {
      const target = bestUnitInSystem(top * unit.toBase, unit.type, preferred)
      if (target) {
        const show = (value) => roundForDisplay((value * unit.toBase) / target.toBase)
        const amount = scaledHigh == null ? `${show(scaledLow)}` : `${show(scaledLow)}${rangeSeparator}${show(scaledHigh)}`
        return `${amount} ${target.label}`
      }
    }

    const amount = scaledHigh == null
      ? `${roundForDisplay(scaledLow)}`
      : `${roundForDisplay(scaledLow)}${rangeSeparator}${roundForDisplay(scaledHigh)}`
    return `${amount}${space}${unitWordFor(unitWord, roundForDisplay(top))}`
  })
}
