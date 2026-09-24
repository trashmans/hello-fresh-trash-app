import { useEffect, useState } from 'react'
import { X, Scale, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import { useRecipeIngredients } from '@/hooks/useRecipeIngredients'
import { useRecipeStepImages } from '@/hooks/useRecipeStepImages'
import { useAuth } from '@/context/AuthContext'
import { convertIngredientUnit, formatTemperatureText, unitOptionsFor } from '@/lib/units'
import { computeScaleFactorFromServings, computeScaleFactorFromIngredient, scaleIngredients } from '@/lib/scaling'

function formatIngredientLine(ingredient, unitPrefs) {
  const { quantity, unit } = convertIngredientUnit(ingredient.quantity, ingredient.unit, unitPrefs)
  const parts = []
  if (quantity != null) parts.push(String(quantity))
  if (unit) parts.push(unit)
  parts.push(ingredient.name)
  let line = parts.join(' ')
  if (ingredient.preparation) line += `, ${ingredient.preparation}`
  return line
}

// Scale-by-servings and scale-by-ingredient controls for the ingredients
// list below. Purely a view-time transform (see src/lib/scaling.js) —
// never writes anything back to the recipe or the shopping list.
function ScaleControls({ recipe, ingredients, scaleState, setScaleState }) {
  const { mode, targetServings, ingredientId, targetQuantity, targetUnit } = scaleState
  const scalableIngredients = ingredients.filter(ing => ing.quantity != null)
  const selectedIngredient = scalableIngredients.find(ing => ing.id === ingredientId) ?? null

  function selectIngredient(id) {
    const ing = scalableIngredients.find(i => i.id === id)
    setScaleState({
      mode: 'ingredient',
      ingredientId: id,
      targetQuantity: ing?.quantity ?? '',
      targetUnit: ing?.unit ?? '',
    })
  }

  function reset() {
    setScaleState({ mode: null })
  }

  const unitOptions = selectedIngredient ? unitOptionsFor(selectedIngredient.unit) : []
  const unitIsFixed = unitOptions.length <= 1

  return (
    <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <Scale className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">Scale recipe</span>
        {mode && (
          <button
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={reset}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-2">
        <Button
          type="button"
          variant={mode === 'servings' ? 'default' : 'outline'}
          size="sm"
          className="text-xs"
          onClick={() => setScaleState({ mode: 'servings', targetServings: recipe.servings ?? '' })}
        >
          By servings
        </Button>
        <Button
          type="button"
          variant={mode === 'ingredient' ? 'default' : 'outline'}
          size="sm"
          className="text-xs"
          disabled={scalableIngredients.length === 0}
          onClick={() => selectIngredient(scalableIngredients[0]?.id)}
        >
          By ingredient amount
        </Button>
      </div>

      {mode === 'servings' && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Servings:</span>
          <Input
            type="number"
            min="0"
            step="0.5"
            className="h-8 w-20"
            value={targetServings}
            onChange={(e) => setScaleState({ ...scaleState, targetServings: e.target.value === '' ? '' : Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">(recipe serves {recipe.servings ?? '?'})</span>
        </div>
      )}

      {mode === 'ingredient' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">I have:</span>
          <Input
            type="number"
            min="0"
            step="any"
            className="h-8 w-24"
            value={targetQuantity}
            onChange={(e) => setScaleState({ ...scaleState, targetQuantity: e.target.value === '' ? '' : Number(e.target.value) })}
          />
          {unitIsFixed ? (
            <span className="text-sm">{targetUnit}</span>
          ) : (
            <select
              className="h-8 rounded-md border border-input bg-input px-2 text-sm text-foreground"
              value={targetUnit}
              onChange={(e) => setScaleState({ ...scaleState, targetUnit: e.target.value })}
            >
              {unitOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
          <span className="text-muted-foreground">of:</span>
          <select
            className="h-8 flex-1 min-w-[8rem] rounded-md border border-input bg-input px-2 text-sm text-foreground"
            value={ingredientId ?? ''}
            onChange={(e) => selectIngredient(e.target.value)}
          >
            {scalableIngredients.map(ing => (
              <option key={ing.id} value={ing.id}>{ing.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

function RecipeMeta({ recipe }) {
  const items = [
    recipe.prep_time_minutes != null && `Prep ${recipe.prep_time_minutes} min`,
    recipe.cook_time_minutes != null && `Cook ${recipe.cook_time_minutes} min`,
    recipe.servings != null && `Serves ${recipe.servings}`,
    recipe.difficulty,
    recipe.cuisine,
  ].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground mb-4">
      {items.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </div>
  )
}

function InstructionsView({ recipe }) {
  const { unitPrefs } = useAuth()
  const { ingredients, loading } = useRecipeIngredients(recipe.id)
  const steps = recipe.steps ?? []
  const { stepImageUrls } = useRecipeStepImages(recipe.id, steps.length)
  const [scaleState, setScaleStateRaw] = useState({ mode: null })

  // Reset any active scaling when the viewer switches to a different
  // recipe — a scale chosen for one recipe shouldn't silently carry over
  // and misrepresent another.
  useEffect(() => {
    setScaleStateRaw({ mode: null })
  }, [recipe.id])

  function setScaleState(patch) {
    setScaleStateRaw(prev => ({ ...prev, ...patch }))
  }

  let scaleFactor = null
  if (scaleState.mode === 'servings') {
    scaleFactor = computeScaleFactorFromServings(scaleState.targetServings, recipe.servings)
  } else if (scaleState.mode === 'ingredient') {
    const scaledIngredient = ingredients.find(ing => ing.id === scaleState.ingredientId)
    scaleFactor = computeScaleFactorFromIngredient(scaledIngredient, scaleState.targetQuantity, scaleState.targetUnit)
  }
  const scaleFailed = scaleState.mode != null && scaleFactor == null
  const displayIngredients = scaleFactor != null ? scaleIngredients(ingredients, scaleFactor) : ingredients

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <RecipeMeta recipe={recipe} />

      {!loading && ingredients.length > 0 && (
        <ScaleControls
          recipe={recipe}
          ingredients={ingredients}
          scaleState={scaleState}
          setScaleState={setScaleState}
        />
      )}
      {scaleFailed && (
        <p className="text-xs text-destructive -mt-2 mb-4">
          Enter a valid amount in a unit compatible with the recipe's (e.g. lb/kg, cups/mL, or the exact same unit).
        </p>
      )}

      <h4 className="font-medium mb-2">Ingredients</h4>
      {loading && <p className="text-sm text-muted-foreground mb-4">Loading ingredients…</p>}
      {!loading && ingredients.length === 0 && (
        <p className="text-sm text-muted-foreground mb-4">No ingredients recorded for this recipe.</p>
      )}
      {!loading && ingredients.length > 0 && (
        <ul className="mb-6 space-y-1 text-sm">
          {displayIngredients.map(ing => (
            <li key={ing.id}>{formatIngredientLine(ing, unitPrefs)}</li>
          ))}
        </ul>
      )}

      <h4 className="font-medium mb-2">Instructions</h4>
      {steps.length === 0 && (
        <p className="text-sm text-muted-foreground">No instructions recorded for this recipe.</p>
      )}
      {steps.length > 0 && (
        <ol className="space-y-4 text-sm list-decimal list-outside pl-5">
          {steps.map((step, i) => (
            <li key={i}>
              {stepImageUrls[i] && (
                <img
                  src={stepImageUrls[i]}
                  alt=""
                  className="w-full max-w-sm aspect-video object-cover rounded-md mb-2"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}
              {formatTemperatureText(step, unitPrefs.temperature_unit)}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function PdfView({ recipe }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setError(null)

    supabase.storage
      .from('recipe-pdfs')
      .createSignedUrl(recipe.storage_path, 60)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Signed URL error:', error)
          setError(`Could not load PDF preview: ${error.message ?? 'unknown error'}`)
          return
        }
        setUrl(data.signedUrl)
      })

    return () => { cancelled = true }
  }, [recipe])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && !url && <p className="text-sm text-muted-foreground">Loading preview…</p>}
      {url && (
        <iframe
          src={url}
          className="flex-1 w-full rounded border border-border min-h-0"
          title={recipe.name ?? recipe.filename}
        />
      )}
    </div>
  )
}

export default function RecipePreviewPanel({ recipe, onClose }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="font-semibold truncate">{recipe.name ?? recipe.filename}</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="instructions" className="flex-1 min-h-0">
        <TabsList className="shrink-0">
          <TabsTrigger value="instructions">Instructions</TabsTrigger>
          <TabsTrigger value="pdf">Original PDF</TabsTrigger>
        </TabsList>

        <TabsContent value="instructions" className="flex flex-col min-h-0">
          <InstructionsView recipe={recipe} />
        </TabsContent>

        <TabsContent value="pdf" className="flex flex-col min-h-0">
          <PdfView recipe={recipe} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
