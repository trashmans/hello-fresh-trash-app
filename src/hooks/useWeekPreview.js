import { useCallback, useEffect, useMemo, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { STAPLE_SELECT } from '@/hooks/useStaples'
import { mergeIngredients } from '@/lib/ingredientMerge'
import { buildWeekPreview, toSendRequest } from '@/lib/weekPreview'

// This week's preview (rollout phase 5): a dry run of what the weekly shop would change
// on the household's AH list. run() gathers the household's staples, the shared shopping
// list (recipe picks, their ingredients, adjustments) and this week's AH snapshot from
// the read-only retailer-week Edge Function, then plans in the browser
// (src/lib/weekPreview.js). Nothing is written to AH and nothing is saved.
//
// Each run refreshes the AH login once and searches AH for a few staples, so it only
// runs when asked (a button), never on its own. The household's ingredient mappings
// (useIngredientMappings) are passed in and applied to the last run's inputs, so mapping
// an ingredient updates the preview straight away without asking AH again.
//
// send() (rollout phase 6) sends the preview on screen to the household's AH list through
// the retailer-send Edge Function, which checks everything again on the server. Only the
// household owner of a household with send_enabled on may send (canSend); the result is
// kept until the next run so the screen can show what happened per line.

// Today's date ('YYYY-MM-DD') on the household's calendar.
function todayIn(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

async function functionMessage(error, fallback) {
  if (error instanceof FunctionsHttpError) {
    try { return (await error.context.json())?.message || fallback } catch { return fallback }
  }
  return fallback
}

export function useWeekPreview({ recipeSelections, adjustedItems }, mappings = []) {
  const { session, unitPrefs } = useAuth()
  const userId = session?.user?.id
  const [household, setHousehold] = useState(null) // { id, ahEnabled, sendEnabled, role, timeZone }
  const [inputs, setInputs] = useState(null) // what the last run gathered
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null) // retailer-send's answer: { status, lines, staplesUpdated }
  const [sendError, setSendError] = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('household_members')
      .select('household_id, role, households(ah_enabled, send_enabled, time_zone)')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.household_id) return
        setHousehold({
          id: data.household_id,
          ahEnabled: data.households?.ah_enabled === true,
          sendEnabled: data.households?.send_enabled === true,
          role: data.role,
          timeZone: data.households?.time_zone ?? 'Europe/Amsterdam',
        })
      })
    return () => { cancelled = true }
  }, [userId])

  const run = useCallback(async () => {
    if (!household?.id) return
    setLoading(true)
    setError(null)
    setSendResult(null)
    setSendError(null)
    try {
      const ids = recipeSelections.map(r => r.recipe_id)
      const none = Promise.resolve({ data: [], error: null })
      const [staples, recipes, ingredients, week] = await Promise.all([
        supabase.from('household_staples').select(STAPLE_SELECT).eq('household_id', household.id).order('name'),
        ids.length ? supabase.from('recipes').select('id, name, servings').in('id', ids) : none,
        ids.length ? supabase.from('ingredients').select('*').in('recipe_id', ids) : none,
        supabase.functions.invoke('retailer-week', { body: {} }),
      ])
      if (week.error) throw new Error(await functionMessage(week.error, 'Could not reach AH. Try again.'))
      const failed = [staples, recipes, ingredients].find(r => r.error)
      if (failed) throw new Error(failed.error.message)

      const ingredientsMap = {}
      for (const ing of ingredients.data ?? []) (ingredientsMap[ing.recipe_id] ??= []).push(ing)
      const recipesMap = Object.fromEntries((recipes.data ?? []).map(r => [r.id, r]))

      setInputs({
        runDate: todayIn(household.timeZone),
        staples: staples.data ?? [],
        liveProducts: week.data?.products ?? {},
        mergedItems: mergeIngredients(recipeSelections, ingredientsMap, recipesMap, unitPrefs),
        adjustedItems,
        currentList: week.data?.list ?? [],
        skippedLookups: week.data?.skippedLookups ?? 0,
        checkedAt: new Date(),
      })
    } catch (err) {
      setError(err.message || 'Could not build the preview. Try again.')
    } finally {
      setLoading(false)
    }
  }, [household, recipeSelections, adjustedItems, unitPrefs])

  const preview = useMemo(() => {
    if (!inputs) return null
    const { skippedLookups, checkedAt, ...planInputs } = inputs
    return { ...buildWeekPreview({ ...planInputs, mappings }), skippedLookups, checkedAt }
  }, [inputs, mappings])

  const sendPlan = useMemo(() => toSendRequest(preview), [preview])

  // Sends the preview on screen. Returns true when AH was reached (done or partial).
  const send = useCallback(async () => {
    if (!sendPlan.request) return false
    setSending(true)
    setSendError(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('retailer-send', { body: sendPlan.request })
      if (fnError) throw new Error(await functionMessage(fnError, 'Could not send to AH. Check your AH list before trying again.'))
      setSendResult(data)
      return data?.status !== 'failed'
    } catch (err) {
      setSendError(err.message)
      return false
    } finally {
      setSending(false)
    }
  }, [sendPlan])

  return {
    available: household?.ahEnabled === true,
    preview, loading, error, run,
    // Sending (phase 6)
    isOwner: household?.role === 'owner',
    sendSwitchedOn: household?.sendEnabled === true,
    canSend: household?.ahEnabled === true && household?.sendEnabled === true && household?.role === 'owner',
    sendPlan, send, sending, sendResult, sendError,
  }
}
