import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGroupFeed } from '@/hooks/useGroupFeed'
import { Check, ChevronDown, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GROUP_LIMITS, checkGroupName, friendsToAdd } from '@/lib/social'

// Groups on the Social tab (docs/adr/0011, step G1): make a group of friends, see who is
// in your groups, and (as the creator) rename, add, remove or delete; others can leave.
// "You were added to…" shows until it's dismissed.

function Initial({ person }) {
  const [broken, setBroken] = useState(false)
  const letter = (person.display_name ?? '?')[0].toUpperCase()
  return person.avatar_url && !broken
    ? <img src={person.avatar_url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-8 w-8 shrink-0 rounded-full object-cover" />
    : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold" aria-hidden="true">{letter}</span>
}

async function run(promise, done) {
  const { message } = await promise
  if (message) { toast.error(message); return false }
  if (done) toast.success(done)
  return true
}

function NameForm({ initial = '', button, onSubmit, onCancel }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  async function submit(e) {
    e.preventDefault()
    const check = checkGroupName(name)
    if (!check.ok) { setMessage(check.message); return }
    setBusy(true)
    const ok = await onSubmit(check.name)
    setBusy(false)
    if (ok && !initial) setName('')
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input value={name} maxLength={GROUP_LIMITS.name + 10} onChange={(e) => { setName(e.target.value); setMessage(null) }}
          placeholder="Group name, like Family" aria-label="Group name" className="h-11 rounded-full" />
        <Button type="submit" disabled={busy} className="h-11 rounded-full px-4 font-semibold">{button}</Button>
        {onCancel && <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={onCancel}>Cancel</Button>}
      </div>
      {message && <p className="text-[13px] text-destructive">{message}</p>}
    </form>
  )
}

const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// "Recent in <group>" (step G4): shares in the group and members' recent uploads.
function GroupFeed({ group }) {
  const items = useGroupFeed(group)
  const navigate = useNavigate()
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">Recent in {group.name}</h4>
      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. Share a recipe with {group.name} from its Share button.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map(i => (
            <li key={i.key} className="text-[15px]">
              <span className="font-semibold">{i.by.display_name}</span> {i.kind === 'shared' ? 'shared' : 'added'}{' '}
              <button type="button" onClick={() => navigate('/recipes', { state: { openRecipeId: i.recipeId } })}
                className="font-semibold text-primary-text underline underline-offset-2 hover:opacity-80">{i.recipeName}</button>
              <span className="text-[13px] text-muted-foreground"> · {when(i.at)}</span>
              {i.note && <span className="block text-[13px] text-muted-foreground">“{i.note}”</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GroupRow({ group, friends, actions }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState([])
  const [confirm, setConfirm] = useState(null) // 'delete' | 'leave' | user_id
  const candidates = friendsToAdd(friends, group.members)
  const room = GROUP_LIMITS.members - group.members.length

  async function addPicked() {
    if (await run(actions.addMembers(group.id, picked), `Added to ${group.name}.`)) { setPicked([]); setAdding(false) }
  }

  return (
    <li className="py-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-text"><Users className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{group.name}</span>
          <span className="block text-[13px] text-muted-foreground">
            {group.members.length} {group.members.length === 1 ? 'person' : 'people'} · {group.mine ? 'made by you' : `made by ${group.owner.display_name}`}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 pl-0 sm:pl-[52px]">
          <GroupFeed group={group} />
          <h4 className="pt-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">People</h4>
          {renaming && (
            <NameForm initial={group.name} button="Save" onCancel={() => setRenaming(false)}
              onSubmit={async (name) => { const ok = await run(actions.renameGroup(group.id, name), 'Group renamed.'); if (ok) setRenaming(false); return ok }} />
          )}
          <ul className="flex flex-col gap-2">
            {group.members.map(m => (
              <li key={m.user_id} className="flex items-center gap-2.5">
                <Initial person={m} />
                <span className="min-w-0 flex-1 text-[15px]">{m.display_name}{m.user_id === group.created_by && <span className="text-[13px] text-muted-foreground"> · made the group</span>}</span>
                {group.mine && m.user_id !== group.created_by && (confirm === m.user_id ? (
                  <span className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button size="sm" variant="destructive" className="rounded-full"
                      onClick={() => { setConfirm(null); run(actions.removeMember(group.id, m.user_id), `${m.display_name} removed from ${group.name}.`) }}>Remove</Button>
                  </span>
                ) : (
                  <button type="button" aria-label={`Remove ${m.display_name} from ${group.name}`} onClick={() => setConfirm(m.user_id)}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                ))}
              </li>
            ))}
          </ul>

          {group.mine && adding && (
            <div className="rounded-[14px] border border-border p-3">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">All your friends are in this group already.</p>
              ) : (
                <>
                  <p className="mb-2 text-[13px] text-muted-foreground">Pick friends to add ({room} {room === 1 ? 'place' : 'places'} left).</p>
                  <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                    {candidates.map(f => {
                      const on = picked.includes(f.id)
                      return (
                        <li key={f.id}>
                          <button type="button" role="checkbox" aria-checked={on}
                            disabled={!on && picked.length >= room}
                            onClick={() => setPicked(p => (on ? p.filter(id => id !== f.id) : [...p, f.id]))}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50">
                            <span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                              {on && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <Initial person={f} />
                            <span>{f.display_name}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" className="rounded-full" onClick={() => { setAdding(false); setPicked([]) }}>Cancel</Button>
                {candidates.length > 0 && <Button className="rounded-full" disabled={picked.length === 0} onClick={addPicked}>Add {picked.length || ''}</Button>}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {group.mine ? (
              <>
                {!adding && room > 0 && <Button variant="outline" className="h-9 rounded-full" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add friends</Button>}
                {!renaming && <Button variant="outline" className="h-9 rounded-full" onClick={() => setRenaming(true)}><Pencil className="h-4 w-4" /> Rename</Button>}
                {confirm === 'delete' ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground">Delete {group.name} for everyone?</span>
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button size="sm" variant="destructive" className="rounded-full" onClick={() => run(actions.deleteGroup(group.id), `${group.name} deleted.`)}>Delete</Button>
                  </span>
                ) : (
                  <Button variant="ghost" className="h-9 rounded-full text-destructive" onClick={() => setConfirm('delete')}><Trash2 className="h-4 w-4" /> Delete group</Button>
                )}
              </>
            ) : confirm === 'leave' ? (
              <span className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">Leave {group.name}?</span>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setConfirm(null)}>Cancel</Button>
                <Button size="sm" variant="destructive" className="rounded-full" onClick={() => run(actions.leaveGroup(group.id), `You left ${group.name}.`)}>Leave</Button>
              </span>
            ) : (
              <Button variant="ghost" className="h-9 rounded-full" onClick={() => setConfirm('leave')}>Leave group</Button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export default function GroupsCard({ groups: g, friends }) {
  const { groups, loading, error } = g
  const madeByMe = groups.filter(x => x.mine).length
  const newOnes = groups.filter(x => !x.seen && !x.mine)

  return (
    <Card>
      <CardHeader><CardTitle className="text-[28px]">Groups{groups.length ? ` · ${groups.length}` : ''}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {newOnes.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-primary/40 bg-primary/10 px-4 py-3">
            <p className="min-w-0 flex-1 text-sm">
              {newOnes.map(x => `${x.owner.display_name} added you to ${x.name}`).join('. ')}.
            </p>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => g.markSeen(newOnes.map(x => x.id))}>OK</Button>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-input py-6 text-center text-sm text-muted-foreground">
            No groups yet. Make one for family or a group of friends; everyone in it can see who else is in it.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map(x => <GroupRow key={x.id} group={x} friends={friends} actions={g} />)}
          </ul>
        )}
        {madeByMe < GROUP_LIMITS.groupsPerPerson ? (
          <NameForm button="Make group" onSubmit={(name) => run(g.createGroup(name), `${name} made. Open it to add friends.`)} />
        ) : (
          <p className="text-[13px] text-muted-foreground">You can make up to {GROUP_LIMITS.groupsPerPerson} groups.</p>
        )}
      </CardContent>
    </Card>
  )
}
