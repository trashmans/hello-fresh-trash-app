import { useState } from 'react'
import { Home, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AMOUNT_RULE_OPTIONS, describeMapping } from '@/lib/ingredientMappings'
import ProductThumb from '@/components/ProductThumb'

function MappingRow({ mapping, onRemove, onRule }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      {mapping.pantry ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
          <Home className="h-4 w-4" />
        </span>
      ) : (
        <ProductThumb src={mapping.product?.image_url} />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{mapping.label}</p>
        <p className="truncate text-xs text-muted-foreground">{describeMapping(mapping)}</p>
        {!mapping.pantry && onRule && (
          <select
            aria-label={`How much ${mapping.label} to buy`}
            className="mt-1.5 h-9 max-w-full rounded-lg border border-input bg-card px-2 text-sm text-foreground"
            value={mapping.amount_rule ?? 'auto'}
            onChange={async (e) => { const m = await onRule([mapping.ingredient_key], e.target.value); if (m) toast.error(m) }}
          >
            {AMOUNT_RULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>
      {confirm ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Remove?</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button
            size="sm" variant="destructive" className="h-7 px-2 text-xs"
            onClick={async () => { const m = await onRemove(mapping.ingredient_key); if (m) toast.error(m) }}
          >
            Remove
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirm(true)} aria-label={`Remove the mapping for ${mapping.label}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  )
}

// "Mapped ingredients" on the Automated ordering tab (rollout phase 4): what the
// household buys at AH for each recipe ingredient it has mapped, and the ones it
// always has at home. Mappings are made from the preview's recipe lines; this list is
// for checking and removing them. Shown only when the household's ah_enabled switch is on.
export default function MappedIngredientsCard({ ingredientMappings }) {
  const { available, mappings, error, remove, setRule } = ingredientMappings
  if (!available) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[22px]">Mapped ingredients{mappings.length > 0 ? ` · ${mappings.length}` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          What your household buys for a recipe ingredient. Mapped ingredients go on the AH list as that product, in whole packs: worked out from the recipe amount, or 1 per recipe, or 1 for the week.
        </p>
        {error && <p className="text-destructive">{error}</p>}
        {mappings.length === 0 ? (
          <p className="rounded-md border border-dashed border-border py-6 text-center text-muted-foreground">
            Nothing mapped yet. Use Map on a recipe line in this week's preview.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {mappings.map((m) => <MappingRow key={m.ingredient_key} mapping={m} onRemove={remove} onRule={setRule} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
