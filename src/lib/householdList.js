// The shared household shopping list (rollout phase 2, docs/adr/0005): pure helpers
// between the household tables (household_recipe_picks, household_list_adjustments)
// and the in-memory list state used by useShoppingList:
//   { recipeSelections: [{ recipe_id, servings, swap_id?, swap_mode? }], adjustedItems: [{ key, buy_qty }] }
// A pick may carry the protein swap chosen for it this week (docs/adr/0010): swap_id and
// swap_mode ('all' | 'half'); anything else counts as the original.
//
// Two members share one list, so nothing here ever replaces the whole list. Saving
// sends only the rows that changed (diffListState), and a refetch keeps changes that
// are not saved yet (mergeRemote).

const DEFAULT_SERVINGS = 2 // same default as adding a recipe in useShoppingList

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)

// The swap part of a pick: { swap_id, swap_mode }, both null for the original.
function swapOf(p) {
  const ok = typeof p?.swap_id === 'string' && p.swap_id !== '' && (p.swap_mode === 'all' || p.swap_mode === 'half')
  return ok ? { swap_id: p.swap_id, swap_mode: p.swap_mode } : { swap_id: null, swap_mode: null }
}

// A list entry; swap fields only when there is a swap, so original picks stay { recipe_id, servings }.
function selection(recipe_id, { servings, swap_id, swap_mode }) {
  return swap_id ? { recipe_id, servings, swap_id, swap_mode } : { recipe_id, servings }
}

// Rows from the two household tables -> list state. Picks are ordered by when they
// were added (ties by recipe id) so every member sees the same order.
export function toListState(pickRows, adjustmentRows) {
  const picks = [...(pickRows ?? [])].sort((a, b) => {
    const byTime = (Date.parse(a.added_at) || 0) - (Date.parse(b.added_at) || 0)
    if (byTime !== 0) return byTime
    return String(a.recipe_id) < String(b.recipe_id) ? -1 : 1
  })
  return {
    recipeSelections: picks.map(p => selection(p.recipe_id, { servings: Number(p.servings), ...swapOf(p) })),
    adjustedItems: (adjustmentRows ?? []).map(a => ({ key: a.item_key, buy_qty: Number(a.buy_qty) })),
  }
}

// List state -> Maps keyed by recipe id / item key. Entries the database would reject
// are dropped (no recipe id or item key, servings not above zero, buy quantity not a
// number); if the same recipe or item appears twice, the last entry wins.
function index({ recipeSelections = [], adjustedItems = [] } = {}) {
  const picks = new Map()
  for (const selection of recipeSelections ?? []) {
    const id = selection?.recipe_id
    if (typeof id !== 'string' || id === '') continue
    const servings = selection.servings == null ? DEFAULT_SERVINGS : selection.servings
    if (!isNumber(servings) || servings <= 0) continue
    picks.delete(id)
    picks.set(id, { servings, ...swapOf(selection) })
  }
  const adjustments = new Map()
  for (const item of adjustedItems ?? []) {
    const key = item?.key
    if (typeof key !== 'string' || key === '' || !isNumber(item.buy_qty)) continue
    adjustments.delete(key)
    adjustments.set(key, item.buy_qty)
  }
  return { picks, adjustments }
}

// The row writes that turn `base` (what the database holds) into `next`:
//   { type: 'addPick', recipe_id, servings }          insert
//   { type: 'setPickServings', recipe_id, servings }  update only: never re-adds a
//                                                     recipe another member removed
//   { type: 'setPickSwap', recipe_id, swap_id, swap_mode }  update only, like servings
//   { type: 'removePick', recipe_id }
//   { type: 'setAdjustment', item_key, buy_qty }      insert or update
//   { type: 'removeAdjustment', item_key }
// Order within the list is not saved, so a reorder gives no writes.
export function diffListState(base, next) {
  const from = index(base)
  const to = index(next)
  const ops = []

  for (const id of from.picks.keys()) {
    if (!to.picks.has(id)) ops.push({ type: 'removePick', recipe_id: id })
  }
  for (const [id, pick] of to.picks) {
    const before = from.picks.get(id)
    if (!before) {
      ops.push(pick.swap_id
        ? { type: 'addPick', recipe_id: id, servings: pick.servings, swap_id: pick.swap_id, swap_mode: pick.swap_mode }
        : { type: 'addPick', recipe_id: id, servings: pick.servings })
      continue
    }
    if (before.servings !== pick.servings) ops.push({ type: 'setPickServings', recipe_id: id, servings: pick.servings })
    if (before.swap_id !== pick.swap_id || before.swap_mode !== pick.swap_mode) {
      ops.push({ type: 'setPickSwap', recipe_id: id, swap_id: pick.swap_id, swap_mode: pick.swap_mode })
    }
  }

  for (const key of from.adjustments.keys()) {
    if (!to.adjustments.has(key)) ops.push({ type: 'removeAdjustment', item_key: key })
  }
  for (const [key, buyQty] of to.adjustments) {
    if (from.adjustments.get(key) !== buyQty) ops.push({ type: 'setAdjustment', item_key: key, buy_qty: buyQty })
  }

  return ops
}

// After a refetch: the household list (`remote`) with this device's unsaved changes
// (the difference between `base`, the last list known to be saved, and `local`) put
// back on top. diffListState(remote, result) is then exactly what is still to save.
export function mergeRemote(base, local, remote) {
  const { picks, adjustments } = index(remote)

  for (const op of diffListState(base, local)) {
    switch (op.type) {
      case 'addPick':
        picks.set(op.recipe_id, { servings: op.servings, ...swapOf(op) })
        break
      case 'setPickServings':
        if (picks.has(op.recipe_id)) picks.set(op.recipe_id, { ...picks.get(op.recipe_id), servings: op.servings })
        break
      case 'setPickSwap':
        if (picks.has(op.recipe_id)) picks.set(op.recipe_id, { ...picks.get(op.recipe_id), ...swapOf(op) })
        break
      case 'removePick':
        picks.delete(op.recipe_id)
        break
      case 'setAdjustment':
        adjustments.set(op.item_key, op.buy_qty)
        break
      case 'removeAdjustment':
        adjustments.delete(op.item_key)
        break
    }
  }

  return {
    recipeSelections: [...picks].map(([recipe_id, pick]) => selection(recipe_id, pick)),
    adjustedItems: [...adjustments].map(([key, buy_qty]) => ({ key, buy_qty })),
  }
}
