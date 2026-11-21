import { useState } from 'react'
import { Home, Link2, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import IngredientMapForm from '@/components/IngredientMapForm'
import SendToAhPanel from '@/components/SendToAhPanel'
import SuggestMappingsPanel from '@/components/SuggestMappingsPanel'
import { unmappedLines } from '@/lib/mappingSuggestions'
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
  return <h4 className="pb-1 pt-4 text-[15px] font-semibold">{children}</h4>
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="pb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">{title}</h3>
      {children}
    </div>
  )
}

function RuleButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-sm font-semibold hover:bg-accent transition-colors"
    >
      {children}
    </button>
  )
}

function MapButton({ title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Map ${title} to an AH product`}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-input px-3 text-sm font-semibold hover:bg-accent transition-colors"
    >
      <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Map
    </button>
  )
}

// A recipe ingredient that is still a free-text line can be mapped to an AH product.
const canMap = (change) => change.productId == null && change.sources.includes('recipe')

// "Undo mapping" for one ingredient mapping ({ key, label }), as a text button.
function UndoMapping({ mapping, onUndo, children = 'Undo mapping' }) {
  return (
    <button
      type="button"
      className="font-semibold text-primary-text underline underline-offset-2 hover:opacity-80"
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
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-[76px] shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary-text">
          {ACTION_LABEL[change.action] ?? change.action}
        </span>
        {change.productId != null
          ? <ProductThumb src={change.imageUrl} className="h-10 w-10 rounded-[10px]" />
          : <span className="w-10 shrink-0" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{change.title}</p>
          <p className="text-[13px] text-muted-foreground">
            {[change.detail, ...sources.map(s => SOURCE_LABEL[s] ?? s)].filter(Boolean).join(' · ')}
            {change.action === 'untick' && ' · ticked off on your AH list now'}
          </p>
        </div>
        <span className="shrink-0 font-semibold tabular-nums">
          {change.action === 'increase' ? `${change.from} → ${change.to}` : `× ${change.to}`}
        </span>
        {onMap && !mapping && (
          <MapButton title={change.title} onClick={onMap} />
        )}
      </div>
      {onUndo && change.mappedFrom.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-0 sm:pl-[8.5rem] text-[13px] text-muted-foreground">
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
  const [suggesting, setSuggesting] = useState(false)
  if (!available) return null

  // Removes one ingredient mapping; the line goes back to free text (or back on the list) at once.
  async function undoMapping({ key, label }) {
    const message = await ingredientMappings.remove(key)
    if (message) toast.error(`Could not undo the mapping for ${label}: ${message}`)
    else toast.success(`${label} is no longer mapped`)
  }
  const onUndo = ingredientMappings.available ? undoMapping : null

  // The ingredient mappings behind a product line, for the "check the quantity" buttons.
  function mappedFromProduct(productId) {
    const line = [...(preview?.changes ?? []), ...(preview?.onListAlready ?? [])].find(l => l.productId === productId)
    return line?.mappedFrom ?? []
  }

  // Saved on the mappings, so this ingredient never needs the check again.
  async function chooseRule(from, rule, name) {
    const message = await ingredientMappings.setRule(from.map(m => m.key), rule)
    if (message) toast.error(`Could not save that for ${name}: ${message}`)
    else toast.success(`${name}: ${rule === 'per_recipe' ? '1 pack per recipe' : '1 pack for the week'} from now on`)
  }

  async function markAtHome(from, name) {
    for (const m of from) {
      const message = await ingredientMappings.save({
        ingredient_key: m.key, label: m.label, retailer: 'ah', product_external_id: null, pantry: true,
      })
      if (message) { toast.error(`Could not save that for ${name}: ${message}`); return }
    }
    toast.success(`${name}: always at home`)
  }

  const notIncluded = preview?.staples.filter(s => !s.included && s.reason !== 'missing_product') ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-[28px]">This week&apos;s preview</CardTitle>
          <Button variant="outline" className="h-11 rounded-full px-4 font-semibold" onClick={run} disabled={loading || sending}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {preview ? 'Refresh' : 'Preview'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
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
                    <li key={r.staple_id ?? `q:${r.productId}:${r.name}`} className="rounded-[14px] border border-primary/40 bg-primary/10 px-4 py-3">
                      <span className="font-medium">{r.name}:</span>{' '}
                      {r.reason === 'check_quantity'
                        ? "couldn't work out how many packs the recipes need, so 1 is planned. How much should be bought?"
                        : 'no AH product found. Edit the staple and pin a product.'}
                      {r.reason === 'check_quantity' && ingredientMappings.available && (() => {
                        const from = mappedFromProduct(r.productId)
                        if (from.length === 0) return null
                        return (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <RuleButton onClick={() => chooseRule(from, 'per_recipe', r.name)}>1 pack per recipe</RuleButton>
                            <RuleButton onClick={() => chooseRule(from, 'per_week', r.name)}>1 pack for the week</RuleButton>
                            <RuleButton onClick={() => markAtHome(from, r.name)}><Home className="h-3.5 w-3.5" aria-hidden="true" /> Always at home</RuleButton>
                          </div>
                        )
                      })()}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {ingredientMappings.available && (suggesting ? (
              <SuggestMappingsPanel preview={preview} ingredientMappings={ingredientMappings} onClose={() => setSuggesting(false)} />
            ) : unmappedLines(preview).length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-border bg-banner px-5 py-4">
                <p className="text-sm">
                  <span className="font-semibold">{unmappedLines(preview).length} recipe ingredient{unmappedLines(preview).length === 1 ? ' is' : 's are'} still text</span>{' '}
                  <span className="text-muted-foreground">and would reach AH without a product.</span>
                </p>
                <Button onClick={() => setSuggesting(true)} className="h-11 rounded-full px-5 font-semibold">
                  <Sparkles className="h-4 w-4" /> Suggest AH products
                </Button>
              </div>
            ))}

            <Section title={`Would change · ${preview.changes.length}`}>
              {preview.changes.length === 0 ? (
                <p className="rounded-[14px] border border-dashed border-input py-6 text-center text-muted-foreground">
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
                <ul className="divide-y divide-border">
                  {preview.onListAlready.map(l => {
                    const key = l.productId ?? `t:${l.text}`
                    // A recipe ingredient that is still free text on the AH list can be mapped too.
                    const mappable = l.productId == null && Boolean(l.text) && ingredientMappings.available
                    return (
                      <li key={key} className="py-2.5">
                        <div className="flex items-center gap-3">
                          {l.productId != null
                            ? <ProductThumb src={l.imageUrl} className="h-10 w-10 rounded-[10px]" />
                            : <span className="w-10 shrink-0" aria-hidden="true" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px]">{l.title}</p>
                            {onUndo && l.mappedFrom.length > 0 && (
                              <p className="text-[13px] text-muted-foreground">
                                {l.mappedFrom.map(m => (
                                  <span key={m.key} className="mr-3">Mapped from {m.label} · <UndoMapping mapping={m} onUndo={onUndo} /></span>
                                ))}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 text-muted-foreground tabular-nums">× {l.quantity}</span>
                          {mappable && mappingFor !== `list:${l.text}` && (
                            <MapButton title={l.title} onClick={() => setMappingFor(`list:${l.text}`)} />
                          )}
                        </div>
                        {mappable && mappingFor === `list:${l.text}` && (
                          <IngredientMapForm
                            name={l.text}
                            searchProducts={ingredientMappings.searchProducts}
                            onSave={ingredientMappings.save}
                            onUndo={undoMapping}
                            onDone={() => setMappingFor(null)}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
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
