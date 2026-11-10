import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FileText, ShoppingCart, X, RotateCcw, Minus, Plus, Copy, Trash2, Scale } from 'lucide-react'
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
import { groupByAisle } from '@/lib/aisles'
import { computeScaleFactorFromIngredient } from '@/lib/scaling'
import { unitOptionsFor } from '@/lib/units'
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
    setUnit(first.unit ?? '')
    setOpen(true)
  }

  function selectIngredient(id) {
    const ing = scalable.find(i => i.id === id)
    setIngredientId(id)
    setQuantity(ing?.quantity ?? '')
    setUnit(ing?.unit ?? '')
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
        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        onClick={openForm}
      >
        <Scale className="h-3 w-3" />
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
        className="h-7 w-16 text-xs"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
      />
      {unitIsFixed ? (
        <span className="text-xs">{unit}</span>
      ) : (
        <select
          className="h-7 rounded-md border border-input bg-input px-1 text-xs text-foreground"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        >
          {unitOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
      <select
        className="h-7 max-w-[7rem] rounded-md border border-input bg-input px-1 text-xs text-foreground"
        value={ingredientId ?? ''}
        onChange={(e) => selectIngredient(e.target.value)}
      >
        {scalable.map(ing => (
          <option key={ing.id} value={ing.id}>{ing.name}</option>
        ))}
      </select>
      <Button type="button" size="sm" className="h-7 text-xs px-2" onClick={apply}>
        Apply
      </Button>
      <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
        <X className="h-3 w-3" />
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

  const mergedItems = useMemo(
    () => mergeIngredients(recipeSelections, ingredientsMap, recipesMap, unitPrefs),
    [recipeSelections, ingredientsMap, recipesMap, unitPrefs]
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

  function renderRecipe({ recipe_id, servings }) {
    const recipe = recipesMap[recipe_id]
    const dbServings = recipe?.servings ?? null
    const baseServings = dbServings ?? servings
    const isChanged = dbServings !== null && servings !== dbServings

    return (
      <div key={recipe_id} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted flex items-center justify-center">
            {recipe?.cover_path && coverUrls[recipe.cover_path] ? (
              <img src={coverUrls[recipe.cover_path]} alt="" className="h-full w-full object-cover" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <span className="flex-1 text-sm font-medium truncate min-w-0">
            {recipe?.name ?? '…'}
          </span>
          <div className="flex flex-col items-center shrink-0">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={() => setServings(recipe_id, servings - 1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-10 text-center text-sm font-medium tabular-nums">
                {formatServings(servings)}
              </span>
              {isChanged && (
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setServings(recipe_id, baseServings)}
                  title="Reset to default"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={() => setServings(recipe_id, servings + 1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {dbServings !== null && (
              <span className="text-xs text-muted-foreground mt-0.5">
                default: {dbServings}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => removeRecipe(recipe_id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <IngredientScaleControl
          ingredients={ingredientsMap[recipe_id] ?? []}
          baseServings={baseServings}
          onApply={(newServings) => setServings(recipe_id, newServings)}
        />
      </div>
    )
  }

  function renderItem(item) {
    const buyQty = getBuyQty(item)
    const checked = isChecked(item)
    const isEditing = editingKey === item.key

    return (
      <div
        key={item.key}
        className={`flex items-start gap-3 py-1.5 transition-opacity ${checked ? 'opacity-40' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => handleCheckToggle(item)}
          className="h-4 w-4 shrink-0 cursor-pointer accent-primary mt-0.5"
        />

        <div className="flex-1 min-w-0">
          <span className={`block text-sm ${checked ? 'line-through text-muted-foreground' : ''}`}>
            {item.name}
            {item.preparation ? `, ${item.preparation}` : ''}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[...new Set(item.contributions.map(c => c.recipeName))].join(', ')}
          </span>
        </div>

        {item.computedQty !== null && (
          isEditing ? (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={() => handleQtyStep(item, -1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center text-sm tabular-nums">
                {formatQty(buyQty)}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={() => handleQtyStep(item, 1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground ml-1"
                onClick={() => setEditingKey(null)}
              >
                done
              </button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`text-sm shrink-0 tabular-nums transition-colors ${
                    checked
                      ? 'text-muted-foreground line-through cursor-default'
                      : 'text-muted-foreground hover:text-foreground cursor-pointer'
                  }`}
                  onClick={() => { if (!checked) setEditingKey(item.key) }}
                >
                  {formatQty(buyQty)}{item.unit ? ` ${item.unit}` : ''}
                </button>
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
          )
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {/* Left (top on phones) — this week's recipes, with servings */}
      <section aria-label="This week's recipes" className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">
            This week · {recipeSelections.length} {recipeSelections.length === 1 ? 'recipe' : 'recipes'}
          </h2>
          <Link to="/recipes" className="text-sm font-medium text-secondary hover:underline">Add more</Link>
        </div>
        {recipeSelections.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            Pick recipes with the cart button on the Recipes tab.
          </p>
        ) : (
          <div className="px-6 py-4 space-y-4">
            {recipeSelections.map(renderRecipe)}
          </div>
        )}
      </section>

      {/* Right (below on phones) — the merged list, grouped by aisle */}
      <section aria-label="Shopping list" className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden flex flex-col">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShoppingCart className="h-5 w-5" />
            Shopping list{recipeSelections.length > 0 ? ` · ${openCount} ${openCount === 1 ? 'item' : 'items'}` : ''}
          </h2>
          {recipeSelections.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">Tick what you already have; ticked items aren't copied.</p>
          )}
        </div>

        <TooltipProvider>
          <div className="px-6 pb-4">
            {recipeSelections.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Your list is empty.</p>
            )}
            {groupedItems.map(({ aisle, items }) => (
              <div key={aisle}>
                <h3 className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{aisle}</h3>
                <div className="space-y-1">{items.map(renderItem)}</div>
              </div>
            ))}
            {checkedItems.length > 0 && (
              <div>
                <h3 className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Already have</h3>
                <div className="space-y-1">{checkedItems.map(renderItem)}</div>
              </div>
            )}
          </div>
        </TooltipProvider>

        {/* Footer — list actions */}
        {recipeSelections.length > 0 && (
          <div className="px-6 py-4 border-t border-border flex flex-wrap gap-2 shrink-0">
            {hasChecked && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={clearChecked}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear checked
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleCopyForReminders}
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy for Reminders
            </Button>
            <Button variant="default" size="sm" className="flex-1" asChild>
              <Link to="/ordering">
                Send to AH
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
