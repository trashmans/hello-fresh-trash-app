import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Check, Copy, FileText, Loader2, Mail, Plus, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useSocial } from '@/hooks/useSocial'
import { useGroups } from '@/hooks/useGroups'
import GroupsCard from '@/components/GroupsCard'
import FoodPhotosCard from '@/components/FoodPhotosCard'
import { useSharedWithMe } from '@/hooks/useShares'
import { useAuth } from '@/context/AuthContext'
import { INVITE_DAYS, checkInviteEmail, inviteMessage, inviteStatus, invitesLeftToday } from '@/lib/social'

const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function Avatar({ person, size = 'h-11 w-11' }) {
  const [broken, setBroken] = useState(false)
  const initial = (person.display_name ?? '?')[0].toUpperCase()
  return person.avatar_url && !broken ? (
    <img src={person.avatar_url} alt="" onError={() => setBroken(true)} className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-muted font-bold text-foreground`} aria-hidden="true">{initial}</span>
  )
}

// Email invite / Copy invite for one invite. The app sends no email (docs/adr/0008),
// so the inviter sends this message themselves.
function InviteActions({ message, size = 'sm' }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text)
      toast.success('Invite copied. Paste it into a message to them.')
    } catch {
      toast.error('Could not copy. Use Email invite instead.')
    }
  }
  const cls = size === 'sm'
    ? 'inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-primary-text underline underline-offset-2'
    : null
  return size === 'sm' ? (
    <>
      <a href={message.mailto} className={cls}><Mail className="h-3.5 w-3.5" aria-hidden="true" />Email</a>
      <button type="button" onClick={copy} className={cls}><Copy className="h-3.5 w-3.5" aria-hidden="true" />Copy</button>
    </>
  ) : (
    <div className="flex flex-wrap gap-2">
      <Button asChild className="h-10 rounded-full px-4 font-semibold">
        <a href={message.mailto}><Mail className="h-4 w-4" /> Email invite</a>
      </Button>
      <Button type="button" variant="outline" onClick={copy} className="h-10 rounded-full px-4 font-semibold">
        <Copy className="h-4 w-4" /> Copy invite
      </Button>
    </div>
  )
}

// One email box with a button; checks the address before calling onSubmit(email).
function EmailForm({ label, button, icon: Icon, onSubmit, disabled, hint }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  async function submit(e) {
    e.preventDefault()
    const check = checkInviteEmail(email)
    if (!check.ok) { setMessage(check.message); return }
    setBusy(true)
    setMessage(null)
    const ok = await onSubmit(check.email)
    setBusy(false)
    if (ok) setEmail('')
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="text-sm font-medium" htmlFor={`email-${button}`}>{label}</label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`email-${button}`}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setMessage(null) }}
          placeholder="name@example.com"
          className="h-11 min-w-0 flex-[1_1_200px] rounded-xl border border-input bg-card px-3 text-base outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" disabled={busy || disabled || !email.trim()} className="h-11 rounded-full px-5 font-semibold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />} {button}
        </Button>
      </div>
      {message && <p className="text-sm text-destructive">{message}</p>}
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </form>
  )
}

// "Shared with you": recipes friends recommended, newest first, with their note.
// Opening the page marks them as seen; they keep their "New" label until the next visit.
function SharedWithYou({ shoppingList }) {
  const navigate = useNavigate()
  const { shares, coverUrls, loading, markSeen, remove } = useSharedWithMe()
  const [newIds, setNewIds] = useState(null)

  useEffect(() => {
    if (loading || newIds !== null) return
    const unseen = shares.filter(s => !s.seen_at).map(s => s.id)
    setNewIds(unseen)
    markSeen(unseen)
  }, [loading, shares, newIds, markSeen])

  const minutes = (r) => (r.cook_time_minutes ?? 0) + (r.prep_time_minutes ?? 0)

  return (
    <Card>
      <CardHeader><CardTitle className="text-[28px]">Shared with you{shares.length ? ` · ${shares.length}` : ''}</CardTitle></CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shares.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-input py-8 text-center text-sm text-muted-foreground">
            Nothing yet. When a friend shares a recipe with you, it shows up here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shares.map(s => {
              const r = s.recipe
              const inList = shoppingList.selectedIds.includes(r.id)
              const isNew = newIds?.includes(s.id)
              return (
                <li key={s.id} className="flex flex-col gap-3 py-4">
                  <div className="flex items-center gap-2.5 text-sm">
                    <Avatar person={s.from} size="h-8 w-8" />
                    <span><span className="font-semibold">{s.from.display_name}</span> <span className="text-muted-foreground">shared{s.group?.name ? ` in ${s.group.name}` : ''} · {dateLabel(s.created_at)}</span></span>
                    {isNew && <span className="rounded-full bg-badge px-2 py-0.5 text-xs font-bold text-badge-foreground">New</span>}
                    <button type="button" aria-label={`Remove this share of ${r.name ?? r.filename}`}
                      onClick={async () => { const m = await remove(s.id); if (m) toast.error(m) }}
                      className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <button type="button" onClick={() => navigate('/recipes', { state: { openRecipeId: r.id } })}
                      className="flex min-w-0 flex-[1_1_240px] items-center gap-3 text-left">
                      <span className="flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-muted">
                        {coverUrls[r.cover_path]
                          ? <img src={coverUrls[r.cover_path]} alt="" className="h-full w-full object-cover" />
                          : <FileText className="h-6 w-6 text-muted-foreground" aria-hidden="true" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[17px] font-semibold leading-snug">{r.name ?? r.filename}</span>
                        <span className="block text-[13px] text-muted-foreground">
                          {[minutes(r) ? `${minutes(r)} min` : null, r.servings ? `Serves ${r.servings}` : null].filter(Boolean).join(' · ')}
                        </span>
                        {s.note && <span className="mt-1 block whitespace-pre-line text-[15px] italic">“{s.note}”</span>}
                      </span>
                    </button>
                    <div className="flex gap-2">
                      <Button variant="outline" className="h-10 rounded-full px-4 font-semibold"
                        onClick={() => navigate('/recipes', { state: { openRecipeId: r.id } })}>
                        Open
                      </Button>
                      <Button
                        className={`h-10 rounded-full px-4 font-semibold ${inList ? 'bg-secondary text-secondary-foreground hover:bg-secondary/90' : ''}`}
                        onClick={() => shoppingList.toggleRecipe(r)}
                        aria-pressed={inList}
                      >
                        {inList ? <><Check className="h-4 w-4" /> In this week</> : <><Plus className="h-4 w-4" /> Add to this week</>}
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// Social tab (docs/adr/0008): recipes friends shared with you, invite people, add and
// answer friends. Friends never see a shopping list or AH data.
export default function Social() {
  const { shoppingList } = useOutletContext()
  const social = useSocial()
  const groups = useGroups()
  const { friends, incoming, outgoing, invites, loading, error } = social
  const now = new Date()
  const left = invitesLeftToday(invites, now)
  const openInvites = invites.filter((i) => inviteStatus(i, now) === 'pending')
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [justInvited, setJustInvited] = useState(null)
  const { session } = useAuth()
  const inviterName = session?.user?.user_metadata?.full_name
  const messageFor = (i) => inviteMessage({ inviterName, email: i.email, appUrl: window.location.origin, expiresAt: i.expires_at })
  const newInvite = justInvited && openInvites.find((i) => i.email === justInvited)

  async function invite(email) {
    const { message } = await social.invite(email)
    if (message) { toast.error(message); return false }
    setJustInvited(email)
    toast.success(`${email} can now sign in. Send them the invite so they know.`)
    return true
  }

  async function addFriend(email) {
    const { message, data } = await social.requestFriend(email)
    if (message) { toast.error(message); return false }
    toast.success(data === 'friends' ? 'You are now friends.' : data === 'already_friends' ? 'You are already friends.' : 'Friend request sent.')
    return true
  }

  async function act(promise, done) {
    const { message } = await promise
    if (message) toast.error(message)
    else if (done) toast.success(done)
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-8 lg:px-6 lg:py-12">
      <div className="flex max-w-[760px] flex-col gap-2.5">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">Cook together</p>
        <h1 className="text-4xl sm:text-[52px] font-bold leading-[1.02] tracking-[-0.02em]">Social</h1>
        <p className="text-base text-muted-foreground">
          Share recipes with friends, and see theirs under Friends&apos; recipes on the Recipes tab. Use Share on a
          recipe&apos;s page. Friends never see your shopping list or AH order.
        </p>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7">
          <SharedWithYou shoppingList={shoppingList} />
          {incoming.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-[22px]">Friend requests · {incoming.length}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {incoming.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                      <Avatar person={p} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{p.display_name}</p>
                        <p className="text-[13px] text-muted-foreground">Asked {dateLabel(p.created_at)}</p>
                      </div>
                      <Button className="h-10 rounded-full bg-secondary px-4 font-semibold text-secondary-foreground hover:bg-secondary/90"
                        onClick={() => act(social.answerRequest(p.id, true), `You are now friends with ${p.display_name}.`)}>
                        <Check className="h-4 w-4" /> Accept
                      </Button>
                      <Button variant="ghost" className="h-10 rounded-full px-4" onClick={() => act(social.answerRequest(p.id, false))}>
                        Decline
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-[28px]">Friends{friends.length ? ` · ${friends.length}` : ''}</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : friends.length === 0 ? (
                <p className="rounded-[14px] border border-dashed border-input py-8 text-center text-sm text-muted-foreground">
                  No friends yet. Invite someone, or add a friend who already uses the app.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {friends.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                      <Avatar person={p} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{p.display_name}</p>
                        <p className="text-[13px] text-muted-foreground">Friends since {dateLabel(p.since)}</p>
                      </div>
                      {confirmRemove === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-muted-foreground">Remove?</span>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setConfirmRemove(null)}>Cancel</Button>
                          <Button size="sm" variant="destructive" className="rounded-full"
                            onClick={() => { setConfirmRemove(null); act(social.removeFriend(p.id), `${p.display_name} removed.`) }}>
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <button type="button" aria-label={`Remove ${p.display_name} as a friend`} onClick={() => setConfirmRemove(p.id)}
                          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {outgoing.length > 0 && (
                <p className="mt-4 text-[13px] text-muted-foreground">
                  Waiting for an answer: {outgoing.map((p) => p.display_name).join(', ')}
                </p>
              )}
            </CardContent>
          </Card>

          <GroupsCard groups={groups} friends={friends} />

          <FoodPhotosCard groups={groups.groups} />
        </div>

        <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-7">
          <Card>
            <CardHeader><CardTitle className="text-[22px]">Invite a friend</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <EmailForm
                label="Their email (the one they use with Google)"
                button="Invite"
                icon={Mail}
                onSubmit={invite}
                disabled={left === 0}
                hint={left === 0
                  ? 'You have used today’s invites. Try again tomorrow.'
                  : `Inviting lets them sign in for ${INVITE_DAYS} days. The app doesn’t email them, so send the invite yourself. ${left} left today. You will become friends when they sign in.`}
              />
              {newInvite && (
                <div className="space-y-2.5 rounded-xl bg-muted p-3">
                  <p className="text-sm">
                    <span className="font-semibold">Now send {newInvite.email} the invite.</span> The app doesn’t email them.
                  </p>
                  <InviteActions message={messageFor(newInvite)} size="lg" />
                </div>
              )}
              {openInvites.length > 0 && (
                <ul className="divide-y divide-border border-t border-border">
                  {openInvites.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{i.email}</span>
                      <span className="shrink-0 text-[13px] text-muted-foreground">until {dateLabel(i.expires_at)}</span>
                      <InviteActions message={messageFor(i)} />
                      <button type="button" className="shrink-0 text-[13px] font-semibold text-primary-text underline underline-offset-2"
                        onClick={() => { if (i.email === justInvited) setJustInvited(null); act(social.revokeInvite(i.id), 'Invite taken back.') }}>
                        Take back
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-[22px]">Add a friend</CardTitle></CardHeader>
            <CardContent>
              <EmailForm
                label="Someone who already uses the app"
                button="Add friend"
                icon={UserPlus}
                onSubmit={addFriend}
                hint="They get a request to accept."
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
