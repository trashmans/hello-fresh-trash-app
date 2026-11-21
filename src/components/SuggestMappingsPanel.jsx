import { useState } from 'react'
import { AlertTriangle, Check, Home, Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import IngredientMapForm from '@/components/IngredientMapForm'
import ProductThumb from '@/components/ProductThumb'
import { toMappingRow } from '@/lib/ingredientMappings'
import { pickSuggestion, unmappedLines } from '@/lib/mappingSuggestions'

// "Suggest AH products" on this week's preview: looks up every recipe ingredient that is
// still free text (one retailer-products search each, one after the other), suggests a
// product for each (src/lib/mappingSuggestions.js) and lets the household accept, pick
// another, mark "always at home" or skip. Only accepted suggestions are saved, as normal
// ingredient mappings, so the preview re-plans with them straight away.
export default function SuggestMappingsPanel({ preview, ingredientMappings, onClose }) {
  const [lookedAt, setLookedAt] = useState([]) // names from earlier batches
  const [names, setNames] = useState(() => unmappedLines(preview))
  const [items, setItems] = useState(null) // [{ name, suggestion, error, status }]
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(null)

  const update = (name, patch) => setItems(list => list.map(i => (i.name === name ? { ...i, ...patch } : i)))

  async function lookUp(batch = names) {
    setBusy(true)
    setProgress(0)
    const found = []
    for (const name of batch) {
      const result = await ingredientMappings.searchProducts(name, { suggest: true })
      found.push(result.error
        ? { name, suggestion: null, error: result.error, status: 'open' }
        : { name, suggestion: pickSuggestion(result), searchedFor: result.searchedFor?.[0] ?? null, error: null, status: 'open' })
      setProgress(found.length)
    }
    setItems(found)
    setBusy(false)
  }

  async function save(item, choice, status) {
    const result = toMappingRow({ name: item.name, ...choice })
    if (!result.ok) { toast.error(result.message); return false }
    const message = await ingredientMappings.save(result.row)
    if (message) { toast.error(`Could not save the mapping for ${item.name}: ${message}`); return false }
    update(item.name, { status })
    return true
  }

  async function acceptAllSure() {
    setBusy(true)
    let saved = 0
    for (const item of items) {
      if (item.status === 'open' && item.suggestion?.sure && await save(item, { product: item.suggestion.product }, 'accepted')) saved++
    }
    setBusy(false)
    if (saved) toast.success(`${saved} ingredient${saved === 1 ? '' : 's'} mapped`)
  }

  // The next batch: ingredients still text on the preview that no batch has looked at yet.
  const seenSoFar = [...lookedAt, ...names]
  const nextBatch = items ? unmappedLines(preview, { skip: seenSoFar }) : []
  function lookUpNext() {
    setLookedAt(seenSoFar)
    setNames(nextBatch)
    setItems(null)
    lookUp(nextBatch)
  }

  const open = items?.filter(i => i.status === 'open') ?? []
  const sureOpen = open.filter(i => i.suggestion?.sure).length
  const ghostPill = 'h-9 rounded-full px-3 text-sm font-semibold'

  return (
    <div className="space-y-4 rounded-[18px] border border-border bg-banner p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold"><Sparkles className="h-4 w-4 text-primary-text" aria-hidden="true" /> Suggest AH products</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {names.length} recipe ingredient{names.length === 1 ? '' : 's'} in this batch {names.length === 1 ? 'is' : 'are'} still text on your AH list. Each is looked up the way you would: a web search for its name at Albert Heijn, then an AH search. Suggestions are only saved when you accept them, and are used for every recipe from then on.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close suggestions" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!items && (
        <Button onClick={() => lookUp()} disabled={busy} className="h-11 rounded-full px-5 font-semibold">
          {busy
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Looking up {Math.min(progress + 1, names.length)} of {names.length}…</>
            : <>Look up {names.length} ingredient{names.length === 1 ? '' : 's'} on AH</>}
        </Button>
      )}

      {items && (
        <>
          {sureOpen > 0 && (
            <Button onClick={acceptAllSure} disabled={busy} className="h-11 rounded-full bg-secondary px-5 font-bold text-secondary-foreground hover:bg-secondary/90">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept {sureOpen} good match{sureOpen === 1 ? '' : 'es'}
            </Button>
          )}
          <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
            {items.map(item => {
              const p = item.suggestion?.product
              return (
                <li key={item.name} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {p ? <ProductThumb src={p.imageUrl} className="h-10 w-10 rounded-[10px]" /> : <span className="w-10 shrink-0" aria-hidden="true" />}
                    <div className="min-w-0 flex-[1_1_200px]">
                      <p className="text-[15px] font-medium">{item.name}</p>
                      <p className="text-[13px] text-muted-foreground">
                        {item.error ? item.error
                          : p ? <>→ {p.title}{p.salesUnitSize ? ` · ${p.salesUnitSize}` : ''}</>
                            : 'No AH product found'}
                        {item.searchedFor && item.searchedFor.toLowerCase() !== item.name.toLowerCase() && (
                          <span className="block text-xs">Searched AH for “{item.searchedFor}”</span>
                        )}
                      </p>
                      {item.status === 'open' && p && !item.suggestion.sure && (
                        <p className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold text-primary-text">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Not sure — check this one
                        </p>
                      )}
                    </div>
                    {item.status === 'accepted' && <span className="text-sm font-semibold text-secondary">Mapped</span>}
                    {item.status === 'athome' && <span className="text-sm font-semibold text-secondary">Always at home</span>}
                    {item.status === 'skipped' && <span className="text-sm text-muted-foreground">Skipped</span>}
                    {item.status === 'open' && (
                      <div className="flex flex-wrap gap-1.5">
                        {p && (
                          <Button size="sm" variant="outline" className={ghostPill} disabled={busy} onClick={() => save(item, { product: p }, 'accepted')}>
                            <Check className="h-3.5 w-3.5" /> Accept
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className={ghostPill} disabled={busy} onClick={() => setPicking(picking === item.name ? null : item.name)}>
                          Pick another
                        </Button>
                        <Button size="sm" variant="ghost" className={ghostPill} disabled={busy} onClick={() => save(item, { pantry: true }, 'athome')} aria-label={`${item.name}: always at home`}>
                          <Home className="h-3.5 w-3.5" /> At home
                        </Button>
                        <Button size="sm" variant="ghost" className={`${ghostPill} text-muted-foreground`} disabled={busy} onClick={() => update(item.name, { status: 'skipped' })}>
                          Skip
                        </Button>
                      </div>
                    )}
                  </div>
                  {item.status === 'open' && picking === item.name && (
                    <IngredientMapForm
                      name={item.name}
                      searchProducts={ingredientMappings.searchProducts}
                      onSave={async (row) => {
                        const message = await ingredientMappings.save(row)
                        if (!message) update(item.name, { status: row.pantry ? 'athome' : 'accepted' })
                        return message
                      }}
                      onUndo={null}
                      onDone={() => setPicking(null)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
          {nextBatch.length > 0 ? (
            <Button variant="outline" onClick={lookUpNext} disabled={busy} className="h-11 rounded-full px-5 font-semibold">
              Look up the next {nextBatch.length} ingredient{nextBatch.length === 1 ? '' : 's'}
            </Button>
          ) : open.length === 0 && (
            <p className="text-sm text-muted-foreground">All done. Refresh the preview if a line doesn&apos;t show its product yet.</p>
          )}
        </>
      )}
    </div>
  )
}
