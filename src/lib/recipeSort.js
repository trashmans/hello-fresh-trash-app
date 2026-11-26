// Sortable-column config and comparison logic for the recipe catalogue's
// list view (RecipeTable.jsx). Pulled out to src/lib/ so it can be
// unit-tested without rendering the table.

import { detectEquipment } from './equipment'

// `key` matches a column on the recipes table (all written by parse-recipe,
// see its ParsedRecipe interface) so sorting can compare raw values — unless
// the column has a `value(recipe)`, for values worked out in the browser
// (Equipment, read from the steps by src/lib/equipment.js).
export const RECIPE_TABLE_COLUMNS = [
  { key: 'name', label: 'Name', type: 'string' },
  { key: 'cook_time_minutes', label: 'Cook time', type: 'number', format: (v) => v != null ? `${v} min` : '—' },
  { key: 'prep_time_minutes', label: 'Prep time', type: 'number', format: (v) => v != null ? `${v} min` : '—' },
  { key: 'difficulty', label: 'Difficulty', type: 'string' },
  { key: 'cuisine', label: 'Cuisine', type: 'string' },
  { key: 'protein_source', label: 'Protein', type: 'string' },
  { key: 'equipment', label: 'Equipment', type: 'string', value: (r) => detectEquipment(r).join(', ') || null },
  { key: 'calories_kcal', label: 'Calories', type: 'number', nutrition: true, format: (v) => v != null ? `${v} kcal` : '—' },
  { key: 'protein_g', label: 'Protein (g)', type: 'number', nutrition: true, format: (v) => v != null ? `${v} g` : '—' },
  { key: 'fat_g', label: 'Fat', type: 'number', nutrition: true, format: (v) => v != null ? `${v} g` : '—' },
  { key: 'fibre_g', label: 'Fibre', type: 'number', nutrition: true, format: (v) => v != null ? `${v} g` : '—' },
]

// True when parse-recipe estimated this nutrition value from the ingredient
// list instead of reading it off the recipe card (it records those field
// names in recipes.nutrition_estimated). A missing value is never
// "estimated", and rows parsed before the column existed have no list.
export function isEstimated(recipe, key) {
  return recipe[key] != null &&
    Array.isArray(recipe.nutrition_estimated) &&
    recipe.nutrition_estimated.includes(key)
}

// What a table cell shows: the formatted value, prefixed with "~" when it
// is an AI estimate. `empty` lets the table mute the "—" placeholder.
// A column's value for a recipe (null when missing).
export function cellValue(recipe, column) {
  return column.value ? column.value(recipe) : recipe[column.key]
}

export function formatRecipeCell(recipe, column) {
  const value = cellValue(recipe, column)
  const text = column.format ? column.format(value) : (value ?? '—')
  const estimated = Boolean(column.nutrition) && isEstimated(recipe, column.key)
  return { text: estimated ? `~${text}` : text, estimated, empty: value == null }
}

function compareNonNull(av, bv, type) {
  return type === 'number' ? av - bv : String(av).localeCompare(String(bv))
}

// Nulls always sort last, regardless of direction — a recipe missing a
// value (not yet re-parsed, or the PDF had no nutrition section) should
// never jump to the top of a descending sort. This comparator is
// ascending-oriented; sortRecipes below applies direction only to the
// non-null comparison, so flipping to descending never pulls nulls to
// the front.
export function compareRecipesByColumn(a, b, column) {
  const av = cellValue(a, column)
  const bv = cellValue(b, column)
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  return compareNonNull(av, bv, column.type)
}

// Returns a new sorted array for a known column key, or the same array
// reference when there is no active sort (so callers relying on
// reference equality — e.g. memoized renders — don't re-render for free).
export function sortRecipes(recipes, columnKey, direction = 'asc') {
  const column = RECIPE_TABLE_COLUMNS.find(c => c.key === columnKey)
  if (!column) return recipes
  const sign = direction === 'desc' ? -1 : 1
  return [...recipes].sort((a, b) => {
    const av = cellValue(a, column)
    const bv = cellValue(b, column)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return compareNonNull(av, bv, column.type) * sign
  })
}
