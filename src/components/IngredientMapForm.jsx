import { useState } from 'react'
import { Home, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toMappingRow } from '@/lib/ingredientMappings'
import ProductThumb from '@/components/ProductThumb'

const euro = (price) => (price == null ? null : `€${Number(price).toFixed(2)}`)

// Maps one recipe ingredient for the household: search AH and pick the product to buy
// for it, or say the household always has it at home. Saves on the pick itself;
// the confirmation offers Undo.
// Searching happens on submit (each search refreshes the AH login once).
export default function IngredientMapForm({ name, searchProducts, onSave, onUndo, onDone }) {
  const [query, setQuery] = useState(name)
  const [results, setResults] = useState(null)
  const [searchedFor, setSearchedFor] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function runSearch(e) {
    e.preventDefault()
    setSearching(true)
    setSearchError(null)
    const { products, searchedFor: terms, error } = await searchProducts(query)
    setSearching(false)
    if (error) { setSearchError(error); setResults(null); return }
    setResults(products)
    setSearchedFor(terms ?? [])
  }

  async function choose(choice, done) {
    const result = toMappingRow({ name, ...choice })
    if (!result.ok) { toast.error(result.message); return }
    setSaving(true)
    const message = await onSave(result.row)
    setSaving(false)
    if (message) { toast.error(`Could not save the mapping: ${message}`); return }
    // A wrong pick can be taken back straight from the confirmation.
    const mapping = { key: result.row.ingredient_key, label: result.row.label }
    toast.success(done, onUndo ? { action: { label: 'Undo', onClick: () => onUndo(mapping) } } : undefined)
    onDone()
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <p>
        <span className="font-medium">What do you buy for “{name}”?</span>{' '}
        <span className="text-muted-foreground">Search AH in English or Dutch and pick the product. It is used for every recipe from now on.</span>
      </p>
      <form onSubmit={runSearch} className="flex gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search AH products for ${name}`} />
        <Button type="submit" variant="outline" disabled={searching || saving || query.trim().length < 2}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </Button>
      </form>
      {searchError && <p className="text-xs text-destructive">{searchError}</p>}
      {results && searchedFor.length > 1 && (
        <p className="text-xs text-muted-foreground">Searched AH for “{searchedFor[0]}” and “{searchedFor.slice(1).join('”, “')}”.</p>
      )}
      {results && (
        <ul className="max-h-[26rem] divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
          {results.length === 0 && <li className="px-3 py-2 text-muted-foreground">No orderable products found.</li>}
          {results.map((p) => (
            <li key={p.externalId}>
              <button
                type="button"
                disabled={saving}
                onClick={() => choose({ product: p }, `${name} → ${p.title}`)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent disabled:opacity-60"
              >
                <ProductThumb src={p.imageUrl} className="h-20 w-20 rounded-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.title}</span>
                  <span className="block text-xs text-muted-foreground">{[p.salesUnitSize, euro(p.price)].filter(Boolean).join(' · ')}</span>
                </span>
                {p.bonus && <span className="shrink-0 rounded-full bg-badge px-2 py-0.5 text-xs font-semibold text-badge-foreground">{p.bonus}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => choose({ pantry: true }, `${name}: always at home`)}>
          <Home className="h-3.5 w-3.5" /> Always have at home
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}
