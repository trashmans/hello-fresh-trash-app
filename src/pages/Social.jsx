import { useState } from 'react'
import { Check, Loader2, Mail, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useSocial } from '@/hooks/useSocial'
import { INVITE_DAYS, checkInviteEmail, inviteStatus, invitesLeftToday } from '@/lib/social'

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

// Social tab (docs/adr/0008): invite people, add and answer friends. Sharing recipes
// (Shared with you) comes in the next step. Friends never see a shopping list or AH data.
export default function Social() {
  const social = useSocial()
  const { friends, incoming, outgoing, invites, loading, error } = social
  const now = new Date()
  const left = invitesLeftToday(invites, now)
  const openInvites = invites.filter((i) => inviteStatus(i, now) === 'pending')
  const [confirmRemove, setConfirmRemove] = useState(null)

  async function invite(email) {
    const { message } = await social.invite(email)
    if (message) { toast.error(message); return false }
    toast.success(`Invited ${email}. They can sign in with Google using that address.`)
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
          Invite friends and see their recipes under Friends&apos; recipes on the Recipes tab. Friends never see your
          shopping list or AH order.
        </p>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7">
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
        </div>

        <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-7">
          <Card>
            <CardHeader><CardTitle className="text-[22px]">Invite a friend</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <EmailForm
                label="Their email (the one they use with Google)"
                button="Send invite"
                icon={Mail}
                onSubmit={invite}
                disabled={left === 0}
                hint={left === 0
                  ? 'You have used today’s invites. Try again tomorrow.'
                  : `They can sign in once invited; the invite lasts ${INVITE_DAYS} days. ${left} left today. You will become friends when they sign in.`}
              />
              {openInvites.length > 0 && (
                <ul className="divide-y divide-border border-t border-border">
                  {openInvites.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{i.email}</span>
                      <span className="shrink-0 text-[13px] text-muted-foreground">until {dateLabel(i.expires_at)}</span>
                      <button type="button" className="shrink-0 text-[13px] font-semibold text-primary-text underline underline-offset-2"
                        onClick={() => act(social.revokeInvite(i.id), 'Invite taken back.')}>
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
