import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import RecipeCatalogue from '@/components/RecipeCatalogue'
import RecipePreviewPanel from '@/components/RecipePreviewPanel'
import { useIngredientSuggestions, useIngredientFilter } from '@/hooks/useIngredientSearch'
import IngredientSearchBar from '@/components/IngredientSearch'

// Recipes tab. The shopping list and the upload refresh counter live in
// AppShell (shared with the Shopping tab and the header) and arrive here
// through the router's outlet context.
export default function Recipes() {
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const { shoppingList, refreshKey } = useOutletContext()
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [selectedIngredients, setSelectedIngredients] = useState([])
  const { suggestions: ingredientSuggestions, loading: suggestionsLoading } = useIngredientSuggestions(ingredientQuery)
  const { matches: ingredientMatches } = useIngredientFilter(selectedIngredients)

  function handleSelectIngredient(term) {
    setSelectedIngredients(prev => prev.includes(term) ? prev : [...prev, term])
  }

  function handleRemoveIngredient(term) {
    setSelectedIngredients(prev => prev.filter(t => t !== term))
  }

  function handleClose() {
    setSelectedRecipe(null)
  }

  function handleDelete(recipe) {
    if (selectedRecipe?.id === recipe.id) setSelectedRecipe(null)
  }

  return (
    <div className="flex h-full">
      <div className={`p-6 overflow-y-auto transition-all ${selectedRecipe ? 'w-1/2' : 'w-full max-w-4xl mx-auto'}`}>
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Recipes</h2>
          <p className="text-muted-foreground mt-1">
            Upload a recipe card to build the catalogue — we love HelloFresh, but anything works
          </p>
        </div>
        <div className="mb-4">
          <IngredientSearchBar
            query={ingredientQuery}
            onQueryChange={setIngredientQuery}
            suggestions={ingredientSuggestions}
            loading={suggestionsLoading}
            selected={selectedIngredients}
            onSelect={handleSelectIngredient}
            onRemove={handleRemoveIngredient}
          />
        </div>
        <RecipeCatalogue
          refreshKey={refreshKey}
          onSelect={setSelectedRecipe}
          onDelete={handleDelete}
          selectedIds={shoppingList.selectedIds}
          onToggle={shoppingList.toggleRecipe}
          ingredientMatches={ingredientMatches}
        />
      </div>
      {selectedRecipe && (
        <div className="w-1/2 border-l border-border p-6 flex flex-col overflow-hidden">
          <RecipePreviewPanel recipe={selectedRecipe} onClose={handleClose} />
        </div>
      )}
    </div>
  )
}
