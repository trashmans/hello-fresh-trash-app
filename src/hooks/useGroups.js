import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { socialErrorMessage } from '@/lib/social'

// Social groups (docs/adr/0011): the groups I'm in, with their members' names. Tables are
// read directly (RLS: only groups I'm in); every change goes through a database function.
// Each action returns { message } on failure, { data } on success, then reloads.
export function useGroups() {
  const { session } = useAuth()
  const me = session?.user?.id
  const [groups, setGroups] = useState([]) // [{ id, name, created_by, created_at, mine, owner, members: [{ user_id, display_name, avatar_url, added_at }], seen }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!me) return
    const [g, m] = await Promise.all([
      supabase.from('social_groups').select('id, name, created_by, created_at').order('created_at'),
      supabase.from('social_group_members').select('group_id, user_id, added_at, seen_at'),
    ])
    const failed = g.error || m.error
    if (failed) { setError(failed.message); setLoading(false); return }

    const ids = [...new Set((m.data ?? []).map(r => r.user_id))]
    let people = {}
    if (ids.length > 0) {
      const { data } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids)
      people = Object.fromEntries((data ?? []).map(p => [p.id, p]))
    }
    const person = (id) => ({ display_name: people[id]?.display_name ?? 'Someone', avatar_url: people[id]?.avatar_url ?? null })

    setGroups((g.data ?? []).map(group => {
      const rows = (m.data ?? []).filter(r => r.group_id === group.id)
      const members = rows
        .map(r => ({ user_id: r.user_id, added_at: r.added_at, ...person(r.user_id) }))
        .sort((a, b) => (a.user_id === group.created_by ? -1 : b.user_id === group.created_by ? 1 : a.display_name.localeCompare(b.display_name)))
      const mine = rows.find(r => r.user_id === me)
      return { ...group, mine: group.created_by === me, owner: person(group.created_by), members, seen: Boolean(mine?.seen_at) }
    }))
    setError(null)
    setLoading(false)
  }, [me])

  useEffect(() => { load() }, [load])

  const call = useCallback(async (fn, args) => {
    const { data, error: rpcError } = await supabase.rpc(fn, args)
    if (rpcError) return { message: socialErrorMessage(rpcError.message) }
    await load()
    return { data }
  }, [load])

  return {
    me, groups, loading, error, reload: load,
    createGroup: (name) => call('create_group', { p_name: name }),
    renameGroup: (id, name) => call('rename_group', { p_group: id, p_name: name }),
    deleteGroup: (id) => call('delete_group', { p_group: id }),
    addMembers: (id, userIds) => call('add_group_members', { p_group: id, p_users: userIds }),
    removeMember: (id, userId) => call('remove_group_member', { p_group: id, p_user: userId }),
    leaveGroup: (id) => call('leave_group', { p_group: id }),
    markSeen: (ids) => call('mark_groups_seen', { p_groups: ids }),
  }
}
