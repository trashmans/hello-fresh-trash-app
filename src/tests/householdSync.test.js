import { describe, it, expect } from 'vitest'
import { toHouseholdSyncPayload } from '@/lib/householdSync'

describe('toHouseholdSyncPayload', () => {
  it('maps recipe selections to picks and adjusted items to adjustments', () => {
    const state = {
      recipeSelections: [{ recipe_id: 'r1', servings: 2 }, { recipe_id: 'r2', servings: 0.5 }],
      adjustedItems: [{ key: 'olive oil|volume:metric', buy_qty: 0 }, { key: 'garlic|count:', buy_qty: 3 }],
    }
    expect(toHouseholdSyncPayload(state)).toEqual({
      picks: [{ recipe_id: 'r1', servings: 2 }, { recipe_id: 'r2', servings: 0.5 }],
      adjustments: [{ item_key: 'olive oil|volume:metric', buy_qty: 0 }, { item_key: 'garlic|count:', buy_qty: 3 }],
    })
  })

  it('keeps 0 as a real buy quantity (checked off)', () => {
    const { adjustments } = toHouseholdSyncPayload({ recipeSelections: [], adjustedItems: [{ key: 'k', buy_qty: 0 }] })
    expect(adjustments).toEqual([{ item_key: 'k', buy_qty: 0 }])
  })

  it('keeps only the last entry when the same recipe or item appears twice', () => {
    const payload = toHouseholdSyncPayload({
      recipeSelections: [{ recipe_id: 'r1', servings: 2 }, { recipe_id: 'r1', servings: 4 }],
      adjustedItems: [{ key: 'k', buy_qty: 1 }, { key: 'k', buy_qty: 2 }],
    })
    expect(payload.picks).toEqual([{ recipe_id: 'r1', servings: 4 }])
    expect(payload.adjustments).toEqual([{ item_key: 'k', buy_qty: 2 }])
  })

  it('defaults missing servings to 2, like adding a recipe does', () => {
    const { picks } = toHouseholdSyncPayload({ recipeSelections: [{ recipe_id: 'r1' }], adjustedItems: [] })
    expect(picks).toEqual([{ recipe_id: 'r1', servings: 2 }])
  })

  it('drops entries that the database would reject', () => {
    const payload = toHouseholdSyncPayload({
      recipeSelections: [{ recipe_id: '', servings: 2 }, { servings: 2 }, { recipe_id: 'r1', servings: 0 }, { recipe_id: 'r2', servings: -1 }],
      adjustedItems: [{ key: '', buy_qty: 1 }, { buy_qty: 1 }, { key: 'k', buy_qty: null }, { key: 'j', buy_qty: 'x' }],
    })
    expect(payload).toEqual({ picks: [], adjustments: [] })
  })

  it('handles an empty or missing state', () => {
    expect(toHouseholdSyncPayload({ recipeSelections: [], adjustedItems: [] })).toEqual({ picks: [], adjustments: [] })
    expect(toHouseholdSyncPayload({})).toEqual({ picks: [], adjustments: [] })
  })
})
