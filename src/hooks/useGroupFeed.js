import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { GROUP_FEED, buildGroupFeed } from '@/lib/social'

// "Recent in <group>" (docs/adr/0011, step G4), from data I can already read: my own
// copies of shares made in the group (each member gets one; RLS: shares I sent or got)
// recent recipes uploaded by its members (the shared catalogue), and the group's comments (G5).
export function useGroupFeed(group) {
  const [items, setItems] = useState(null) // null while loading
  const memberKey = (group?.members ?? []).map(m => m.user_id).sort().join(',')

  useEffect(() => {
    if (!group?.id) return undefined
    let cancelled = false
    const memberIds = memberKey ? memberKey.split(',') : []
    const since = new Date(Date.now() - GROUP_FEED.uploadDays * 24 * 60 * 60 * 1000).toISOString()
    Promise.all([
      supabase.from('recipe_shares').select('id, recipe_id, from_user, group_id, note, created_at, recipe:recipes(id, name)')
        .eq('group_id', group.id).order('created_at', { ascending: false }).limit(60),
      memberIds.length
        ? supabase.from('recipes').select('id, name, uploaded_by, created_at, status')
          .in('uploaded_by', memberIds).eq('status', 'ready').gte('created_at', since)
          .order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
      supabase.from('recipe_group_comments').select('id, group_id, recipe_id, author, body, created_at, recipe:recipes(id, name)')
        .eq('group_id', group.id).order('created_at', { ascending: false }).limit(GROUP_FEED.max),
    ]).then(([shares, recipes, comments]) => {
      if (cancelled) return
      setItems(buildGroupFeed({ groupId: group.id, members: group.members, shares: shares.data ?? [], recipes: recipes.data ?? [], comments: comments.data ?? [] }))
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, memberKey])

  return items
}
