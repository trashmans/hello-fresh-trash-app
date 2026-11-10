import { useCallback, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

// The household's staples (public.household_staples, RLS: members only) and AH product
// search through the retailer-products Edge Function. Pinned products come with their
// cached title, pack size and price (public.retailer_products).

const STAPLE_SELECT = '*, product:retailer_products(title, sales_unit_size, price)'

async function errorMessage(error, fallback) {
  if (error instanceof FunctionsHttpError) {
    try { return (await error.context.json())?.message || fallback } catch { return fallback }
  }
  return error?.message || fallback
}

export function useStaples() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [householdId, setHouseholdId] = useState(null)
  const [ahEnabled, setAhEnabled] = useState(false)
  const [staples, setStaples] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const { data: membership, error: householdError } = await supabase
        .from('household_members')
        .select('household_id, households(ah_enabled)')
        .eq('user_id', userId)
        .maybeSingle()
      if (householdError) throw householdError
      const hid = membership?.household_id ?? null
      setHouseholdId(hid)
      setAhEnabled(membership?.households?.ah_enabled === true)
      if (!hid) { setStaples([]); return }
      const { data, error: staplesError } = await supabase
        .from('household_staples')
        .select(STAPLE_SELECT)
        .eq('household_id', hid)
        .order('name')
      if (staplesError) throw staplesError
      setStaples(data ?? [])
    } catch (err) {
      setError(err.message ?? 'Could not load your staples.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  // Each returns null on success, or a message to show.
  const add = useCallback(async (row) => {
    const { data, error: insertError } = await supabase
      .from('household_staples')
      .insert({ ...row, household_id: householdId, created_by: userId })
      .select(STAPLE_SELECT)
      .single()
    if (insertError) return insertError.message
    setStaples((list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)))
    return null
  }, [householdId, userId])

  const update = useCallback(async (id, patch) => {
    const { data, error: updateError } = await supabase
      .from('household_staples')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(STAPLE_SELECT)
      .single()
    if (updateError) return updateError.message
    setStaples((list) => list.map((s) => (s.id === id ? data : s)).sort((a, b) => a.name.localeCompare(b.name)))
    return null
  }, [])

  const remove = useCallback(async (id) => {
    const { error: deleteError } = await supabase.from('household_staples').delete().eq('id', id)
    if (deleteError) return deleteError.message
    setStaples((list) => list.filter((s) => s.id !== id))
    return null
  }, [])

  // → { products, searchedFor } or { error }. One AH token refresh per call, so call it on submit.
  const searchProducts = useCallback(async (query) => {
    const { data, error: fnError } = await supabase.functions.invoke('retailer-products', { body: { query } })
    if (fnError) return { error: await errorMessage(fnError, 'Search failed. Try again.') }
    return { products: data?.products ?? [], searchedFor: data?.searchedFor ?? [query] }
  }, [])

  return { householdId, ahEnabled, staples, loading, error, refresh, add, update, remove, searchProducts }
}
