import { useEffect, useState, useMemo } from 'react'
import { ShoppingCart, X, RotateCcw, Minus, Plus, Copy, Trash2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { supabase } from '@/lib/supabase'
import { mergeIngredients } from '@/lib/ingredientMerge'
import { toast } from 'sonner'

function formatQty(qty) {
  if (qty === null || qty === undefined) return null
  return parseFloat(qty.toFixed(2))
}

export default function ShoppingListDrawer({ open, onClose, shoppingList }) {
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

  useEffect(() => {
    const ids = recipeSelections.map(r => r.recipe_id)
    if (ids.length === 0) {
      setRecipes([])
      setIngredientsMap({})
      return
    }

    Promise.all([
      supabase.from('recipes').select('id, name, servings').in('id', ids),
      supabase.from('ingredients').select('*').in('recipe_id', ids),
    ]).then(([{ data: recipeData }, { data: ingData }]) => {
      setRecipes(recipeData ?? [])
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
    () => mergeIngredients(recipeSelections, ingredientsMap, recipesMap),
    [recipeSelections, ingredientsMap, recipesMap]
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

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0 text-foreground">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Shopping List
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Zone 1 — Selected recipes with serving steppers */}
          {recipeSelections.length > 0 && (
            <div className="px-6 py-4 border-b border-border space-y-3">
              {recipeSelections.map(({ recipe_id, servings }) => {
                const recipe = recipesMap[recipe_id]
                const dbServings = recipe?.servings ?? null
                const baseServings = dbServings ?? servings
                const isChanged = dbServings !== null && servings !== dbServings

                return (
                  <div key={recipe_id} className="flex items-center gap-3">
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
                        <span className="w-6 text-center text-sm font-medium tabular-nums">
                          {servings}
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
                )
              })}
            </div>
          )}

          {/* Zone 2 — Merged ingredient list */}
          <TooltipProvider>
            <div className="px-6 py-4 space-y-1">
              {recipeSelections.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Check recipes in the catalogue to build your shopping list.
                </p>
              )}

              {sortedItems.map(item => {
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

                    <span className={`flex-1 text-sm ${checked ? 'line-through text-muted-foreground' : ''}`}>
                      {item.name}
                      {item.preparation ? `, ${item.preparation}` : ''}
                    </span>

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
              })}
            </div>
          </TooltipProvider>
        </div>

        {/* Zone 3 — Sticky footer */}
        {recipeSelections.length > 0 && (
          <div className="px-6 py-4 border-t border-border flex gap-2 shrink-0">
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
              variant="default"
              size="sm"
              className={hasChecked ? 'flex-1' : 'w-full'}
              onClick={handleCopyForReminders}
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy for Reminders
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
