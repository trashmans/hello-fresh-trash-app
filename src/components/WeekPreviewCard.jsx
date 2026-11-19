import { useState } from 'react'
import { Link2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import IngredientMapForm from '@/components/IngredientMapForm'
import SendToAhPanel from '@/components/SendToAhPanel'
import { useWeekPreview } from '@/hooks/useWeekPreview'
import { AISLES } from '@/lib/aisles'
import ProductThumb from '@/components/ProductThumb'

const ACTION_LABEL = { add: 'Add', increase: 'Increase', untick: 'Untick' }
const SOURCE_LABEL = { staple: 'Staple', stockup: 'Bonus stock-up', recipe: 'Recipe' }

const weekLabel = (weekStart) =>
  new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const timeLabel = (date) => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// [{ aisle, items }] in shop-walking order, like the Shopping tab; empty aisles left out.
const byAisle = (items) =>
  AISLES.map(aisle => ({ aisle, items: items.filter(i => i.aisle === aisle) })).filter(group => group.items.length > 0)

function AisleHeading({ children }) {
  return <h4 className="pt-3 pb-1 text-xs font-semibold text-muted-foreground">{children}</h4>
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

// A recipe ingredient that is still a free-text line can be mapped to an AH product.
const canMap = (change) => change.productId == null && change.sources.includes('recipe')

// "Undo mapping" for one ingredient mapping ({ key, label }), as a text button.
function UndoMapping({ mapping, onUndo, children = 'Undo mapping' }) {
  return (
    <button
      type="button"
      className="underline underline-offset-2 hover:text-foreground"
      onClick={() => onUndo(mapping)}
      aria-label={`Undo the mapping for ${mapping.label}`}
    >
      {children}
    </button>
  )
}

function ChangeRow({ change, mapping, onMap, onUndo, children }) {
  const sources = [...new Set(change.sources)]
  return (
    <li className="py-2">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-16 shrink-0 rounded-md bg-secondary px-2 py-0.5 text-center text-xs font-medium text-secondary-foreground">
          {ACTION_LABEL[change.action] ?? change.action}
        </span>
        {change.productId != null
          ? <ProductThumb src={change.imageUrl} className="h-8 w-8" />
          : <span className="w-8 shrink-0" aria-hidden="true" />}
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
        {onMap && !mapping && (
          <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={onMap} aria-label={`Map ${change.title} to an AH product`}>
            <Link2 className="h-3.5 w-3.5" /> Map
          </Button>
        )}
      </div>
      {onUndo && change.mappedFrom.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-[7.5rem] text-xs text-muted-foreground">
          {change.mappedFrom.map(m => (
            <span key={m.key}>Mapped from {m.label} · <UndoMapping mapping={m} onUndo={onUndo} /></span>
          ))}
        </p>
      )}
      {children}
    </li>
  )
}

// "This week's preview" on the Automated ordering tab (rollout phase 5): a dry run of
// what the weekly shop would change on the household's AH list. Never sends anything.
// Hidden unless the household's ah_enabled switch is on.
export default function WeekPreviewCard({ shoppingList, ingredientMappings }) {
  const weekPreview = useWeekPreview(shoppingList, ingredientMappings.mappings)
  const { available, preview, loading, error, run, sending, canSend } = weekPreview
  const [mappingFor, setMappingFor] = useState(null) // text of the recipe line being mapped
  if (!available) return null

  // Removes one ingredient mapping; the line goes back to free text (or back on the list) at once.
  async function undoMapping({ key, label }) {
    const message = await ingredientMappings.remove(key)
    if (message) toast.error(`Could not undo the mapping for ${label}: ${message}`)
    else toast.success(`${label} is no longer mapped`)
  }
  const onUndo = ingredientMappings.available ? undoMapping : null

  const notIncluded = preview?.staples.filter(s => !s.included && s.reason !== 'missing_product') ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">This week's preview</CardTitle>
          <Button size="sm" onClick={run} disabled={loading || sending}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {preview ? 'Refresh' : 'Preview'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          What would change on your AH list for this week's recipes and the staples that are due.{' '}
          {canSend ? 'Nothing is sent until you press Send and confirm.' : 'A dry run: nothing is sent to AH.'}
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
                    <li key={r.staple_id ?? `q:${r.productId}:${r.name}`} className="rounded-md border border-destructive/40 px-3 py-2">
                      <span className="font-medium">{r.name}:</span>{' '}
                      {r.reason === 'check_quantity'
                        ? "couldn't work out how many packs the recipes need, so 1 is planned. Check the quantity."
                        : 'no AH product found. Edit the staple and pin a product.'}
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
                byAisle(preview.changes).map(({ aisle, items }) => (
                  <div key={aisle}>
                    <AisleHeading>{aisle}</AisleHeading>
                    <ul className="divide-y divide-border">
                      {items.map(c => (
                        <ChangeRow
                          key={c.productId ?? `t:${c.text}`}
                          change={c}
                          mapping={mappingFor === c.text}
                          onMap={canMap(c) && ingredientMappings.available ? () => setMappingFor(c.text) : null}
                          onUndo={onUndo}
                        >
                          {canMap(c) && mappingFor === c.text && (
                            <IngredientMapForm
                              name={c.text}
                              searchProducts={ingredientMappings.searchProducts}
                              onSave={ingredientMappings.save}
                              onUndo={undoMapping}
                              onDone={() => setMappingFor(null)}
                            />
                          )}
                        </ChangeRow>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </Section>

            {preview.onListAlready.length > 0 && (
              <Section title={`Already on your AH list · ${preview.onListAlready.length}`}>
                {byAisle(preview.onListAlready).map(({ aisle, items }) => (
                  <p key={aisle} className="text-muted-foreground">
                    <span className="font-medium text-foreground">{aisle}:</span>{' '}
                    {items.map((l, i) => (
                      <span key={l.productId ?? `t:${l.text}`}>
                        {i > 0 && ', '}
                        {l.title} × {l.quantity}
                        {onUndo && l.mappedFrom.map(m => (
                          <span key={m.key}> (<UndoMapping mapping={m} onUndo={onUndo}>undo mapping from {m.label}</UndoMapping>)</span>
                        ))}
                      </span>
                    ))}
                  </p>
                ))}
              </Section>
            )}

            {preview.atHome.length > 0 && (
              <Section title={`Always at home · ${preview.atHome.length}`}>
                <ul className="space-y-0.5">
                  {preview.atHome.map(l => (
                    <li key={l.key}>
                      {l.text}
                      <span className="text-muted-foreground">
                        {l.amount ? ` · ${l.amount}` : ''}
                        {onUndo && <> · <UndoMapping mapping={{ key: l.key, label: l.text }} onUndo={onUndo}>Undo</UndoMapping></>}
                      </span>
                    </li>
                  ))}
                </ul>
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

            <SendToAhPanel weekPreview={weekPreview} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
