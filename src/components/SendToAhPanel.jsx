import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

const ACTION_WORDS = { add: 'added', increase: 'raised', untick: 'unticked' }
const STATUS = {
  done: { icon: CheckCircle2, className: 'text-secondary', text: 'Sent to your AH list.' },
  partial: { icon: AlertTriangle, className: 'text-destructive', text: 'Partly sent: some items did not reach AH.' },
  failed: { icon: XCircle, className: 'text-destructive', text: 'Nothing reached AH.' },
}
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function Result({ result }) {
  const status = STATUS[result.status] ?? STATUS.failed
  const Icon = status.icon
  const written = result.lines.filter(l => l.outcome === 'written')
  const already = result.lines.filter(l => l.outcome === 'already_enough')
  const failed = result.lines.filter(l => l.outcome === 'failed')

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className={`flex items-center gap-2 font-medium ${status.className}`}>
        <Icon className="h-4 w-4" /> {status.text}
      </p>
      {written.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changed on AH · {written.length}</p>
          <ul className="mt-1 space-y-0.5">
            {written.map((l, i) => <li key={i}>{l.text} <span className="text-muted-foreground">· {ACTION_WORDS[l.action] ?? l.action} to {l.to}</span></li>)}
          </ul>
        </div>
      )}
      {failed.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Not sent · {failed.length}</p>
          <ul className="mt-1 space-y-0.5">
            {failed.map((l, i) => <li key={i}>{l.text} <span className="text-muted-foreground">· still due next time</span></li>)}
          </ul>
        </div>
      )}
      {already.length > 0 && (
        <p className="text-muted-foreground">Already on your AH list: {already.map(l => l.text).join(', ')}.</p>
      )}
      <p className="text-xs text-muted-foreground">
        {count(result.staplesUpdated, 'staple')} marked as bought. Pick a time slot and pay in the AH app. Refresh the preview to see the list as it is now.
      </p>
    </div>
  )
}

// "Send to AH list" under this week's preview (rollout phase 6). Shown to the household owner
// once the household's send_enabled switch is on; everyone else sees why it isn't there.
// Sending asks for a confirmation first, then shows what happened per line and leaves the
// preview as it was (Refresh shows the list as it is now).
export default function SendToAhPanel({ weekPreview }) {
  const { preview, canSend, isOwner, sendSwitchedOn, sendPlan, send, sending, sendResult, sendError, loading } = weekPreview
  const [confirming, setConfirming] = useState(false)

  if (!preview) return null
  if (!sendSwitchedOn) {
    return <p className="text-xs text-muted-foreground">Sending to AH is switched on after the dry run. Until then, add the items in the AH app yourself.</p>
  }
  if (!isOwner) {
    return <p className="text-xs text-muted-foreground">For now only the household owner can send this to AH.</p>
  }
  if (sendResult) return <Result result={sendResult} />

  const changes = preview.changes.length
  const tooMany = sendPlan.notSent

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      {sendError && <p className="text-destructive">{sendError}</p>}
      {tooMany.length > 0 && (
        <p className="text-destructive">
          Left out, more than 20 packs: {tooMany.map(l => `${l.text} (${l.quantity})`).join(', ')}. Add those in the AH app.
        </p>
      )}
      {!sendPlan.request ? (
        <p className="text-muted-foreground">Nothing to send this week.</p>
      ) : confirming ? (
        <>
          <p>
            <span className="font-medium">Send to your AH list?</span>{' '}
            {changes === 0
              ? 'Your AH list already has everything; this only marks the staples as bought.'
              : `This changes ${count(changes, 'item')} on your AH list.`}{' '}
            Nothing is removed or lowered. You still pick a time slot and pay in the AH app.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={sending || !canSend} onClick={async () => { await send(); setConfirming(false) }}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send now
            </Button>
            <Button size="sm" variant="ghost" disabled={sending} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground">Happy with this? Send it to your AH list.</p>
          <Button size="sm" disabled={loading || !canSend} onClick={() => setConfirming(true)}>
            <Send className="h-4 w-4" /> Send to AH list
          </Button>
        </div>
      )}
    </div>
  )
}
