import { useCallback, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// Protein swaps (docs/adr/0010).

/** The recipe_swaps rows for these ids, as { [id]: row } (for the Shopping tab and AH preview). */
export function useSwapsById(swapIds) {
  const key = [...new Set((swapIds ?? []).filter(Boolean))].sort().join(',')
  const [byId, setById] = useState({})
  useEffect(() => {
    if (!key) { setById({}); return undefined }
    let cancelled = false
    supabase.from('recipe_swaps').select('*').in('id', key.split(',')).then(({ data }) => {
      if (!cancelled) setById(Object.fromEntries((data ?? []).map(r => [r.id, r])))
    })
    return () => { cancelled = true }
  }, [key])
  return byId
}

/**
 * The swap options for one recipe and direction, from the suggest-swaps Edge Function
 * (saved options, or Gemini's new ones the first time). load() runs once on demand;
 * more() asks for other options. Errors come back as readable messages.
 */
export function useRecipeSwapOptions(recipeId, direction) {
  const [options, setOptions] = useState(null) // null = not loaded yet
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { setOptions(null); setError(null) }, [recipeId, direction])

  const fetchOptions = useCallback(async (more) => {
    if (!recipeId || !direction) return
    setLoading(true)
    setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('suggest-swaps', { body: { recipeId, direction, more } })
    setLoading(false)
    if (fnError) {
      let message = 'Could not get suggestions. Try again.'
      if (fnError instanceof FunctionsHttpError) {
        try { message = (await fnError.context.json())?.message || message } catch { /* keep default */ }
      }
      setError(message)
      return
    }
    setOptions(data?.swaps ?? [])
  }, [recipeId, direction])

  return {
    options, loading, error,
    load: () => fetchOptions(false),
    more: () => fetchOptions(true),
  }
}
