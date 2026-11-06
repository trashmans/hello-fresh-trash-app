import { useCallback, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

// The household's Albert Heijn link, through the link-account Edge Function. The browser never
// sees tokens: only { state, linkedAt, lastRefreshAt } and, for the household, ah_enabled.

async function callLinkAccount(body) {
  const { data, error } = await supabase.functions.invoke('link-account', { body })
  if (!error) return data
  let message = 'Something went wrong. Nothing was changed.'
  if (error instanceof FunctionsHttpError) {
    try { message = (await error.context.json())?.message || message } catch { /* keep default */ }
  }
  throw new Error(message)
}

export function useAhLink() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [ahEnabled, setAhEnabled] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const { data: membership, error: householdError } = await supabase
        .from('household_members')
        .select('households(ah_enabled)')
        .eq('user_id', userId)
        .maybeSingle()
      if (householdError) throw new Error(householdError.message)
      setAhEnabled(membership?.households?.ah_enabled === true)
      setStatus(await callLinkAccount({ action: 'status' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  const run = useCallback(async (body) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await callLinkAccount(body))
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    ahEnabled, status, loading, busy, error, refresh,
    link: (pasted) => run({ action: 'link', pasted }),
    unlink: () => run({ action: 'unlink' }),
  }
}
