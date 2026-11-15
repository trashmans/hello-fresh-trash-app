import { useReducer, useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'
import { toListState, diffListState, mergeRemote } from '@/lib/householdList'

const initialState = { recipeSelections: [], adjustedItems: [] }

function reducer(state, action) {
  switch (action.type) {
    case 'LOAD':
      return {
        recipeSelections: action.recipeSelections,
        adjustedItems: action.adjustedItems,
      }

    case 'ADD_RECIPE': {
      if (state.recipeSelections.some(r => r.recipe_id === action.recipe.id)) return state
      return {
        ...state,
        recipeSelections: [
          ...state.recipeSelections,
          { recipe_id: action.recipe.id, servings: action.recipe.servings ?? 2 },
        ],
      }
    }

    case 'REMOVE_RECIPE':
      return {
        ...state,
        recipeSelections: state.recipeSelections.filter(r => r.recipe_id !== action.recipeId),
      }

    case 'SET_SERVINGS':
      // Floor lowered from 1 to 0.1 to support ingredient-based scaling
      // (src/lib/scaling.js) landing on a fractional serving count below
      // 1 — e.g. "I only have a third of the chicken this recipe wants."
      // Still clamped above zero so a scaled-down recipe never disappears
      // from the merged ingredient list entirely.
      return {
        ...state,
        recipeSelections: state.recipeSelections.map(r =>
          r.recipe_id === action.recipeId
            ? { ...r, servings: Math.max(0.1, action.servings) }
            : r
        ),
      }

    case 'SET_ADJUSTED_QTY': {
      const { key, buyQty, computedQty } = action
      let adjustedItems
      if (computedQty !== null && buyQty === computedQty) {
        adjustedItems = state.adjustedItems.filter(a => a.key !== key)
      } else {
        const exists = state.adjustedItems.some(a => a.key === key)
        adjustedItems = exists
          ? state.adjustedItems.map(a => a.key === key ? { ...a, buy_qty: buyQty } : a)
          : [...state.adjustedItems, { key, buy_qty: buyQty }]
      }
      return { ...state, adjustedItems }
    }

    case 'CLEAR_CHECKED':
      return {
        ...state,
        adjustedItems: state.adjustedItems.filter(a => a.buy_qty !== 0),
      }

    default:
      return state
  }
}

// The household's shared shopping list (rollout phase 2, step 2, docs/adr/0005).
//
// Reads public.household_recipe_picks / household_list_adjustments for the caller's
// household and writes them one row at a time, so two members share one list and a
// save never touches a row the other member changed (src/lib/householdList.js):
//   - baseRef holds the list as last known to be saved; every 500 ms the difference
//     between it and the current state is sent as row writes.
//   - When the tab gets focus again the list is fetched again and merged, keeping
//     changes that are not saved yet. (Realtime comes in a follow-up PR.)
//   - Saves and refetches run one after another through a queue, never interleaved.
// Until step 3 drops it, each save also copies the list into the caller's
// public.shopping_lists row, so this step can be rolled back without loss.
export function useShoppingList() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [state, dispatch] = useReducer(reducer, initialState)
  const [householdId, setHouseholdId] = useState(null)
  const stateRef = useRef(state)
  const baseRef = useRef(initialState)
  const queueRef = useRef(Promise.resolve())
  const saveTimer = useRef(null)
  const lastRefresh = useRef(0)

  useEffect(() => { stateRef.current = state }, [state])

  const enqueue = useCallback((job) => {
    queueRef.current = queueRef.current.then(job, job)
    return queueRef.current
  }, [])

  // First load: find (or create) the household, then read its list.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data: hid, error } = await supabase.rpc('ensure_my_household')
        if (error) throw error
        const remote = await fetchHouseholdList(hid)
        if (cancelled) return
        baseRef.current = remote
        dispatch({ type: 'LOAD', ...remote })
        setHouseholdId(hid)
      } catch (error) {
        if (cancelled) return
        console.error('shopping list load error:', error)
        toast.error(`Could not load your shopping list: ${error.message}`)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  // Save: send only the rows that differ from what is known to be saved.
  useEffect(() => {
    if (!householdId || !userId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      enqueue(async () => {
        const target = stateRef.current
        const ops = diffListState(baseRef.current, target)
        if (ops.length === 0) return

        const results = await Promise.all(ops.map(op => runOp(op, householdId, userId)))
        const failed = results.find(r => r.error)
        if (!failed) {
          baseRef.current = mergeRemote(baseRef.current, target, baseRef.current)
          mirrorToOwnList(userId, target)
          return
        }

        // Something was refused. Show the household's real list again, keeping only
        // changes made after this save started (those are saved by the next run).
        console.error('shopping list save error:', failed.error)
        toast.error(`Could not save your shopping list: ${failed.error.message}`)
        try {
          const remote = await fetchHouseholdList(householdId)
          const merged = mergeRemote(target, stateRef.current, remote)
          baseRef.current = remote
          dispatch({ type: 'LOAD', ...merged })
        } catch (error) {
          console.error('shopping list reload error:', error)
        }
      })
    }, 500)
  }, [state, householdId, userId, enqueue])

  // Pick up the other member's changes when this tab is looked at again.
  useEffect(() => {
    if (!householdId) return
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRefresh.current < 2000) return // focus + visibilitychange fire together
      lastRefresh.current = Date.now()
      enqueue(async () => {
        try {
          const remote = await fetchHouseholdList(householdId)
          const merged = mergeRemote(baseRef.current, stateRef.current, remote)
          baseRef.current = remote
          dispatch({ type: 'LOAD', ...merged })
        } catch (error) {
          console.warn('shopping list refresh failed:', error.message)
        }
      })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [householdId, enqueue])

  const toggleRecipe = useCallback((recipe) => {
    const isSelected = state.recipeSelections.some(r => r.recipe_id === recipe.id)
    dispatch(isSelected
      ? { type: 'REMOVE_RECIPE', recipeId: recipe.id }
      : { type: 'ADD_RECIPE', recipe }
    )
  }, [state.recipeSelections])

  return {
    recipeSelections: state.recipeSelections,
    adjustedItems: state.adjustedItems,
    selectedIds: state.recipeSelections.map(r => r.recipe_id),
    toggleRecipe,
    removeRecipe: (recipeId) => dispatch({ type: 'REMOVE_RECIPE', recipeId }),
    setServings: (recipeId, servings) => dispatch({ type: 'SET_SERVINGS', recipeId, servings }),
    setAdjustedQty: (key, buyQty, computedQty) =>
      dispatch({ type: 'SET_ADJUSTED_QTY', key, buyQty, computedQty }),
    clearChecked: () => dispatch({ type: 'CLEAR_CHECKED' }),
  }
}

// Reads the household's list. Throws on error.
async function fetchHouseholdList(householdId) {
  const [picks, adjustments] = await Promise.all([
    supabase
      .from('household_recipe_picks')
      .select('recipe_id, servings, added_at')
      .eq('household_id', householdId),
    supabase
      .from('household_list_adjustments')
      .select('item_key, buy_qty')
      .eq('household_id', householdId),
  ])
  if (picks.error) throw picks.error
  if (adjustments.error) throw adjustments.error
  return toListState(picks.data, adjustments.data)
}

// One row write from diffListState(). Resolves to { error } like every Supabase call.
function runOp(op, householdId, userId) {
  const now = new Date().toISOString()
  const picks = () => supabase.from('household_recipe_picks')
  const adjustments = () => supabase.from('household_list_adjustments')
  switch (op.type) {
    case 'addPick':
      // If the other member already added it, keep their row.
      return picks().upsert(
        { household_id: householdId, recipe_id: op.recipe_id, servings: op.servings, added_by: userId },
        { onConflict: 'household_id,recipe_id', ignoreDuplicates: true }
      )
    case 'setPickServings':
      return picks()
        .update({ servings: op.servings, updated_at: now })
        .eq('household_id', householdId)
        .eq('recipe_id', op.recipe_id)
    case 'removePick':
      return picks().delete().eq('household_id', householdId).eq('recipe_id', op.recipe_id)
    case 'setAdjustment':
      return adjustments().upsert(
        { household_id: householdId, item_key: op.item_key, buy_qty: op.buy_qty, updated_at: now },
        { onConflict: 'household_id,item_key' }
      )
    case 'removeAdjustment':
      return adjustments().delete().eq('household_id', householdId).eq('item_key', op.item_key)
    default:
      return Promise.resolve({ error: null })
  }
}

// Rollback safety net until step 3: public.shopping_lists is no longer read, so a
// failure here is only logged.
function mirrorToOwnList(userId, list) {
  supabase
    .from('shopping_lists')
    .upsert(
      {
        user_id: userId,
        recipe_selections: list.recipeSelections,
        adjusted_items: list.adjustedItems,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .then(({ error }) => {
      if (error) console.warn('shopping_lists copy failed:', error.message)
    })
}
