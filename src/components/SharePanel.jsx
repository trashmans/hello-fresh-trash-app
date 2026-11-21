import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSocial } from '@/hooks/useSocial'
import { shareRecipe } from '@/hooks/useShares'
import { SHARE_NOTE_MAX, checkShareNote } from '@/lib/social'

// "Share" on the recipe page: pick friends, add an optional note, send. A share is a
// recommendation (friends can already see every recipe) and includes only the recipe and
// its PDF, never a shopping list or AH data.
export default function SharePanel({ recipe, onClose }) {
  const { friends, loading } = useSocial()
  const [picked, setPicked] = useState([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const noteCheck = checkShareNote(note)

  const toggle = (id) => setPicked(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))

  async function send() {
    if (!noteCheck.ok || picked.length === 0) return
    setBusy(true)
    const message = await shareRecipe(recipe.id, picked, noteCheck.note)
    setBusy(false)
    if (message) { toast.error(message); return }
    const names = friends.filter(f => picked.includes(f.id)).map(f => f.display_name)
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

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading friends…</p>
      ) : friends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no friends in the app yet. <Link to="/social" className="font-semibold text-primary-text underline">Invite or add someone on the Social tab.</Link>
        </p>
      ) : (
        <>
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
          <p className="text-[13px] text-muted-foreground">They see the recipe and its PDF, never your shopping list or AH order.</p>
          <div className="flex gap-2">
            <Button onClick={send} disabled={busy || picked.length === 0 || !noteCheck.ok} className="h-11 rounded-full px-5 font-semibold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Share{picked.length > 1 ? ` with ${picked.length}` : ''}
            </Button>
            <Button variant="ghost" onClick={onClose} className="h-11 rounded-full px-5">Cancel</Button>
          </div>
        </>
      )}
    </div>
  )
}
