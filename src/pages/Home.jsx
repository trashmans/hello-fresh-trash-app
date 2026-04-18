import { useState } from 'react'
import { Link } from 'react-router-dom'
import UserMenu from '@/components/UserMenu'
import PDFUploader from '@/components/PDFUploader'
import RecipeCatalogue from '@/components/RecipeCatalogue'
import RecipePreviewPanel from '@/components/RecipePreviewPanel'

export default function Home() {
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

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
          <RecipeCatalogue refreshKey={refreshKey} onSelect={setSelectedRecipe} onDelete={handleDelete} />
        </div>
        {selectedRecipe && (
          <div className="w-1/2 border-l border-border p-6 flex flex-col overflow-hidden">
            <RecipePreviewPanel recipe={selectedRecipe} onClose={handleClose} />
          </div>
        )}
      </main>
    </div>
  )
}
