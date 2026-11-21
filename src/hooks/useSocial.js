import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { socialErrorMessage } from '@/lib/social'

// The Social tab's data (docs/adr/0008): my friends, friend requests both ways and the
// invites I sent, with names and pictures from profiles. Tables are read directly (RLS:
// only rows I am part of); every change goes through a database function, whose errors
// come back as readable messages. Each action returns null on success or a message.
export function useSocial() {
  const { session } = useAuth()
  const me = session?.user?.id
  const [friends, setFriends] = useState([])     // [{ id, display_name, avatar_url, since }]
  const [incoming, setIncoming] = useState([])   // [{ id, display_name, avatar_url, created_at }]
  const [outgoing, setOutgoing] = useState([])   // same shape
  const [invites, setInvites] = useState([])     // invites rows I sent
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!me) return
    const [f, r, i] = await Promise.all([
      supabase.from('friendships').select('friend_id, created_at').eq('user_id', me),
      supabase.from('friend_requests').select('from_user, to_user, created_at'),
      supabase.from('invites').select('id, email, created_at, expires_at, accepted_at, revoked_at')
        .eq('invited_by', me).order('created_at', { ascending: false }),
    ])
    const failed = f.error || r.error || i.error
    if (failed) { setError(failed.message); setLoading(false); return }

    const ids = [...new Set([
      ...(f.data ?? []).map(x => x.friend_id),
      ...(r.data ?? []).flatMap(x => [x.from_user, x.to_user]),
    ])].filter(id => id !== me)
    let people = {}
    if (ids.length > 0) {
      const { data } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids)
      people = Object.fromEntries((data ?? []).map(p => [p.id, p]))
    }
    const person = (id) => ({ id, display_name: people[id]?.display_name ?? 'Someone', avatar_url: people[id]?.avatar_url ?? null })

    setFriends((f.data ?? []).map(x => ({ ...person(x.friend_id), since: x.created_at }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name)))
    setIncoming((r.data ?? []).filter(x => x.to_user === me).map(x => ({ ...person(x.from_user), created_at: x.created_at })))
    setOutgoing((r.data ?? []).filter(x => x.from_user === me).map(x => ({ ...person(x.to_user), created_at: x.created_at })))
    setInvites(i.data ?? [])
    setError(null)
    setLoading(false)
  }, [me])

  useEffect(() => { load() }, [load])

  // Runs a database function, then reloads. → { message } on failure, { data } on success.
  const call = useCallback(async (fn, args) => {
    const { data, error: rpcError } = await supabase.rpc(fn, args)
    if (rpcError) return { message: socialErrorMessage(rpcError.message) }
    await load()
    return { data }
  }, [load])

  return {
    me, friends, incoming, outgoing, invites, loading, error, reload: load,
    invite: (email) => call('create_invite', { p_email: email }),
    revokeInvite: (id) => call('revoke_invite', { p_invite: id }),
    requestFriend: (email) => call('request_friend', { p_email: email }),
    answerRequest: (fromId, accept) => call('answer_friend_request', { p_from: fromId, p_accept: accept }),
    removeFriend: (id) => call('remove_friend', { p_friend: id }),
  }
}

// Just my friends' ids, for the Recipes tab's "Friends' recipes" filter.
export function useFriendIds() {
  const { session } = useAuth()
  const me = session?.user?.id
  const [ids, setIds] = useState([])
  useEffect(() => {
    if (!me) return
    let cancelled = false
    supabase.from('friendships').select('friend_id').eq('user_id', me).then(({ data }) => {
      if (!cancelled) setIds((data ?? []).map(x => x.friend_id))
    })
    return () => { cancelled = true }
  }, [me])
  return ids
}
