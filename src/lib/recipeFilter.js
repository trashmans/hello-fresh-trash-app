// Which recipes the Recipes tab shows: everyone's, only mine, or only my
// friends'. Friends come with the Social tab; until then the friends filter
// is shown but disabled, and has no friend ids to match. Pure: no I/O.

export const RECIPE_FILTERS = [
  { key: 'all', label: 'All recipes' },
  { key: 'mine', label: 'My recipes' },
  { key: 'friends', label: "Friends' recipes", needsSocial: true },
]

const KEYS = new Set(RECIPE_FILTERS.map((f) => f.key))

// For a value read back from localStorage: a known key, else 'all'.
export function normalizeRecipeFilter(value) {
  return typeof value === 'string' && KEYS.has(value) ? value : 'all'
}

// Returns a new list (never changes the one passed in), keeping its order.
export function filterRecipes(recipes, filter, { userId = null, friendIds = [] } = {}) {
  switch (normalizeRecipeFilter(filter)) {
    case 'mine':
      return userId ? recipes.filter((r) => r.uploaded_by === userId) : []
    case 'friends': {
      const friends = new Set(friendIds)
      return recipes.filter((r) => r.uploaded_by != null && friends.has(r.uploaded_by))
    }
    default:
      return [...recipes]
  }
}
