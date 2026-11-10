import { useState } from 'react'
import { Loader2, Pause, Pencil, Play, Plus, Search, SkipForward, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStaples } from '@/hooks/useStaples'
import { STAPLE_LIMITS, describeStaple, toStapleRow } from '@/lib/stapleForm'

const euro = (price) => (price == null ? null : `€${Number(price).toFixed(2)}`)
const EMPTY_FORM = { name: '', productExternalId: null, productLabel: '', searchTerm: '', quantity: 1, cadenceWeeks: 1, stockUp: false, maxWeeksStock: 6 }

function formFrom(staple) {
  return {
    name: staple.name,
    productExternalId: staple.product_external_id,
    productLabel: staple.product ? [staple.product.title, staple.product.sales_unit_size].filter(Boolean).join(' · ') : '',
    searchTerm: staple.search_term ?? '',
    quantity: staple.quantity,
    cadenceWeeks: staple.cadence_weeks,
    stockUp: !staple.perishable,
    maxWeeksStock: staple.max_weeks_stock ?? 6,
  }
}

function FieldError({ message }) {
  return message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null
}

// Add or edit one staple. Searching AH happens on submit (Enter or the button):
// each search refreshes the AH login once.
function StapleForm({ initial, onSave, onCancel, searchProducts }) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searchedFor, setSearchedFor] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

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

  function pick(p) {
    set({
      productExternalId: p.externalId,
      productLabel: [p.title, p.salesUnitSize].filter(Boolean).join(' · '),
      name: form.name.trim() ? form.name : p.title,
    })
    setResults(null)
    setQuery('')
  }

  async function save() {
    const result = toStapleRow(form)
    setErrors(result.ok ? {} : result.errors)
    if (!result.ok) return
    setSaving(true)
    const message = await onSave(result.row)
    setSaving(false)
    if (message) toast.error(`Could not save the staple: ${message}`)
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-4 text-sm">
      <div>
        <p className="font-medium">AH product</p>
        {form.productExternalId ? (
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">Pinned</span>
            <span className="min-w-0 flex-1 truncate">{form.productLabel || `Product ${form.productExternalId}`}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ productExternalId: null, productLabel: '' })}>
              <X className="h-3.5 w-3.5" /> Unpin
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Search AH in English or Dutch and pick the exact product, or use a search term below.</p>
        )}
        <form onSubmit={runSearch} className="mt-2 flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. sweet onions or zoete uien" aria-label="Search AH products, in English or Dutch" />
          <Button type="submit" variant="outline" disabled={searching || query.trim().length < 2}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
          </Button>
        </form>
        {searchError && <p className="mt-2 text-xs text-destructive">{searchError}</p>}
        {results && searchedFor.length > 1 && (
          <p className="mt-2 text-xs text-muted-foreground">Searched AH for “{searchedFor[0]}” and “{searchedFor.slice(1).join('”, “')}”.</p>
        )}
        {results && (
          <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
            {results.length === 0 && <li className="px-3 py-2 text-muted-foreground">No orderable products found.</li>}
            {results.map((p) => (
              <li key={p.externalId}>
                <button type="button" onClick={() => pick(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent">
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-medium">Name</span>
          <Input className="mt-1" value={form.name} maxLength={STAPLE_LIMITS.nameMax} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Onions" />
          <FieldError message={errors.name} />
        </label>
        <label className="block">
          <span className="font-medium">Search term {form.productExternalId ? '(optional)' : ''}</span>
          <Input className="mt-1" value={form.searchTerm} maxLength={STAPLE_LIMITS.searchMax} onChange={(e) => set({ searchTerm: e.target.value })} placeholder="what you'd type in the AH app" />
          <FieldError message={errors.searchTerm} />
        </label>
        <label className="block">
          <span className="font-medium">Quantity</span>
          <Input className="mt-1" type="number" min={STAPLE_LIMITS.quantity[0]} max={STAPLE_LIMITS.quantity[1]} step="1" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
          <FieldError message={errors.quantity} />
        </label>
        <label className="block">
          <span className="font-medium">How often</span>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
            value={form.cadenceWeeks}
            onChange={(e) => set({ cadenceWeeks: Number(e.target.value) })}
          >
            {Array.from({ length: STAPLE_LIMITS.cadenceWeeks[1] }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n === 1 ? 'every week' : `every ${n} weeks`}</option>
            ))}
          </select>
          <FieldError message={errors.cadenceWeeks} />
        </label>
      </div>

      <div>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.stockUp} onChange={(e) => set({ stockUp: e.target.checked })} />
          <span className="font-medium">Stock up on bonus</span>
        </label>
        <p className="mt-1 text-xs text-muted-foreground">For things that keep (detergent, muesli, seeds): buy extra when it's on bonus.</p>
        {form.stockUp && (
          <label className="mt-2 flex flex-wrap items-center gap-2">
            <span>Up to</span>
            <Input className="h-8 w-20" type="number" min={STAPLE_LIMITS.maxWeeksStock[0]} max={STAPLE_LIMITS.maxWeeksStock[1]} step="1" value={form.maxWeeksStock} onChange={(e) => set({ maxWeeksStock: e.target.value })} />
            <span>weeks' worth</span>
          </label>
        )}
        <FieldError message={errors.maxWeeksStock} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="button" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save staple</Button>
      </div>
    </div>
  )
}

function StapleRow({ staple, onEdit, onUpdate, onRemove }) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const toggle = async (patch, done) => {
    const message = await onUpdate(staple.id, patch)
    if (message) toast.error(`Could not update ${staple.name}: ${message}`)
    else if (done) toast.success(done)
  }
  const product = staple.product
    ? [staple.product.title, staple.product.sales_unit_size].filter(Boolean).join(' · ')
    : `Searches AH for "${staple.search_term}" each week`

  return (
    <li className={`flex flex-wrap items-start gap-3 py-3 ${staple.active === false ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{staple.name}</p>
        <p className="truncate text-xs text-muted-foreground">{product}</p>
        <p className="mt-0.5 text-xs">{describeStaple(staple)}</p>
      </div>
      {confirmRemove ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Remove?</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={async () => { const m = await onRemove(staple.id); if (m) toast.error(m) }}>Remove</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => toggle({ skip_next: !staple.skip_next }, staple.skip_next ? null : `${staple.name} will be skipped next order`)} disabled={staple.active === false}>
            <SkipForward className="h-3.5 w-3.5" /> {staple.skip_next ? 'Undo skip' : 'Skip next'}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => toggle({ active: !staple.active })}>
            {staple.active === false ? <><Play className="h-3.5 w-3.5" /> Resume</> : <><Pause className="h-3.5 w-3.5" /> Pause</>}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onEdit} aria-label={`Edit ${staple.name}`}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirmRemove(true)} aria-label={`Remove ${staple.name}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </li>
  )
}

// Staples card on the Automated ordering tab (rollout phase 4).
export default function StaplesCard() {
  const { ahEnabled, householdId, staples, loading, error, add, update, remove, searchProducts } = useStaples()
  const [editing, setEditing] = useState(null) // null | 'new' | staple id

  const available = ahEnabled && householdId
  const active = staples.filter((s) => s.active !== false).length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">Staples{staples.length > 0 ? ` · ${active} active` : ''}</CardTitle>
          {available && editing === null && (
            <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add staple</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading staples…</p>
        ) : error ? (
          <p className="text-destructive">{error}</p>
        ) : !available ? (
          <p className="text-muted-foreground">Staples come with Albert Heijn linking, which isn't switched on for your household yet.</p>
        ) : (
          <>
            <p className="text-muted-foreground">Things you buy regularly. Each week the app adds the ones that are due to your AH list, alongside this week's recipes.</p>
            {editing === 'new' && (
              <StapleForm
                initial={EMPTY_FORM}
                searchProducts={searchProducts}
                onCancel={() => setEditing(null)}
                onSave={async (row) => { const m = await add(row); if (!m) { setEditing(null); toast.success(`${row.name} added`) } return m }}
              />
            )}
            {staples.length === 0 && editing !== 'new' && (
              <p className="rounded-md border border-dashed border-border py-6 text-center text-muted-foreground">No staples yet. Add the first one.</p>
            )}
            <ul className="divide-y divide-border">
              {staples.map((s) => (editing === s.id ? (
                <li key={s.id} className="py-3">
                  <StapleForm
                    initial={formFrom(s)}
                    searchProducts={searchProducts}
                    onCancel={() => setEditing(null)}
                    onSave={async (row) => { const m = await update(s.id, row); if (!m) setEditing(null); return m }}
                  />
                </li>
              ) : (
                <StapleRow key={s.id} staple={s} onEdit={() => setEditing(s.id)} onUpdate={update} onRemove={remove} />
              )))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
