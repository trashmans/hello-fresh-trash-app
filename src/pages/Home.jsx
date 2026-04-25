import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import UserMenu from '@/components/UserMenu'
import PDFUploader from '@/components/PDFUploader'
import RecipeCatalogue from '@/components/RecipeCatalogue'
import RecipePreviewPanel from '@/components/RecipePreviewPanel'
import ShoppingListDrawer from '@/components/ShoppingListDrawer'
import { useShoppingList } from '@/hooks/useShoppingList'
import { useIngredientSearch } from '@/hooks/useIngredientSearch'
import { Button } from '@/components/ui/button'
import IngredientSearchBar from '@/components/IngredientSearch'

export default function Home() {
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const shoppingList = useShoppingList()
  const [searchQuery, setSearchQuery] = useState('')
  const { matches: ingredientMatches, loading: searchLoading, termCount } = useIngredientSearch(searchQuery)

  function handleUploadComplete() {
    setRefreshKey(k => k + 1)
  }

  function handleClose() {
    setSelectedRecipe(null)
  }

  function handleDelete(recipe) {
    if (selectedRecipe?.id === recipe.id) setSelectedRecipe(null)
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <Link to="/home">
          <h1 className="text-lg font-semibold text-primary hover:opacity-80 transition-opacity">
            Hello Fresh Trash
          </h1>
        </Link>
        <div className="flex items-center gap-4">
          <PDFUploader onUploadComplete={handleUploadComplete} />
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open shopping list"
            >
              <ShoppingCart className="h-5 w-5" />
            </Button>
            {shoppingList.selectedIds.length > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center pointer-events-none">
                {shoppingList.selectedIds.length}
              </span>
            )}
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <div className={`p-6 overflow-y-auto transition-all ${selectedRecipe ? 'w-1/2' : 'w-full max-w-4xl mx-auto'}`}>
          <div className="mb-6">
            <h2 className="text-2xl font-bold">Recipes</h2>
            <p className="text-muted-foreground mt-1">
              Upload HelloFresh recipe cards to build the catalogue
            </p>
          </div>
          <div className="mb-4">
            <IngredientSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              loading={searchLoading}
            />
          </div>
          <RecipeCatalogue
            refreshKey={refreshKey}
            onSelect={setSelectedRecipe}
            onDelete={handleDelete}
            selectedIds={shoppingList.selectedIds}
            onToggle={shoppingList.toggleRecipe}
            ingredientMatches={ingredientMatches}
            termCount={termCount}
          />
        </div>
        {selectedRecipe && (
          <div className="w-1/2 border-l border-border p-6 flex flex-col overflow-hidden">
            <RecipePreviewPanel recipe={selectedRecipe} onClose={handleClose} />
          </div>
        )}
      </main>

      <ShoppingListDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        shoppingList={shoppingList}
      />
    </div>
  )
}
