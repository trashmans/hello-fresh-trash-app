// Text for the Recipes tab's gallery cards and the heading above them.
// Pure: no I/O. Calories reuse the list view's formatting so an AI
// estimate gets the same "~" in both views.
import { RECIPE_TABLE_COLUMNS, formatRecipeCell } from '@/lib/recipeSort'

const CALORIES = RECIPE_TABLE_COLUMNS.find((c) => c.key === 'calories_kcal')

// The line under a card's name: total time, servings, calories. Anything
// the recipe card didn't give us is left out rather than shown as "—".
export function recipeCardMeta(recipe) {
  const parts = []
  const cook = recipe.cook_time_minutes
  const prep = recipe.prep_time_minutes
  if (cook != null || prep != null) parts.push(`${(cook ?? 0) + (prep ?? 0)} min`)
  if (recipe.servings != null) parts.push(`Serves ${recipe.servings}`)
  if (recipe.calories_kcal != null) parts.push(formatRecipeCell(recipe, CALORIES).text)
  return parts
}

function joinTerms(terms) {
  if (terms.length <= 1) return terms.join('')
  return `${terms.slice(0, -1).join(', ')} and ${terms[terms.length - 1]}`
}

// "12 recipes", or "7 recipes with garlic and onion" while searching.
export function catalogueHeading(count, terms = []) {
  const noun = count === 1 ? 'recipe' : 'recipes'
  return terms.length > 0 ? `${count} ${noun} with ${joinTerms(terms)}` : `${count} ${noun}`
}

// "3 in this week's list", or null when none of the shown recipes are.
export function weekListNote(count) {
  return count > 0 ? `${count} in this week's list` : null
}
