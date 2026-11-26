import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Send, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSocial } from '@/hooks/useSocial'
import { useGroups } from '@/hooks/useGroups'
import { shareRecipe } from '@/hooks/useShares'
import { SHARE_NOTE_MAX, SHARE_RECIPIENTS_MAX, checkShareNote, shareRecipients } from '@/lib/social'

// "Share" on the recipe page: pick friends and/or groups (docs/adr/0011), add an optional note, send. A share is a
// recommendation (friends can already see every recipe) and includes only the recipe and
// its PDF, never a shopping list or AH data.
export default function SharePanel({ recipe, onClose }) {
  const { me, friends, loading } = useSocial()
  const { groups, loading: groupsLoading } = useGroups()
  const [picked, setPicked] = useState([])
  const [pickedGroups, setPickedGroups] = useState([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const noteCheck = checkShareNote(note)

  const toggle = (id) => setPicked(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  const toggleGroup = (id) => setPickedGroups(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  const recipients = shareRecipients({ me, friendIds: picked, groupIds: pickedGroups, groups })
  const tooMany = recipients.length > SHARE_RECIPIENTS_MAX

  async function send() {
    if (!noteCheck.ok || recipients.length === 0 || tooMany) return
    setBusy(true)
    const message = await shareRecipe(recipe.id, picked, pickedGroups, noteCheck.note)
    setBusy(false)
    if (message) { toast.error(message); return }
    const names = [
      ...groups.filter(g => pickedGroups.includes(g.id)).map(g => g.name),
      ...friends.filter(f => picked.includes(f.id)).map(f => f.display_name),
    ]
    toast.success(`Shared with ${names.join(', ')}`)
    onClose()
  }

  return (
    <div className="flex flex-col gap-4 rounded-[18px] border border-border bg-banner p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[22px] font-bold">Share this recipe</h2>
        <button type="button" onClick={onClose} aria-label="Close sharing" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading || groupsLoading ? (
        <p className="text-sm text-muted-foreground">Loading friends…</p>
      ) : friends.length === 0 && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no friends in the app yet. <Link to="/social" className="font-semibold text-primary-text underline">Invite or add someone on the Social tab.</Link>
        </p>
      ) : (
        <>
          {groups.length > 0 && (
            <div role="group" aria-label="Share with a group" className="flex flex-wrap gap-2">
              {groups.map(g => {
                const on = pickedGroups.includes(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGroup(g.id)}
                    className={`flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-medium transition-colors ${
                      on ? 'border-foreground bg-foreground text-background' : 'border-input bg-card hover:bg-accent'
                    }`}
                  >
                    {on ? <Check className="h-4 w-4" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />} {g.name}
                    <span className="text-[13px] opacity-70">· {g.members.length - 1}</span>
                  </button>
                )
              })}
            </div>
          )}
          <div role="group" aria-label="Share with" className="flex flex-wrap gap-2">
            {friends.map(f => {
              const on = picked.includes(f.id)
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(f.id)}
                  className={`flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-medium transition-colors ${
                    on ? 'border-foreground bg-foreground text-background' : 'border-input bg-card hover:bg-accent'
                  }`}
                >
                  {on && <Check className="h-4 w-4" aria-hidden="true" />} {f.display_name}
                </button>
              )
            })}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="share-note" className="text-sm font-medium">Note (optional)</label>
            <textarea
              id="share-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Doubled the garlic. Worth it."
              className="rounded-xl border border-input bg-card px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
            />
            <p className={`text-xs ${noteCheck.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
              {noteCheck.ok ? `${note.trim().length} / ${SHARE_NOTE_MAX}` : noteCheck.message}
            </p>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {tooMany ? `That's ${recipients.length} people; one share can reach ${SHARE_RECIPIENTS_MAX}. ` : ''}
            They see the recipe and its PDF, never your shopping list or AH order.
          </p>
          <div className="flex gap-2">
            <Button onClick={send} disabled={busy || recipients.length === 0 || tooMany || !noteCheck.ok} className="h-11 rounded-full px-5 font-semibold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Share{recipients.length > 1 ? ` with ${recipients.length} people` : ''}
            </Button>
            <Button variant="ghost" onClick={onClose} className="h-11 rounded-full px-5">Cancel</Button>
          </div>
        </>
      )}
    </div>
  )
}
