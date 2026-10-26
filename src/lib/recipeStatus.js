// Helpers for keeping recipe cards in step with parsing.
//
// The catalogue gets status changes from a Supabase Realtime channel. That
// channel can silently stop delivering (a laptop sleeps, Wi-Fi drops, or React's
// development StrictMode restarts the component). As a safety net the catalogue
// also re-checks the user's own in-progress recipes every STATUS_POLL_MS while
// any exist, and when the tab becomes visible again. These pure functions decide
// what to check and how to merge the answer without needless re-renders.

const IN_PROGRESS = new Set(['pending', 'processing'])

export const STATUS_POLL_MS = 10_000

export const isInProgress = (status) => IN_PROGRESS.has(status)

/** Ids of the user's own recipes that are still pending or processing, in list order. */
export function ownInProgressIds(recipes, userId) {
  return recipes
    .filter(r => r.uploaded_by === userId && isInProgress(r.status))
    .map(r => r.id)
}

/**
 * Ids of recipes the catalogue should keep re-checking: my own pending or
 * processing recipes, plus any recipe I re-parsed this session (watchedIds),
 * whoever uploaded it. The page only receives live updates for my own uploads,
 * so without the watch list an admin re-parse of someone else's recipe is
 * never seen to finish.
 */
export function inProgressIdsToCheck(recipes, userId, watchedIds = new Set()) {
  return recipes
    .filter(r => isInProgress(r.status) && (r.uploaded_by === userId || watchedIds.has(r.id)))
    .map(r => r.id)
}

/**
 * Applies freshly fetched rows to the recipe list. Rows for recipes not in the
 * list are ignored. Returns the same array (and the same recipe objects) when
 * nothing actually changed, so a poll that finds nothing new does not re-render.
 * Compare scalar fields only; callers fetch full rows just for recipes that finished.
 */
export function mergeStatusUpdates(recipes, rows) {
  if (!rows?.length) return recipes
  const byId = new Map(rows.map(row => [row.id, row]))

  let changed = false
  const next = recipes.map(recipe => {
    const row = byId.get(recipe.id)
    if (!row) return recipe
    const differs = Object.keys(row).some(key => recipe[key] !== row[key])
    if (!differs) return recipe
    changed = true
    return { ...recipe, ...row }
  })

  return changed ? next : recipes
}

// retry-parse refuses a recipe that has already been retried this many times.
const RETRY_PARSE_LIMIT = 3

/**
 * Which card a recipe gets in the catalogue, and what it can do.
 *   null                                    hidden
 *   { kind: 'ready' }
 *   { kind: 'pending', canCancel }          Cancel deletes the recipe: uploader only
 *   { kind: 'failed', retryVia }            'retry-parse' (uploader), 'admin-reparse' (admin), or null
 *   { kind: 'rejected' }                    duplicate; uploader only
 * Someone else's in-progress recipe shows only if I re-parsed it (watchedIds) or am in
 * admin mode; their failed recipes only in admin mode, so an admin can rescue them.
 */
export function recipeCardState(recipe, { userId, adminMode = false, watchedIds = new Set() } = {}) {
  const own = recipe.uploaded_by === userId

  switch (recipe.status) {
    case 'ready':
      return { kind: 'ready' }

    case 'pending':
    case 'processing':
      if (own) return { kind: 'pending', canCancel: true }
      if (adminMode || watchedIds.has(recipe.id)) return { kind: 'pending', canCancel: false }
      return null

    case 'failed': {
      const retriesUsedUp = (recipe.retry_count ?? 0) >= RETRY_PARSE_LIMIT
      if (own && !retriesUsedUp) return { kind: 'failed', retryVia: 'retry-parse' }
      if (adminMode) return { kind: 'failed', retryVia: 'admin-reparse' }
      if (own) return { kind: 'failed', retryVia: null }
      return null
    }

    case 'rejected':
      return own ? { kind: 'rejected' } : null

    default:
      return null
  }
}
