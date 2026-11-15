import { Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useWeekPreview } from '@/hooks/useWeekPreview'

const ACTION_LABEL = { add: 'Add', increase: 'Increase', untick: 'Untick' }
const SOURCE_LABEL = { staple: 'Staple', stockup: 'Bonus stock-up', recipe: 'Recipe' }

const weekLabel = (weekStart) =>
  new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const timeLabel = (date) => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function Section({ title, children }) {
  return (
    <div>
      <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function ChangeRow({ change }) {
  const sources = [...new Set(change.sources)]
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 w-16 shrink-0 rounded-md bg-secondary px-2 py-0.5 text-center text-xs font-medium text-secondary-foreground">
        {ACTION_LABEL[change.action] ?? change.action}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{change.title}</p>
        <p className="text-xs text-muted-foreground">
          {[change.detail, ...sources.map(s => SOURCE_LABEL[s] ?? s)].filter(Boolean).join(' · ')}
          {change.action === 'untick' && ' · ticked off on your AH list now'}
        </p>
      </div>
      <span className="shrink-0 tabular-nums text-sm">
        {change.action === 'increase' ? `${change.from} → ${change.to}` : `× ${change.to}`}
      </span>
    </li>
  )
}

// "This week's preview" on the Automated ordering tab (rollout phase 5): a dry run of
// what the weekly shop would change on the household's AH list. Never sends anything.
// Hidden unless the household's ah_enabled switch is on.
export default function WeekPreviewCard({ shoppingList }) {
  const { available, preview, loading, error, run } = useWeekPreview(shoppingList)
  if (!available) return null

  const notIncluded = preview?.staples.filter(s => !s.included && s.reason !== 'missing_product') ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">This week's preview</CardTitle>
          <Button size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {preview ? 'Refresh' : 'Preview'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          A dry run: what would change on your AH list for this week's recipes and the staples that are due. Nothing is sent to AH.
        </p>

        {error && <p className="text-destructive">{error}</p>}

        {preview && (
          <>
            <p className="text-xs text-muted-foreground">
              Week of {weekLabel(preview.weekStart)} · checked at {timeLabel(preview.checkedAt)}. Refresh after changing staples or recipes.
            </p>

            {preview.review.length > 0 && (
              <Section title="Needs a look">
                <ul className="space-y-1">
                  {preview.review.map(r => (
                    <li key={r.staple_id} className="rounded-md border border-destructive/40 px-3 py-2">
                      <span className="font-medium">{r.name}:</span> no AH product found. Edit the staple and pin a product.
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={`Would change · ${preview.changes.length}`}>
              {preview.changes.length === 0 ? (
                <p className="rounded-md border border-dashed border-border py-4 text-center text-muted-foreground">
                  Nothing to change. Your AH list already covers this week.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {preview.changes.map(c => <ChangeRow key={c.productId ?? `t:${c.text}`} change={c} />)}
                </ul>
              )}
            </Section>

            {preview.onListAlready.length > 0 && (
              <Section title={`Already on your AH list · ${preview.onListAlready.length}`}>
                <p className="text-muted-foreground">
                  {preview.onListAlready.map(l => `${l.title} × ${l.quantity}`).join(', ')}
                </p>
              </Section>
            )}

            {notIncluded.length > 0 && (
              <Section title={`Staples not included · ${notIncluded.length}`}>
                <ul className="space-y-0.5">
                  {notIncluded.map(s => (
                    <li key={s.staple_id}>
                      {s.name} <span className="text-muted-foreground">· {s.reasonText}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {preview.skippedLookups > 0 && (
              <p className="text-xs text-muted-foreground">
                {preview.skippedLookups} staple {preview.skippedLookups === 1 ? 'search was' : 'searches were'} left out to keep the number of AH requests low.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
