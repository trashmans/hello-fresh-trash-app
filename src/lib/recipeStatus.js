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
