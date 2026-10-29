// Sortable-column config and comparison logic for the recipe catalogue's
// list view (RecipeTable.jsx). Pulled out to src/lib/ so it can be
// unit-tested without rendering the table.

// `key` must match a column on the recipes table directly (all written by
// parse-recipe, see its ParsedRecipe interface) so sorting can just
// compare raw values.
export const RECIPE_TABLE_COLUMNS = [
  { key: 'name', label: 'Name', type: 'string' },
  { key: 'cook_time_minutes', label: 'Cook time', type: 'number', format: (v) => v != null ? `${v} min` : '—' },
  { key: 'prep_time_minutes', label: 'Prep time', type: 'number', format: (v) => v != null ? `${v} min` : '—' },
  { key: 'difficulty', label: 'Difficulty', type: 'string' },
  { key: 'cuisine', label: 'Cuisine', type: 'string' },
  { key: 'protein_source', label: 'Protein', type: 'string' },
  { key: 'calories_kcal', label: 'Calories', type: 'number', format: (v) => v != null ? `${v} kcal` : '—' },
  { key: 'protein_g', label: 'Protein (g)', type: 'number', format: (v) => v != null ? `${v} g` : '—' },
  { key: 'fat_g', label: 'Fat', type: 'number', format: (v) => v != null ? `${v} g` : '—' },
  { key: 'fibre_g', label: 'Fibre', type: 'number', format: (v) => v != null ? `${v} g` : '—' },
]

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
  const av = a[column.key]
  const bv = b[column.key]
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
    const av = a[column.key]
    const bv = b[column.key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return compareNonNull(av, bv, column.type) * sign
  })
}
