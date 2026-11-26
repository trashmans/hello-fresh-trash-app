import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { socialErrorMessage } from '@/lib/social'

// Group comments on a recipe (docs/adr/0011, step G5): the comments in one group, oldest
// first, with authors' names. RLS: members of the group only. Changes go through
// add_group_comment() / delete_group_comment(); each returns null or a message.
export function useRecipeComments(recipeId, groupId) {
  const [comments, setComments] = useState(null) // null while loading
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!recipeId || !groupId) { setComments([]); return }
    const { data, error: loadError } = await supabase.from('recipe_group_comments')
      .select('id, author, body, created_at').eq('recipe_id', recipeId).eq('group_id', groupId)
      .order('created_at').limit(200)
    if (loadError) { setError(loadError.message); setComments([]); return }
    const ids = [...new Set((data ?? []).map(c => c.author))]
    let people = {}
    if (ids.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids)
      people = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
    }
    setComments((data ?? []).map(c => ({ ...c, by: { display_name: people[c.author]?.display_name ?? 'Someone', avatar_url: people[c.author]?.avatar_url ?? null } })))
    setError(null)
  }, [recipeId, groupId])

  useEffect(() => { setComments(null); load() }, [load])

  const add = useCallback(async (body) => {
    const { error: rpcError } = await supabase.rpc('add_group_comment', { p_group: groupId, p_recipe: recipeId, p_body: body })
    if (rpcError) return socialErrorMessage(rpcError.message)
    await load()
    return null
  }, [groupId, recipeId, load])

  const remove = useCallback(async (id) => {
    const { error: rpcError } = await supabase.rpc('delete_group_comment', { p_comment: id })
    if (rpcError) return socialErrorMessage(rpcError.message)
    await load()
    return null
  }, [load])

  return { comments, error, add, remove }
}
