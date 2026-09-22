import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Fetches the ingredient list for a single recipe, in display order.
// Separate from useIngredientSearch/useIngredientFilter, which query
// across all recipes for typeahead search and chip filtering.
export function useRecipeIngredients(recipeId) {
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!recipeId) {
      setIngredients([])
      return
    }

    let cancelled = false
    setLoading(true)

    supabase
      .from('ingredients')
      .select('id, name, quantity, unit, preparation, display_order')
      .eq('recipe_id', recipeId)
      .order('display_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Failed to load ingredients:', error)
          setIngredients([])
        } else {
          setIngredients(data ?? [])
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [recipeId])

  return { ingredients, loading }
}
