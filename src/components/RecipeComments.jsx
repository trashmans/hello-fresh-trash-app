import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useGroups } from '@/hooks/useGroups'
import { useRecipeComments } from '@/hooks/useRecipeComments'
import { COMMENT_MAX, checkComment } from '@/lib/social'

const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// Comments on the recipe page (docs/adr/0011, step G5): one group's comments at a time,
// seen only by that group's members. The author or the group's creator can delete one.
export default function RecipeComments({ recipe }) {
  const { me, groups, loading } = useGroups()
  const [groupId, setGroupId] = useState(null)
  useEffect(() => {
    if (!groups.length) { setGroupId(null); return }
    setGroupId(id => (id && groups.some(g => g.id === id) ? id : groups[0].id))
  }, [groups])
  const group = groups.find(g => g.id === groupId) ?? null
  const { comments, error, add, remove } = useRecipeComments(recipe.status === 'ready' ? recipe.id : null, groupId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const check = checkComment(text)

  if (loading || recipe.status !== 'ready') return null

  async function post(e) {
    e.preventDefault()
    if (!check.ok) return
    setBusy(true)
    const message = await add(check.body)
    setBusy(false)
    if (message) toast.error(message)
    else setText('')
  }

  async function del(id) {
    const message = await remove(id)
    if (message) toast.error(message)
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Comments">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-[22px] font-bold">Comments</h2>
        {groups.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Group</span>
            <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
              className="h-9 rounded-full border border-input bg-card px-3 text-sm font-semibold">
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {!group ? (
        <p className="text-sm text-muted-foreground">
          Comments are shared within a group. <Link to="/social" className="font-semibold text-primary-text underline">Make a group on the Social tab</Link> to talk about recipes together.
        </p>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">Only people in {group.name} see these.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {comments === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments in {group.name} yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.map(c => (
                <li key={c.id} className="rounded-[14px] border border-border bg-card px-4 py-3">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-sm"><span className="font-semibold">{c.by.display_name}</span> <span className="text-muted-foreground">· {when(c.created_at)}</span></p>
                    {(c.author === me || group.created_by === me) && (
                      <button type="button" aria-label="Delete comment" onClick={() => del(c.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-[15px]">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={post} className="flex flex-col gap-1.5">
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Comment in ${group.name}`}
              placeholder={`Say something to ${group.name}…`}
              className="rounded-xl border border-input bg-card px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring" />
            <div className="flex items-center gap-3">
              <p className={`flex-1 text-xs ${check.ok || !text.trim() ? 'text-muted-foreground' : 'text-destructive'}`}>
                {check.ok || !text.trim() ? `${text.trim().length} / ${COMMENT_MAX}` : check.message}
              </p>
              <Button type="submit" disabled={busy || !check.ok} className="h-10 rounded-full px-4 font-semibold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Post
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
