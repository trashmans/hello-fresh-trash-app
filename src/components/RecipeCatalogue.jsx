import { useEffect, useState } from 'react'
import { FileText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export default function RecipeCatalogue({ refreshKey, onSelect, onDelete }) {
  const { session } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    async function fetchRecipes() {
      setLoading(true)
      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('status', 'ready')
        .order('created_at', { ascending: false })

      if (!error) setRecipes(data)
      setLoading(false)
    }

    fetchRecipes()
  }, [refreshKey])

  async function handleDelete(recipe, e) {
    e.stopPropagation()
    setDeleting(recipe.id)
    const toastId = toast.loading('Deleting recipe…')

    try {
      const { error: storageError } = await supabase.storage
        .from('recipe-pdfs')
        .remove([recipe.storage_path])

      if (storageError) throw storageError

      const { error: dbError } = await supabase
        .from('recipes')
        .delete()
        .eq('id', recipe.id)

      if (dbError) throw dbError

      setRecipes(prev => prev.filter(r => r.id !== recipe.id))
      onDelete?.(recipe)
      toast.success('Recipe deleted.', { id: toastId })
    } catch (err) {
      toast.error(`Delete failed: ${err.message ?? 'unknown error'}`, { id: toastId })
      console.error(err)
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading recipes…</p>
  }

  if (recipes.length === 0) {
    return (
      <Card className="flex flex-col items-center text-center py-16">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <FileText className="h-7 w-7 text-primary" />
          </div>
          <CardTitle>No recipes yet</CardTitle>
          <CardDescription>Upload your first HelloFresh recipe card to get started</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {recipes.map(recipe => (
        <Card
          key={recipe.id}
          className="cursor-pointer hover:border-primary transition-colors relative group"
          onClick={() => onSelect(recipe)}
        >
          <CardContent className="p-4 flex flex-col gap-2">
            <FileText className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium truncate">{recipe.name ?? recipe.filename}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(recipe.created_at).toLocaleDateString()}
            </p>
          </CardContent>
          {recipe.uploaded_by === session?.user?.id && (
            <Button
              variant="ghost"
              size="icon"
              disabled={deleting === recipe.id}
              onClick={(e) => handleDelete(recipe, e)}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </Card>
      ))}
    </div>
  )
}
