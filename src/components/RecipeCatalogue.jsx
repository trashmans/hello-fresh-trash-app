import { useEffect, useState } from 'react'
import { FileText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

function UploaderAvatar({ profile }) {
  const [imgError, setImgError] = useState(false)

  if (!profile) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-semibold">
        ?
      </span>
    )
  }

  const initial = (profile.display_name ?? '?')[0].toUpperCase()

  return (
    <span className="inline-flex items-center gap-1.5">
      {profile.avatar_url && !imgError ? (
        <img
          src={profile.avatar_url}
          alt={initial}
          className="h-5 w-5 rounded-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
          {initial}
        </span>
      )}
      <span className="text-xs text-muted-foreground truncate max-w-[80px]">
        {profile.display_name ?? 'Unknown'}
      </span>
    </span>
  )
}

export default function RecipeCatalogue({ refreshKey, onSelect, onDelete }) {
  const { session, adminMode } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [profiles, setProfiles] = useState({})
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

      if (error || !data) {
        setLoading(false)
        return
      }

      setRecipes(data)

      const uploaderIds = [...new Set(data.map(r => r.uploaded_by).filter(Boolean))]
      if (uploaderIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .in('id', uploaderIds)

        if (profileData) {
          const map = {}
          profileData.forEach(p => { map[p.id] = p })
          setProfiles(map)
        }
      }

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

  const canDelete = (recipe) =>
    recipe.uploaded_by === session?.user?.id || adminMode

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {recipes.map(recipe => (
        <Card
          key={recipe.id}
          className="cursor-pointer hover:border-primary transition-colors relative"
          onClick={() => onSelect(recipe)}
        >
          <CardContent className="p-4 flex flex-col gap-2">
            <FileText className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium truncate">{recipe.name ?? recipe.filename}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(recipe.created_at).toLocaleDateString()}
            </p>
            <UploaderAvatar profile={profiles[recipe.uploaded_by] ?? null} />
          </CardContent>
          {canDelete(recipe) && (
            <Button
              variant="ghost"
              size="icon"
              disabled={deleting === recipe.id}
              onClick={(e) => handleDelete(recipe, e)}
              className="absolute top-2 right-2 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </Card>
      ))}
    </div>
  )
}
