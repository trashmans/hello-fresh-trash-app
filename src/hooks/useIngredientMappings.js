import { useCallback, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

// The household's ingredient mappings (public.household_ingredient_mappings, RLS:
// members only): what to buy at AH for a recipe ingredient, or "always at home".
// Each row comes with the mapped product's cached title, pack size, price and photo
// (public.retailer_products). Products are found with the same AH search as staples
// (the retailer-products Edge Function), which also puts them in the product cache.

export const MAPPING_SELECT = 'ingredient_key, label, pantry, product_external_id, amount_rule, product:retailer_products(title, sales_unit_size, price, image_url)'

const byLabel = (a, b) => a.label.localeCompare(b.label)

export function useIngredientMappings() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [householdId, setHouseholdId] = useState(null)
  const [ahEnabled, setAhEnabled] = useState(false)
  const [mappings, setMappings] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const { data: membership, error: householdError } = await supabase
        .from('household_members')
        .select('household_id, households(ah_enabled)')
        .eq('user_id', userId)
        .maybeSingle()
      if (cancelled) return
      if (householdError) { setError(householdError.message); return }
      const hid = membership?.household_id ?? null
      setHouseholdId(hid)
      setAhEnabled(membership?.households?.ah_enabled === true)
      if (!hid) return

      const { data, error: loadError } = await supabase
        .from('household_ingredient_mappings')
        .select(MAPPING_SELECT)
        .eq('household_id', hid)
        .order('label')
      if (cancelled) return
      if (loadError) setError(loadError.message)
      else setMappings(data ?? [])
    })()
    return () => { cancelled = true }
  }, [userId])

  // Each returns null on success, or a message to show.
  // row comes from toMappingRow(); saving the same ingredient again replaces its mapping.
  const save = useCallback(async (row) => {
    if (!householdId) return 'Your household is not loaded yet. Try again.'
    const { data, error: saveError } = await supabase
      .from('household_ingredient_mappings')
      .upsert(
        { ...row, household_id: householdId, created_by: userId, updated_at: new Date().toISOString() },
        { onConflict: 'household_id,ingredient_key' }
      )
      .select(MAPPING_SELECT)
      .single()
    if (saveError) return saveError.message
    setMappings((list) => [...list.filter((m) => m.ingredient_key !== data.ingredient_key), data].sort(byLabel))
    return null
  }, [householdId, userId])

  const remove = useCallback(async (ingredientKey) => {
    const { error: deleteError } = await supabase
      .from('household_ingredient_mappings')
      .delete()
      .eq('household_id', householdId)
      .eq('ingredient_key', ingredientKey)
    if (deleteError) return deleteError.message
    setMappings((list) => list.filter((m) => m.ingredient_key !== ingredientKey))
    return null
  }, [householdId])

  // How much to buy for these mappings (amount_rule: 'auto' | 'per_recipe' | 'per_week').
  const setRule = useCallback(async (ingredientKeys, rule) => {
    if (!householdId || ingredientKeys.length === 0) return 'Your household is not loaded yet. Try again.'
    const { data, error: updateError } = await supabase
      .from('household_ingredient_mappings')
      .update({ amount_rule: rule, updated_at: new Date().toISOString() })
      .eq('household_id', householdId)
      .in('ingredient_key', ingredientKeys)
      .select(MAPPING_SELECT)
    if (updateError) return updateError.message
    const changed = new Map((data ?? []).map((m) => [m.ingredient_key, m]))
    setMappings((list) => list.map((m) => changed.get(m.ingredient_key) ?? m))
    return null
  }, [householdId])

  // → { products, searchedFor } or { error }. One AH token refresh per call, so call it on submit.
  // suggest: true asks for the slower web-search way of finding AH's Dutch name (Suggest AH products).
  const searchProducts = useCallback(async (query, { suggest = false } = {}) => {
    const { data, error: fnError } = await supabase.functions.invoke('retailer-products', { body: suggest ? { query, mode: 'suggest' } : { query } })
    if (fnError) {
      let message = 'Search failed. Try again.'
      if (fnError instanceof FunctionsHttpError) {
        try { message = (await fnError.context.json())?.message || message } catch { /* keep default */ }
      }
      return { error: message }
    }
    return { products: data?.products ?? [], searchedFor: data?.searchedFor ?? [query] }
  }, [])

  return { available: ahEnabled && householdId != null, mappings, error, save, remove, setRule, searchProducts }
}
