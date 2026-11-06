// Builds the payload for public.sync_household_shopping_list() (rollout phase 2,
// docs/adr/0005): the shopping list's in-memory state, reshaped into one entry per
// recipe pick and one per adjusted item for the household tables.
//
// Entries the database would reject are dropped here (no recipe id or item key,
// servings not above zero, buy quantity not a number), so one bad entry can't fail
// the whole sync. If the same recipe or item appears twice, the last entry wins,
// matching how the reducer treats later changes.

const DEFAULT_SERVINGS = 2 // same default as adding a recipe in useShoppingList

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)

export function toHouseholdSyncPayload({ recipeSelections = [], adjustedItems = [] } = {}) {
  const picks = new Map()
  for (const selection of recipeSelections) {
    const id = selection?.recipe_id
    if (typeof id !== 'string' || id === '') continue
    const servings = selection.servings == null ? DEFAULT_SERVINGS : selection.servings
    if (!isNumber(servings) || servings <= 0) continue
    picks.delete(id) // re-insert so the last occurrence also keeps its position
    picks.set(id, { recipe_id: id, servings })
  }

  const adjustments = new Map()
  for (const item of adjustedItems) {
    const key = item?.key
    if (typeof key !== 'string' || key === '' || !isNumber(item.buy_qty)) continue
    adjustments.delete(key)
    adjustments.set(key, { item_key: key, buy_qty: item.buy_qty })
  }

  return { picks: [...picks.values()], adjustments: [...adjustments.values()] }
}
