// Which recipes the Recipes tab shows: everyone's, only mine, only my friends' (from the
// Social tab's friendships), or one Social group's members' (docs/adr/0011, step G3).
// Pure: no I/O.

export const RECIPE_FILTERS = [
  { key: 'all', label: 'All recipes' },
  { key: 'mine', label: 'My recipes' },
  { key: 'friends', label: "Friends' recipes" },
]

const KEYS = new Set(RECIPE_FILTERS.map((f) => f.key))
const GROUP_KEY = /^group:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** The filter key for a group ("group:<id>"). */
export function groupFilterKey(groupId) {
  return `group:${groupId}`
}

/** The group id in a group filter key, or null for other filters. */
export function groupIdOf(filter) {
  const m = typeof filter === 'string' ? filter.match(GROUP_KEY) : null
  return m ? m[1] : null
}

// For a value read back from localStorage: a known key or a well-formed group key, else 'all'.
export function normalizeRecipeFilter(value) {
  if (typeof value !== 'string') return 'all'
  return KEYS.has(value) || GROUP_KEY.test(value) ? value : 'all'
}

// Returns a new list (never changes the one passed in), keeping its order. A group filter
// whose group isn't loaded (yet, or any more) shows everything rather than nothing.
export function filterRecipes(recipes, filter, { userId = null, friendIds = [], groups = [] } = {}) {
  const key = normalizeRecipeFilter(filter)
  const groupId = groupIdOf(key)
  if (groupId) {
    const group = (groups ?? []).find((g) => g.id === groupId)
    if (!group) return [...recipes]
    const members = new Set((group.members ?? []).map((m) => m.user_id))
    return recipes.filter((r) => r.uploaded_by != null && members.has(r.uploaded_by))
  }
  switch (key) {
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
