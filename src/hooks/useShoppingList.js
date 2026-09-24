import { useReducer, useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'

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

export function useShoppingList() {
  const { session } = useAuth()
  const [state, dispatch] = useReducer(reducer, initialState)
  const [loaded, setLoaded] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    if (!session?.user?.id) return
    supabase
      .from('shopping_lists')
      .select('recipe_selections, adjusted_items')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('shopping_lists load error:', error)
          toast.error(`Could not load your shopping list: ${error.message}`)
        } else if (data) {
          dispatch({
            type: 'LOAD',
            recipeSelections: data.recipe_selections ?? [],
            adjustedItems: data.adjusted_items ?? [],
          })
        }
        setLoaded(true)
      })
  }, [session?.user?.id])

  useEffect(() => {
    if (!loaded || !session?.user?.id) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      supabase
        .from('shopping_lists')
        .upsert(
          {
            user_id: session.user.id,
            recipe_selections: state.recipeSelections,
            adjusted_items: state.adjustedItems,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
        .then(({ error }) => {
          if (error) {
            console.error('shopping_lists save error:', error)
            toast.error(`Could not save your shopping list: ${error.message}`)
          }
        })
    }, 500)
  }, [state, loaded, session?.user?.id])

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
