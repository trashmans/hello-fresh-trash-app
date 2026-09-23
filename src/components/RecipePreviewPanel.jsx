import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import { useRecipeIngredients } from '@/hooks/useRecipeIngredients'
import { useRecipeStepImages } from '@/hooks/useRecipeStepImages'

function formatIngredientLine(ingredient) {
  const parts = []
  if (ingredient.quantity != null) parts.push(String(ingredient.quantity))
  if (ingredient.unit) parts.push(ingredient.unit)
  parts.push(ingredient.name)
  let line = parts.join(' ')
  if (ingredient.preparation) line += `, ${ingredient.preparation}`
  return line
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
  const { ingredients, loading } = useRecipeIngredients(recipe.id)
  const steps = recipe.steps ?? []
  const { stepImageUrls } = useRecipeStepImages(recipe.id, steps.length)

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <RecipeMeta recipe={recipe} />

      <h4 className="font-medium mb-2">Ingredients</h4>
      {loading && <p className="text-sm text-muted-foreground mb-4">Loading ingredients…</p>}
      {!loading && ingredients.length === 0 && (
        <p className="text-sm text-muted-foreground mb-4">No ingredients recorded for this recipe.</p>
      )}
      {!loading && ingredients.length > 0 && (
        <ul className="mb-6 space-y-1 text-sm">
          {ingredients.map(ing => (
            <li key={ing.id}>{formatIngredientLine(ing)}</li>
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
              {step}
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
