import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, FileText, X, RotateCcw, Minus, Plus, Copy, Trash2, Scale, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { mergeIngredients } from '@/lib/ingredientMerge'
import { SWAP_MODES, swapIngredientsMap } from '@/lib/proteinSwap'
import { useSwapsById } from '@/hooks/useRecipeSwaps'
import { groupByAisle } from '@/lib/aisles'
import { computeScaleFactorFromIngredient } from '@/lib/scaling'
import { unitOptionsFor, unitOptionValueFor } from '@/lib/units'
import { toast } from 'sonner'

function formatQty(qty) {
  if (qty === null || qty === undefined) return null
  return parseFloat(qty.toFixed(2))
}

function formatServings(servings) {
  const rounded = Math.round(servings * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

// Inline "scale by ingredient amount" control for a single recipe row in
// the shopping list — an alternate way to set that recipe's effective
// servings, alongside the +/- stepper. Computes a scale factor the same
// way the recipe preview panel does (src/lib/scaling.js) and converts it
// to an equivalent servings count via the recipe's own base servings, so
// it feeds the exact same scaling/merging math the stepper already drives.
function IngredientScaleControl({ ingredients, baseServings, onApply }) {
  const [open, setOpen] = useState(false)
  const [ingredientId, setIngredientId] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')

  const scalable = ingredients.filter(ing => ing.quantity != null)
  const selected = scalable.find(ing => ing.id === ingredientId) ?? null
  const unitOptions = selected ? unitOptionsFor(selected.unit) : []
  const unitIsFixed = unitOptions.length <= 1

  if (scalable.length === 0) return null

  function openForm() {
    const first = scalable[0]
    setIngredientId(first.id)
    setQuantity(first.quantity)
    setUnit(unitOptionValueFor(first.unit))
    setOpen(true)
  }

  function selectIngredient(id) {
    const ing = scalable.find(i => i.id === id)
    setIngredientId(id)
    setQuantity(ing?.quantity ?? '')
    setUnit(unitOptionValueFor(ing?.unit))
  }

  function apply() {
    const factor = computeScaleFactorFromIngredient(selected, quantity, unit)
    if (factor == null) {
      toast.error("Can't compare those units — try a compatible one (e.g. lb/kg, cups/mL) or the recipe's own unit.")
      return
    }
    onApply(factor * baseServings)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        className="flex min-h-11 items-center gap-1 text-sm font-semibold hover:text-primary-text transition-colors"
        onClick={openForm}
      >
        <Scale className="h-3.5 w-3.5" />
        Scale by ingredient
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        type="number"
        min="0"
        step="any"
        className="h-9 w-16 text-sm"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
      />
      {unitIsFixed ? (
        <span className="text-xs">{unit}</span>
      ) : (
        <select
          className="h-9 rounded-lg border border-input bg-card px-2 text-sm text-foreground"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        >
          {unitOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
      <select
        className="h-9 max-w-[8rem] rounded-lg border border-input bg-card px-2 text-sm text-foreground"
        value={ingredientId ?? ''}
        onChange={(e) => selectIngredient(e.target.value)}
      >
        {scalable.map(ing => (
          <option key={ing.id} value={ing.id}>{ing.name}</option>
        ))}
      </select>
      <Button type="button" size="sm" className="h-9 rounded-full px-3" onClick={apply}>
        Apply
      </Button>
      <button type="button" aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export default function ShoppingListPanel({ shoppingList }) {
  // Shopping list lines follow the same volume / mass preference as the recipe view.
  const { unitPrefs } = useAuth()
  const {
    recipeSelections,
    adjustedItems,
    removeRecipe,
    setServings,
    setAdjustedQty,
    clearChecked,
  } = shoppingList

  const [recipes, setRecipes] = useState([])
  const [ingredientsMap, setIngredientsMap] = useState({})
  const [editingKey, setEditingKey] = useState(null)
  const [coverUrls, setCoverUrls] = useState({})

  useEffect(() => {
    const ids = recipeSelections.map(r => r.recipe_id)
    if (ids.length === 0) {
      setRecipes([])
      setIngredientsMap({})
      return
    }

    Promise.all([
      supabase.from('recipes').select('id, name, servings, cover_path').in('id', ids),
      supabase.from('ingredients').select('*').in('recipe_id', ids),
    ]).then(([{ data: recipeData }, { data: ingData }]) => {
      setRecipes(recipeData ?? [])
      const coverPaths = [...new Set((recipeData ?? []).map(r => r.cover_path).filter(Boolean))]
      if (coverPaths.length > 0) {
        supabase.storage.from('recipe-pdfs').createSignedUrls(coverPaths, 3600).then(({ data: signed }) => {
          const map = {}
          for (const entry of signed ?? []) if (entry.signedUrl) map[entry.path] = entry.signedUrl
          setCoverUrls(map)
        })
      }
      const map = {}
      for (const ing of ingData ?? []) {
        if (!map[ing.recipe_id]) map[ing.recipe_id] = []
        map[ing.recipe_id].push(ing)
      }
      setIngredientsMap(map)
    })
  }, [recipeSelections])

  const recipesMap = useMemo(
    () => Object.fromEntries(recipes.map(r => [r.id, r])),
    [recipes]
  )

  const swapsById = useSwapsById(recipeSelections.map(r => r.swap_id))
  const swappedIngredientsMap = useMemo(
    () => swapIngredientsMap(recipeSelections, ingredientsMap, swapsById),
    [recipeSelections, ingredientsMap, swapsById]
  )

  const mergedItems = useMemo(
    () => mergeIngredients(recipeSelections, swappedIngredientsMap, recipesMap, unitPrefs),
    [recipeSelections, swappedIngredientsMap, recipesMap, unitPrefs]
  )

  const adjustedMap = useMemo(
    () => new Map(adjustedItems.map(a => [a.key, a.buy_qty])),
    [adjustedItems]
  )

  function getBuyQty(item) {
    if (!adjustedMap.has(item.key)) return item.computedQty
    const stored = adjustedMap.get(item.key)
    if (item.computedQty !== null && stored > item.computedQty) return item.computedQty
    return stored
  }

  function isChecked(item) {
    return getBuyQty(item) === 0
  }

  const sortedItems = useMemo(() => {
    const unchecked = mergedItems.filter(item => !isChecked(item))
    const checked = mergedItems.filter(item => isChecked(item))
    return [...unchecked, ...checked]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedItems, adjustedMap])

  const hasChecked = adjustedItems.some(a => a.buy_qty === 0)

  function handleCheckToggle(item) {
    if (isChecked(item)) {
      setAdjustedQty(item.key, item.computedQty, item.computedQty)
    } else {
      setAdjustedQty(item.key, 0, item.computedQty)
      setEditingKey(null)
    }
  }

  function handleQtyStep(item, delta) {
    const current = getBuyQty(item) ?? 0
    const next = Math.max(0, current + delta)
    setAdjustedQty(item.key, next, item.computedQty)
    if (next === 0) setEditingKey(null)
  }

  function handleCopyForReminders() {
    const lines = sortedItems
      .filter(item => !isChecked(item))
      .map(item => {
        const qty = getBuyQty(item)
        if (qty === null) return item.name
        const rounded = formatQty(qty)
        if (item.unit) return `${item.name} (${rounded} ${item.unit})`
        return `${item.name} (${rounded})`
      })

    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Could not copy to clipboard'))
  }

  const groupedItems = groupByAisle(sortedItems.filter(item => !isChecked(item)))
  const checkedItems = sortedItems.filter(item => isChecked(item))
  const openCount = sortedItems.length - checkedItems.length

  const mini = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-input bg-card text-foreground hover:bg-accent transition-colors'

  function renderRecipe({ recipe_id, servings, swap_id, swap_mode }) {
    const swap = swap_id ? swapsById[swap_id] : null
    const recipe = recipesMap[recipe_id]
    const dbServings = recipe?.servings ?? null
    const baseServings = dbServings ?? servings
    const isChanged = dbServings !== null && servings !== dbServings
    const name = recipe?.name ?? '…'

    return (
      <article key={recipe_id} className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
            {recipe?.cover_path && coverUrls[recipe.cover_path] ? (
              <img src={coverUrls[recipe.cover_path]} alt="" className="h-full w-full object-cover" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-base font-semibold leading-snug">{name}</span>
            {swap && (
              <span className="text-[13px] text-muted-foreground">
                {SWAP_MODES[swap.direction]?.[swap_mode] ?? 'Swapped'}: {swap.title}
              </span>
            )}
          </span>
          <button
            type="button"
            aria-label={`Remove ${name} from this week`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive transition-colors"
            onClick={() => removeRecipe(recipe_id)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" className={mini} aria-label={`Fewer servings of ${name}`} onClick={() => setServings(recipe_id, servings - 1)}>
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-[92px] text-center font-semibold tabular-nums" aria-live="polite">
            {formatServings(servings)} {Number(servings) === 1 ? 'serving' : 'servings'}
          </span>
          <button type="button" className={mini} aria-label={`More servings of ${name}`} onClick={() => setServings(recipe_id, servings + 1)}>
            <Plus className="h-4 w-4" />
          </button>
          {isChanged && (
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setServings(recipe_id, baseServings)}
              title={`Reset to ${dbServings}`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Card: {dbServings}
            </button>
          )}
          <div className="ml-auto">
            <IngredientScaleControl
              ingredients={ingredientsMap[recipe_id] ?? []}
              baseServings={baseServings}
              onApply={(newServings) => setServings(recipe_id, newServings)}
            />
          </div>
        </div>
      </article>
    )
  }

  function renderItem(item) {
    const buyQty = getBuyQty(item)
    const checked = isChecked(item)
    const isEditing = editingKey === item.key
    const label = `${item.name}${item.preparation ? `, ${item.preparation}` : ''}`
    const qtyText = item.computedQty !== null ? `${formatQty(buyQty)}${item.unit ? ` ${item.unit}` : ''}` : null

    if (checked) {
      return (
        <div key={item.key} className="flex items-center gap-3.5 border-t border-border py-2">
          <button
            type="button"
            aria-pressed="true"
            aria-label={`Need ${label} after all`}
            onClick={() => handleCheckToggle(item)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-secondary bg-secondary text-secondary-foreground"
          >
            <Check className="h-4 w-4" />
          </button>
          <span className="flex-1 text-[15px] text-muted-foreground line-through">{label}</span>
          {item.computedQty !== null && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatQty(item.computedQty)}{item.unit ? ` ${item.unit}` : ''}
            </span>
          )}
        </div>
      )
    }

    return (
      <div key={item.key} className="flex items-center gap-3.5 border-t border-border py-2.5">
        <button
          type="button"
          aria-pressed="false"
          aria-label={`Already have ${label}`}
          onClick={() => handleCheckToggle(item)}
          className="h-7 w-7 shrink-0 rounded-lg border-2 border-input hover:border-secondary transition-colors"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-medium">{label}</span>
          <span className="truncate text-[13px] text-muted-foreground">
            for {[...new Set(item.contributions.map(c => c.recipeName))].join(', ')}
          </span>
        </div>

        {qtyText && (
          isEditing ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" className={mini} aria-label={`Less ${item.name}`} onClick={() => handleQtyStep(item, -1)}>
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-10 text-center font-semibold text-primary-text tabular-nums">{formatQty(buyQty)}</span>
              <button
                type="button"
                className={`${mini} disabled:opacity-40 disabled:hover:bg-card`}
                aria-label={`More ${item.name}`}
                disabled={buyQty >= item.computedQty}
                title={buyQty >= item.computedQty ? 'Already the full amount the recipes need' : undefined}
                onClick={() => handleQtyStep(item, 1)}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="min-h-11 px-2 text-sm font-semibold text-primary-text hover:underline"
                onClick={() => setEditingKey(null)}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="min-w-[70px] shrink-0 cursor-default text-right font-semibold text-primary-text tabular-nums">
                    {qtyText}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <div className="text-xs space-y-1 max-w-48">
                    {item.contributions.map((c, i) => (
                      <div key={i} className="flex items-baseline gap-1">
                        <span className="font-medium tabular-nums">
                          {c.scaledQty !== null ? formatQty(c.scaledQty) : '?'}
                          {item.unit ? ` ${item.unit}` : ''}
                        </span>
                        <span className="text-muted-foreground">· {c.recipeName}</span>
                        {c.scaleFactor !== 1 && (
                          <span className="text-muted-foreground/70">
                            ({formatQty(c.baseQty)} ×{parseFloat(c.scaleFactor.toFixed(2))})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                className={mini}
                aria-label={`Change how much ${item.name} to buy`}
                onClick={() => setEditingKey(item.key)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>
          )
        )}
      </div>
    )
  }

  const hasRecipes = recipeSelections.length > 0

  return (
    <div className="flex flex-wrap items-start gap-8">
      {/* Left (top on phones) — this week's recipes, with servings */}
      <section aria-label="This week's recipes" className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-2xl font-bold">Recipes · {recipeSelections.length}</h2>
          <Link to="/recipes" className="text-sm font-semibold text-primary-text hover:underline">Add more</Link>
        </div>
        {!hasRecipes ? (
          <div className="rounded-[18px] border border-dashed border-input bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            Pick recipes with the basket button on the Recipes tab.
          </div>
        ) : (
          recipeSelections.map(renderRecipe)
        )}
      </section>

      {/* Right (below on phones) — the merged list, grouped by aisle */}
      <section aria-label="Shopping list" className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="flex-[1_1_auto] text-2xl font-bold">
            Shopping list{hasRecipes ? ` · ${openCount} to buy` : ''}
          </h2>
          {hasRecipes && (
            <>
              <button
                type="button"
                onClick={handleCopyForReminders}
                className="flex h-11 items-center gap-1.5 rounded-full border border-input px-4 text-sm font-semibold hover:bg-accent transition-colors"
              >
                <Copy className="h-4 w-4" />
                Copy for Reminders
              </button>
              <Link
                to="/ordering"
                className="flex h-11 items-center gap-1.5 rounded-full bg-secondary px-[18px] text-sm font-bold text-secondary-foreground hover:opacity-90 transition-opacity"
              >
                Send to AH
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>
        {hasRecipes && (
          <p className="-mt-2 text-sm text-muted-foreground">Tick what you already have; ticked items aren&apos;t copied or sent.</p>
        )}

        <TooltipProvider>
          {!hasRecipes && (
            <div className="rounded-[18px] border border-dashed border-input bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              Your list is empty.
            </div>
          )}
          {groupedItems.map(({ aisle, items }) => (
            <div key={aisle} className="flex flex-col rounded-[18px] border border-border bg-card px-[18px] py-1.5">
              <h3 className="pb-1.5 pt-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">{aisle}</h3>
              {items.map(renderItem)}
            </div>
          ))}
          {checkedItems.length > 0 && (
            <div className="flex flex-col rounded-[18px] border border-dashed border-input bg-card px-[18px] pb-3 pt-1.5">
              <div className="flex items-center gap-2.5 pb-1.5 pt-2.5">
                <h3 className="flex-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Already have · {checkedItems.length}
                </h3>
                {hasChecked && (
                  <button
                    type="button"
                    onClick={clearChecked}
                    className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-primary-text hover:bg-accent transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear ticked
                  </button>
                )}
              </div>
              {checkedItems.map(renderItem)}
            </div>
          )}
        </TooltipProvider>
      </section>
    </div>
  )
}
