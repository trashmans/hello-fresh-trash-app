import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
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

  const handleClose = useCallback(() => setSelectedRecipe(null), [])

  // Another tab can open a recipe here: navigate('/recipes', { state: { openRecipeId } }).
  const location = useLocation()
  const navigate = useNavigate()
  const openRecipeId = location.state?.openRecipeId
  useEffect(() => {
    if (!openRecipeId) return
    // The state is cleared straight away (so a reload doesn't reopen it); the fetch still lands.
    supabase.from('recipes').select('*').eq('id', openRecipeId).maybeSingle().then(({ data }) => {
      if (data) setSelectedRecipe(data)
    })
    navigate(location.pathname, { replace: true, state: null })
  }, [openRecipeId, navigate, location.pathname])

  function handleDelete(recipe) {
    if (selectedRecipe?.id === recipe.id) setSelectedRecipe(null)
  }

  // The catalogue stays mounted (only hidden) while a recipe is open, so going
  // back keeps its scroll position, filters and loaded covers.
  return (
    <div className="relative h-full">
      <div
        className={`absolute inset-0 overflow-y-auto ${selectedRecipe ? 'invisible' : ''}`}
        aria-hidden={selectedRecipe ? true : undefined}
      >
        <div className="mx-auto flex max-w-[1200px] flex-col gap-10 lg:gap-12 px-4 py-8 lg:px-6 lg:py-12">
          <section className="flex flex-col gap-5">
            <h1 className="max-w-[760px] text-4xl sm:text-5xl lg:text-[56px] font-bold leading-[1.02] tracking-[-0.02em]">
              What are you cooking tonight?
            </h1>
            <div className="max-w-[760px]">
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
          </section>

          <RecipeCatalogue
            refreshKey={refreshKey}
            onSelect={setSelectedRecipe}
            onDelete={handleDelete}
            selectedIds={shoppingList.selectedIds}
            onToggle={shoppingList.toggleRecipe}
            ingredientMatches={ingredientMatches}
            ingredientTerms={selectedIngredients}
          />

          <section className="flex flex-wrap gap-6 rounded-[28px] border border-border bg-banner p-6 sm:p-10">
            <div className="flex flex-[999_1_420px] flex-col gap-3.5">
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">Plan once, shop once</p>
              <h2 className="text-[28px] sm:text-[34px] font-bold leading-[1.1]">Pick this week&apos;s recipes. We build the Albert Heijn list.</h2>
              <p className="max-w-[560px] text-base leading-relaxed text-muted-foreground">
                Ingredients are combined across recipes, scaled to your servings and grouped by aisle. Your staples and mapped
                ingredients go to your AH list as real products — you check the preview before anything is sent.
              </p>
            </div>
            <div className="flex flex-[1_1_260px] flex-col justify-end gap-2.5">
              <Link to="/shopping" className="flex h-[52px] items-center justify-center rounded-[14px] bg-secondary text-base font-bold text-secondary-foreground hover:opacity-90 transition-opacity">
                Review this week&apos;s list
              </Link>
              <Link to="/ordering" className="flex h-[52px] items-center justify-center rounded-[14px] border border-input text-base font-semibold hover:bg-accent transition-colors">
                Preview the AH order
              </Link>
            </div>
          </section>
        </div>
      </div>
      {selectedRecipe && (
        <div className="absolute inset-0 overflow-y-auto">
          <RecipePreviewPanel
            key={selectedRecipe.id}
            recipe={selectedRecipe}
            onClose={handleClose}
            inList={shoppingList.selectedIds.includes(selectedRecipe.id)}
            onToggle={shoppingList.toggleRecipe}
          />
        </div>
      )}
    </div>
  )
}
