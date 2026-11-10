import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAhLink } from '@/hooks/useAhLink'
import { AH_LOGIN_URL, checkPastedLink, formatLinkDate, linkStatusView } from '@/lib/ahLink'

// Link / unlink an Albert Heijn account (shown on the Automated ordering tab).
const TONES = {
  linked: 'bg-secondary text-secondary-foreground',
  relink_needed: 'bg-destructive text-destructive-foreground',
  not_linked: 'bg-muted text-muted-foreground',
  unavailable: 'bg-muted text-muted-foreground',
}

export default function AlbertHeijnCard() {
  const { ahEnabled, status, loading, busy, error, link, unlink } = useAhLink()
  const [pasted, setPasted] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const view = linkStatusView(status, { ahEnabled })
  const check = checkPastedLink(pasted)
  const linkedAt = formatLinkDate(status?.linkedAt)
  const lastUsed = formatLinkDate(status?.lastRefreshAt)

  async function copyLoginLink() {
    try {
      await navigator.clipboard.writeText(AH_LOGIN_URL)
      toast.success('Login link copied')
    } catch {
      toast.error('Could not copy — select the link and copy it by hand')
    }
  }

  async function handleLink() {
    if (await link(pasted)) {
      setPasted('')
      toast.success('Albert Heijn linked')
    }
  }

  async function handleUnlink() {
    if (!confirmUnlink) { setConfirmUnlink(true); return }
    setConfirmUnlink(false)
    if (await unlink()) toast.success('Albert Heijn unlinked')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">Albert Heijn</CardTitle>
          {!loading && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[view.state]}`}>{view.title}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        {loading ? (
          <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your link…</p>
        ) : (
          <>
            <p className="text-muted-foreground">{view.description}</p>
            {view.state === 'linked' && (
              <p>Linked since {linkedAt ?? 'unknown'}{lastUsed ? `, last used ${lastUsed}` : ''}.</p>
            )}

            {view.showLinkForm && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <p className="font-medium">Link your account (on a computer, in Chrome)</p>
                <ol className="list-decimal space-y-1.5 pl-5">
                  <li>Open a new Chrome tab and open DevTools (<kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd>), then the <strong>Console</strong> tab.</li>
                  <li>
                    Open the AH login link in that tab and log in to Albert Heijn:
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={copyLoginLink}><Copy className="h-3.5 w-3.5" /> Copy login link</Button>
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={AH_LOGIN_URL} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open login page</a>
                      </Button>
                    </div>
                  </li>
                  <li>After logging in, the page keeps loading and the Console shows a red error with a link starting <code>appie://login-exit?code=</code>.</li>
                  <li>Copy that link (or the whole error) and paste it below within a few minutes — the code expires.</li>
                </ol>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="appie://login-exit?code=…"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label="Pasted appie login link"
                />
                {check.message && <p className="text-xs text-destructive">{check.message}</p>}
                <Button type="button" onClick={handleLink} disabled={!check.ok || busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Link Albert Heijn
                </Button>
                <p className="text-xs text-muted-foreground">
                  By linking, you allow Hello Fresh Trash to add items to your AH shopping list for your household. We store an
                  encrypted login token, never your AH password, and you can unlink at any time. See the{' '}
                  <Link to="/privacy" className="underline">privacy policy</Link>.
                </p>
              </div>
            )}

            {view.showUnlink && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant={confirmUnlink ? 'destructive' : 'outline'} onClick={handleUnlink} disabled={busy}>
                  {confirmUnlink ? 'Click again to unlink' : 'Unlink Albert Heijn'}
                </Button>
                {confirmUnlink && (
                  <Button type="button" variant="ghost" onClick={() => setConfirmUnlink(false)}>Cancel</Button>
                )}
                <p className="w-full text-xs text-muted-foreground">Unlinking deletes the saved login straight away. Items already on your AH list stay there.</p>
              </div>
            )}

            {error && <p className="text-destructive">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
