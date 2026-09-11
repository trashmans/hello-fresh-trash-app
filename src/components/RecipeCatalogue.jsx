import { useEffect, useState, useCallback } from 'react'
import { FileText, Trash2, RotateCcw, Loader2, ShoppingCart, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
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

function PendingCard({ recipe, onDelete, deleting }) {
  const label = recipe.status === 'processing' ? 'Processing…' : 'Queued…'
  return (
    <Card className="opacity-60">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="w-full aspect-video bg-muted flex items-center justify-center rounded-md mb-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
        <p className="text-sm font-medium truncate">{recipe.filename}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-destructive hover:text-destructive mt-1"
          disabled={deleting}
          onClick={() => onDelete(recipe)}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Cancel
        </Button>
      </CardContent>
    </Card>
  )
}

function RejectedCard({ recipe, existingRecipe, onSelect }) {
  const existingLabel = existingRecipe?.name ?? existingRecipe?.filename ?? 'existing recipe'

  return (
    <Card className="border-destructive/40 opacity-70">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="w-full aspect-video bg-destructive/10 flex items-center justify-center rounded-md mb-2">
          <FileText className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium truncate text-destructive">Already in catalogue</p>
        <p className="text-xs text-muted-foreground truncate">{recipe.filename}</p>
        {existingRecipe && (
          <button
            className="text-xs text-primary underline text-left truncate"
            onClick={() => onSelect(existingRecipe)}
          >
            View: {existingLabel}
          </button>
        )}
      </CardContent>
    </Card>
  )
}

function FailedCard({ recipe, onRetry, onDelete, deleting, retrying }) {
  const maxRetries = (recipe.retry_count ?? 0) >= 3

  return (
    <Card className="border-destructive/40 opacity-70">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="w-full aspect-video bg-destructive/10 flex items-center justify-center rounded-md mb-2">
          <FileText className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium truncate text-destructive">Processing failed</p>
        <p className="text-xs text-muted-foreground truncate">{recipe.filename}</p>
        {maxRetries && (
          <p className="text-xs text-muted-foreground">Please delete and re-upload</p>
        )}
        <div className="flex gap-2 mt-1">
          {!maxRetries && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              disabled={retrying}
              onClick={() => onRetry(recipe.id)}
            >
              {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              Retry
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 text-xs text-destructive hover:text-destructive"
            disabled={deleting}
            onClick={() => onDelete(recipe)}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function RecipeCatalogue({ refreshKey, onSelect, onDelete, selectedIds = [], onToggle, ingredientMatches = null }) {
  const { session, adminMode } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [retrying, setRetrying] = useState(null)
  const [reparsing, setReparsing] = useState(null)

  const fetchRecipes = useCallback(async () => {
    setLoading(true)

    // Own recipes at any status + all ready recipes from others
    const { data, error } = await supabase
      .from('recipes')
      .select('*')
      .or(`status.eq.ready,uploaded_by.eq.${session.user.id}`)
      .order('created_at', { ascending: false })

    if (error || !data) {
      setLoading(false)
      return
    }

    setRecipes(data)

    // Fetch uploader profiles
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
  }, [session.user.id])

  useEffect(() => {
    fetchRecipes()
  }, [fetchRecipes, refreshKey])

  // Realtime subscription for the current user's recipe status changes
  useEffect(() => {
    const channel = supabase
      .channel('own-recipe-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recipes',
          filter: `uploaded_by=eq.${session.user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setRecipes(prev => {
              if (prev.some(r => r.id === payload.new.id)) return prev
              return [payload.new, ...prev]
            })
          } else if (payload.eventType === 'UPDATE') {
            setRecipes(prev =>
              prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r)
            )
          } else if (payload.eventType === 'DELETE') {
            setRecipes(prev => prev.filter(r => r.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [session.user.id])

  async function handleDelete(recipe, e) {
    e?.stopPropagation()
    setDeleting(recipe.id)
    const toastId = toast.loading('Deleting recipe…')

    try {
      const pathsToDelete = [recipe.storage_path].filter(Boolean)
      if (pathsToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('recipe-pdfs')
          .remove(pathsToDelete)
        if (storageError) throw storageError
      }

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
    } finally {
      setDeleting(null)
    }
  }

  async function handleRetry(recipeId) {
    setRetrying(recipeId)
    try {
      const { error } = await supabase.functions.invoke('retry-parse', {
        body: { recipeId },
      })
      if (error) throw error
    } catch (err) {
      toast.error(`Retry failed: ${err.message ?? 'unknown error'}`)
    } finally {
      setRetrying(null)
    }
  }

  async function handleReparse(recipeId, e) {
    e?.stopPropagation()
    setReparsing(recipeId)
    const toastId = toast.loading('Queuing re-parse…')
    try {
      const { error } = await supabase.functions.invoke('admin-reparse', {
        body: { recipeId },
      })
      if (error) throw error
      toast.success('Recipe queued for re-parsing.', { id: toastId })
    } catch (err) {
      toast.error(`Re-parse failed: ${err.message ?? 'unknown error'}`, { id: toastId })
    } finally {
      setReparsing(null)
    }
  }

  // ingredientMatches already contains only recipes matching every
  // selected ingredient chip (AND match) — see useIngredientFilter.
  const displayRecipes = ingredientMatches
    ? recipes.filter(r => r.status === 'ready' ? ingredientMatches.has(r.id) : true)
    : recipes

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading recipes…</p>
  }

  if (recipes.length === 0) {
    return (
      <Card className="flex flex-col items-center text-center py-16">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <FileText className="h-7 w-7 text-primary" />
        </div>
        <p className="text-lg font-semibold">No recipes yet</p>
        <p className="text-sm text-muted-foreground mt-1">Upload your first HelloFresh recipe card to get started</p>
      </Card>
    )
  }

  if (ingredientMatches && displayRecipes.length === 0) {
    return (
      <Card className="flex flex-col items-center text-center py-16">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <FileText className="h-7 w-7 text-muted-foreground" />
        </div>
        <p className="text-lg font-semibold">No matches found</p>
        <p className="text-sm text-muted-foreground mt-1">None of your recipes contain those ingredients</p>
      </Card>
    )
  }

  const canDelete = (recipe) =>
    recipe.uploaded_by === session?.user?.id || adminMode

  const isOwn = (recipe) => recipe.uploaded_by === session?.user?.id

  function getDuplicateId(recipe) {
    const match = (recipe.rejection_reason ?? '').match(/^duplicate:(.+)$/)
    return match?.[1] ?? null
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {displayRecipes.map(recipe => {
        const { status } = recipe

        if ((status === 'pending' || status === 'processing') && isOwn(recipe)) {
          return (
            <PendingCard
              key={recipe.id}
              recipe={recipe}
              onDelete={(r) => handleDelete(r)}
              deleting={deleting === recipe.id}
            />
          )
        }

        if (status === 'rejected' && isOwn(recipe)) {
          const dupeId = getDuplicateId(recipe)
          const existingRecipe = dupeId ? recipes.find(r => r.id === dupeId) : null
          return (
            <RejectedCard
              key={recipe.id}
              recipe={recipe}
              existingRecipe={existingRecipe}
              onSelect={onSelect}
            />
          )
        }

        if (status === 'failed' && isOwn(recipe)) {
          return (
            <FailedCard
              key={recipe.id}
              recipe={recipe}
              onRetry={handleRetry}
              onDelete={(r) => handleDelete(r)}
              deleting={deleting === recipe.id}
              retrying={retrying === recipe.id}
            />
          )
        }

        if (status === 'ready') {
          const isSelected = selectedIds.includes(recipe.id)
          return (
            <Card
              key={recipe.id}
              className={`cursor-pointer hover:border-primary transition-colors relative ${isSelected ? 'border-primary' : ''}`}
              onClick={() => onSelect(recipe)}
            >
              <CardContent className="p-4 flex flex-col gap-2">
                {onToggle && (
                  <button
                    className={`absolute top-2 left-2 z-10 rounded p-1 transition-colors ${
                      isSelected
                        ? 'text-primary bg-primary/15'
                        : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                    }`}
                    onClick={(e) => { e.stopPropagation(); onToggle(recipe) }}
                    title={isSelected ? 'Remove from shopping list' : 'Add to shopping list'}
                  >
                    <ShoppingCart className="h-4 w-4" />
                  </button>
                )}
                <div className="w-full aspect-video bg-muted flex items-center justify-center rounded-md mb-2">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium truncate">{recipe.name ?? recipe.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(recipe.created_at).toLocaleDateString()}
                </p>
                <UploaderAvatar profile={profiles[recipe.uploaded_by] ?? null} />
              </CardContent>
              {adminMode && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={reparsing === recipe.id}
                  onClick={(e) => handleReparse(recipe.id, e)}
                  className="absolute bottom-2 right-2 text-muted-foreground hover:text-primary"
                  title="Re-parse recipe (admin)"
                >
                  {reparsing === recipe.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                </Button>
              )}
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
          )
        }

        return null
      })}
    </div>
  )
}
