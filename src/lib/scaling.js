// Computes scale factors for a recipe — either from a target servings
// count (the same ratio math src/lib/ingredientMerge.js already uses for
// the shopping list) or from a target amount of a single ingredient — and
// applies a scale factor to an ingredient list for display.
//
// Never touches what's stored in the database: scaling is purely a
// display-time transform, same principle as src/lib/units.js.

import { toBaseUnit, roundForDisplay } from './units'

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
