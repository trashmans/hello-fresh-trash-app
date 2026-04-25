/**
 * Scales and merges ingredients from multiple recipe selections.
 *
 * @param {Array<{recipe_id: string, servings: number}>} recipeSelections
 * @param {Object<string, Array>} ingredientsMap  — { recipe_id: [ingredient rows] }
 * @param {Object<string, Object>} recipesMap     — { recipe_id: { id, name, servings } }
 * @returns {Array} merged line items sorted alphabetically by name
 */
export function mergeIngredients(recipeSelections, ingredientsMap, recipesMap) {
  const groups = new Map()

  for (const { recipe_id, servings: selectedServings } of recipeSelections) {
    const ingredients = ingredientsMap[recipe_id] ?? []
    const recipe = recipesMap[recipe_id]
    const baseServings = recipe?.servings ?? 1
    const scaleFactor = baseServings > 0 ? selectedServings / baseServings : 1

    for (const ing of ingredients) {
      const unit = ing.unit ?? ''
      const key = `${ing.name.toLowerCase()}|${unit.toLowerCase()}`
      const scaledQty = ing.quantity != null ? ing.quantity * scaleFactor : null

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: ing.name,
          unit: ing.unit ?? null,
          preparation: ing.preparation ?? null,
          computedQty: scaledQty,
          contributions: [],
        })
      } else {
        const group = groups.get(key)
        if (scaledQty != null && group.computedQty != null) {
          group.computedQty += scaledQty
        } else {
          group.computedQty = null
        }
      }

      groups.get(key).contributions.push({
        recipeName: recipe?.name ?? recipe_id,
        scaledQty,
        baseQty: ing.quantity,
        scaleFactor,
        selectedServings,
        baseServings,
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
}
