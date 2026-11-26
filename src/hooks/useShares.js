import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { socialErrorMessage } from '@/lib/social'

// Recipe shares (docs/adr/0008): recipes friends recommended to me, with the recipe and
// the sender's name, newest first. RLS lets me read shares I sent or received; changes go
// through share_recipe() / mark_shares_seen(), and I can delete a share myself.
export function useSharedWithMe() {
  const { session } = useAuth()
  const me = session?.user?.id
  const [shares, setShares] = useState([])
  const [coverUrls, setCoverUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!me) return
    const { data, error: loadError } = await supabase
      .from('recipe_shares')
      .select('id, note, created_at, seen_at, from_user, group:social_groups(name), recipe:recipes(id, name, filename, cover_path, cook_time_minutes, prep_time_minutes, servings, status)')
      .eq('to_user', me)
      .order('created_at', { ascending: false })
    if (loadError) { setError(loadError.message); setLoading(false); return }

    const senderIds = [...new Set((data ?? []).map(s => s.from_user))]
    let people = {}
    if (senderIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', senderIds)
      people = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
    }
    const rows = (data ?? []).filter(s => s.recipe).map(s => ({
      ...s,
      from: { id: s.from_user, display_name: people[s.from_user]?.display_name ?? 'A friend', avatar_url: people[s.from_user]?.avatar_url ?? null },
    }))
    setShares(rows)

    const paths = [...new Set(rows.map(s => s.recipe.cover_path).filter(Boolean))]
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from('recipe-pdfs').createSignedUrls(paths, 3600)
      setCoverUrls(Object.fromEntries((signed ?? []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])))
    }
    setError(null)
    setLoading(false)
  }, [me])

  useEffect(() => { load() }, [load])

  // Marks these shares as seen (they keep their "New" label until the next load).
  const markSeen = useCallback(async (ids) => {
    if (ids.length === 0) return
    await supabase.rpc('mark_shares_seen', { p_shares: ids })
    window.dispatchEvent(new Event('hft-shares-seen'))
  }, [])

  const remove = useCallback(async (id) => {
    const { error: deleteError } = await supabase.from('recipe_shares').delete().eq('id', id)
    if (deleteError) return deleteError.message
    setShares(list => list.filter(s => s.id !== id))
    return null
  }, [])

  return { shares, coverUrls, loading, error, reload: load, markSeen, remove }
}

/** Shares a recipe with friends and groups (step G2). → null on success, or a message to show. */
export async function shareRecipe(recipeId, friendIds, groupIds, note) {
  const { error } = await supabase.rpc('share_recipe_to', { p_recipe: recipeId, p_to: friendIds, p_groups: groupIds, p_note: note })
  return error ? socialErrorMessage(error.message) : null
}

// How many shares I haven't seen, for the Social tab's badge. Re-checked when the page
// changes, when the window gets focus, and when the Social page marks shares as seen.
export function useUnseenShareCount() {
  const { session } = useAuth()
  const me = session?.user?.id
  const location = useLocation()
  const [count, setCount] = useState(0)

  const check = useCallback(async () => {
    if (!me) return
    const { count: n } = await supabase
      .from('recipe_shares')
      .select('id', { count: 'exact', head: true })
      .eq('to_user', me)
      .is('seen_at', null)
    setCount(n ?? 0)
  }, [me])

  useEffect(() => { check() }, [check, location.pathname])
  useEffect(() => {
    window.addEventListener('focus', check)
    window.addEventListener('hft-shares-seen', check)
    return () => {
      window.removeEventListener('focus', check)
      window.removeEventListener('hft-shares-seen', check)
    }
  }, [check])

  return count
}
